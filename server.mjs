import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat, writeFile, unlink, copyFile } from 'node:fs/promises';
import { mkdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authed as checkAuth } from './lib/auth.mjs';
import { load, save, id, newAgent, patchAgent, dataUrl } from './lib/store.mjs';
import { route, classifySpeaker, MODELS, EFFORTS } from './lib/router.mjs';
import { computerFor } from './lib/boat.mjs';
import { dockerAvailable, imageStatus, ensureImage, hostnameOf } from './lib/docker.mjs';
import { ApprovalGate } from './lib/approvals.mjs';
import { juliaOnline, juliaChoose, juliaStatus, measureTriagePromptChars, RISK_OPTIONS, NOTIFY_OPTIONS } from './lib/julia.mjs';
import { checkSend, dueMessages, threadKey, inboxPrompt, repairInboxOnStartup, markInboxDeliveryFailed, inboxSummary } from './lib/inbox.mjs';
import { rememberAllowedCommand, execNeedsApproval } from './lib/permissions.mjs';
import { browserAutonomyGate, shareAutonomyGate, effectiveApprovalPolicy, sanitizeAutonomyLevel } from './lib/autonomy.mjs';
import { listChatsPage } from './lib/history.mjs';
import { tryClaimRoutine, releaseRoutineClaim } from './lib/persist-coord.mjs';
import { browserFor, browserRisk } from './lib/browser.mjs';
import { runClaude, runCodex, systemPrompt } from './lib/providers.mjs';
import { runTestProvider } from './lib/test-provider.mjs';
import { TEMPLATES, CATEGORIES } from './lib/templates.mjs';
import { canUseFile, selectSpeakers, routineDue, Floor, isPass, heuristicSpeaker, groupMembers, trimHistory, isNothingNew, routinePrompt, summarizeEvent, lastUserTurnIndex, labelMessageForAgent, turnPlanIds } from './lib/agent-flow.mjs';
import { providerAttemptOrder, runProviderAttemptLoop } from './lib/provider-turn.mjs';
import { normalizeProviderRetry } from './lib/provider-retry.mjs';
import { applySettingsPatch, applyPluginsPatch, settingsMeta } from './lib/settings-patch.mjs';
import { appendAudit, auditFromApproval, listAudit } from './lib/audit.mjs';
import { buildAdminOverview } from './lib/admin-overview.mjs';
import { buildLgpdStatus } from './lib/lgpd-status.mjs';
import { isEnterpriseMode } from './lib/enterprise.mjs';
import { newHookToken, verifySignature, eventMeta } from './lib/hooks.mjs';
import { recordUsage, usageSummary, accountLimits, contextBreakdown, checkSendQuota, compactChat, parseProviderLimitFromError, recordProviderSignal } from './lib/usage.mjs';
import { buildUsageContract, normalizeContextWindow } from './lib/usage-api.mjs';
import { registerChatStream, cancelChatStream, unregisterChatStream, isChatStreaming, activeChatStreamCount } from './lib/chat-stream.mjs';
import { exportChatPayload, importChatPayload } from './lib/chat-transfer.mjs';
import { listAgentTemplates, createSavedTemplate, patchSavedTemplate, agentFromSavedTemplate } from './lib/agent-templates.mjs';
import { ripperBuiltinSchemaChars, listRipperBuiltinToolNames } from './lib/ripper-builtin-tools.mjs';
import { refreshClaudeSubscriptionUsage } from './lib/claude-subscription-usage.mjs';
import { verifyMcpServer, verifyMcpConnector } from './lib/mcp-probe.mjs';
import {
  applyOAuthTokensToPlugin,
  discoverMcpOAuth,
  exchangeOAuthCode,
  findOAuthFlowByState,
  getOAuthFlow,
  mergePluginAuth,
  oauthRedirectUri,
  pluginOAuthStatus,
  startMcpOAuthFlow
} from './lib/mcp-oauth.mjs';
import {
  persistArtifactContent,
  readArtifactContent,
  deleteArtifactStorage,
  migrateInlineArtifacts,
  artifactDownloadName
} from './lib/artifacts.mjs';
import { resolveSkillContent, formatSkillsList, listSkillsCatalog } from './lib/skills-runtime.mjs';
import { buildMessageAttachments, attachmentWarnings, MAX_FOLDER_FILES } from './lib/attachments.mjs';
import {
  startupStorageCleanup,
  cleanupAgentResources,
  removeProjectSandboxDir
} from './lib/sandbox-lifecycle.mjs';
import { releaseBoatSandbox, clearBoatIdleTimer } from './lib/boat.mjs';
import {
  activePlugins,
  createPluginRecord,
  listConnectorRecords,
  listMcpToolCatalog,
  redactSettingsSecrets,
  refreshConnectorOAuth,
  settingsForMcpSession,
  updatePluginRecord,
  redactPlugin
} from './lib/mcp-connectors.mjs';
import { redactRoutine, redactSseEvent, redactJsonPayload, redactForLog } from './lib/redact.mjs';
import { collectDiagnostics } from './lib/diagnostics.mjs';
import { buildBackupPayload, restoreBackupPayload, listAutoBackups } from './lib/backup.mjs';
import { memoAsync } from './lib/ttl-cache.mjs';

function settingsForMcp(s, mcpSession) {
  return settingsForMcpSession(s, mcpSession);
}

const db = load();
for (const a of db.approvals || []) if (a.status === 'pending') { a.status = 'expired'; a.decidedAt = Date.now(); }
await migrateInlineArtifacts(db.artifacts).catch(e => console.error('[artifacts] migração:', e.message));
const _storageCleanup = await startupStorageCleanup(db).catch(e => ({ error: e.message }));
if (_storageCleanup?.files?.removedRecords?.length) save();
const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';          // só a própria máquina, a não ser que você peça
const TOKEN = process.env.RIPPER_TOKEN || '';            // obrigatório ao expor na rede
const DIST = new URL('./dist/', import.meta.url);
const MAX_JSON = 1 << 20, MAX_FILE = 25 << 20;
const TEXT_EXT = /\.(txt|md|csv|tsv|json|jsonl|xml|html|css|js|mjs|ts|tsx|jsx|py|rb|go|rs|java|c|cpp|h|sql|yaml|yml|toml|ini|log|sh)$/i;

if (HOST !== '127.0.0.1' && HOST !== 'localhost' && !TOKEN) {
  console.error('Recusado: HOST expõe o Ripper na rede sem RIPPER_TOKEN. Defina RIPPER_TOKEN=<segredo longo>.');
  process.exit(1);
}

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.json': 'application/json', '.pdf': 'application/pdf', '.ico': 'image/x-icon' };
const SECURITY = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src http://127.0.0.1:* http://localhost:*; frame-ancestors 'none'; base-uri 'none'"
};

const json = (res, data, code = 200, extra = {}) => {
  res.writeHead(code, { ...SECURITY, 'content-type': 'application/json; charset=utf-8', 'cache-control': extra['cache-control'] || 'no-store', ...extra });
  res.end(JSON.stringify(redactJsonPayload(data)));
};
async function raw(req, limit) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new HttpError(413, 'Arquivo grande demais.'); chunks.push(c); }
  return Buffer.concat(chunks);
}
body.raw = req => raw(req, MAX_JSON);
async function body(req) {
  const b = await raw(req, MAX_JSON);
  if (!b.length) return {};
  try { return JSON.parse(b); } catch { throw new HttpError(400, 'JSON inválido.'); }
}
const redact = redactSettingsSecrets;

function publicBaseUrl(req) {
  const host = req.headers.host || `127.0.0.1:${PORT}`;
  const proto = req.headers['x-forwarded-proto'] || (HOST === '0.0.0.0' ? 'http' : 'http');
  return `${proto}://${host}`;
}
// Prévias em texto puro: nada de ** ou # aparecendo nas listas.
const plain = s => String(s || '').replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
const summary = ({ messages, ...c }) => ({ ...c, preview: plain(messages.at(-1)?.content).slice(0, 90), count: messages.length });
const projectOr404 = pid => db.projects.find(p => p.id === pid) || (() => { throw new HttpError(404, 'Projeto não encontrado.'); })();
const agentOr404 = aid => db.agents.find(a => a.id === aid) || (() => { throw new HttpError(404, 'Agente não encontrado.'); })();
const syncedBoatFiles = new Set();

function authed(req) {
  return checkAuth(req, TOKEN);
}

function patchProject(p, b) {
  if (typeof b.name === 'string' && b.name.trim()) p.name = b.name.trim().slice(0, 80);
  if (typeof b.description === 'string') p.description = b.description.slice(0, 300);
  if (typeof b.instructions === 'string') p.instructions = b.instructions.slice(0, 8000);
  if (Array.isArray(b.agentIds)) p.agentIds = [...new Set(b.agentIds)].filter(a => db.agents.some(x => x.id === a));
  p.updatedAt = Date.now();
  return p;
}

// O que cada conversa enxerga: artefatos do projeto (ou da própria conversa) e skills globais + do projeto.
const visibleArtifacts = chat => db.artifacts.filter(x => chat.projectId ? x.projectId === chat.projectId : x.chatId === chat.id);
const visibleSkills = chat => db.skills.filter(k => !k.projectId || k.projectId === chat.projectId);

function usageContextMeasures(chatId) {
  const chat = chatId && db.chats.find(c => c.id === chatId);
  const agentId = chat?.agentId || chat?.agentIds?.[0];
  const agent = agentId ? db.agents.find(a => a.id === agentId) : null;
  const memories = agent ? db.memories.filter(m => m.agentId === agent.id && m.tier === 'profile') : [];
  const skills = chat ? visibleSkills(chat) : [];
  const skillsListChars = skills.reduce((n, k) => n + String(k.name).length + String(k.description || '').length, 0);
  const plugins = (db.settings.plugins || []).filter(p => p.enabled !== false);
  const pluginsChars = plugins.reduce((n, p) => n + JSON.stringify({ name: p.name, type: p.type, url: p.url, command: p.command }).length, 0);
  const members = chat ? groupMembers(chat, db.agents) : [];
  const groupContextChars = members.length > 1
    ? members.reduce((n, a) => n + String(a.name).length + String(a.description || '').length, 0) : 0;
  return {
    systemChars: agent ? systemPrompt(agent, db.settings, memories).length : 0,
    skillsListChars,
    pluginsChars,
    mcpPluginCount: plugins.length,
    builtinToolCount: agent ? listRipperBuiltinToolNames(agent, db.settings).length : 0,
    builtinSchemaChars: agent ? ripperBuiltinSchemaChars(agent, db.settings) : 0,
    groupContextChars
  };
}

// Aprovações: pedidos pendentes vivem em memória (a promessa que segura o agente) e no banco (histórico).
// Verificado uma vez: o CLI do Codex está instalado nesta máquina?
const codexInstalled = new Promise(resolve => {
  const p = spawn('codex --version', { shell: true, windowsHide: true }); // comando fixo, sem argumentos do usuário
  p.on('error', () => resolve(false));
  p.on('close', code => resolve(code === 0));
  setTimeout(() => resolve(false), 8000);
});
codexInstalled.then(ok => { if (!ok) console.log('Codex não encontrado: o Ripper Auto usa só o Claude. Instale com: npm i -g @openai/codex'); });

const dockerStatusCached = memoAsync(async () => ({ version: await dockerAvailable(), image: await imageStatus() }), 30_000);

// ---------- mensagens entre agentes ----------
const inboxBusy = new Set();
async function deliver(m) {
  const to = db.agents.find(a => a.id === m.to), from = db.agents.find(a => a.id === m.from);
  if (!to || !from) { markInboxDeliveryFailed(m, 'Agente não existe mais.'); save(); return; }
  inboxBusy.add(to.id); m.status = 'delivering'; save();
  try {
    // A troca entre os dois fica numa conversa própria; o destinatário não vê a conversa de origem.
    const key = threadKey(from.id, to.id);
    let c = db.chats.find(x => x.inboxKey === key);
    if (!c) { c = { id: id(), agentId: to.id, agentIds: [from.id, to.id], inboxKey: key, title: `${from.name} ↔ ${to.name}`, messages: [], createdAt: Date.now(), updatedAt: Date.now() }; db.chats.unshift(c); }
    const prompt = inboxPrompt(m, from.name);
    c.messages.push({ id: id(), role: 'user', content: prompt, inbox: { from: from.id, messageId: m.id, priority: m.priority }, at: Date.now() });
    const before = c.messages.length;
    await turn({ agent: to, chat: c, text: m.body, prompt, images: [], group: null, hops: m.hops }, () => {});
    const reply = c.messages.length > before ? c.messages.at(-1) : null;
    c.updatedAt = Date.now(); c.unread = true;
    m.threadChatId = c.id; m.deliveredAt = Date.now();
    if (reply && !reply.error) { m.status = 'delivered'; m.error = null; }
    else markInboxDeliveryFailed(m, reply?.error || 'Sem resposta do destinatário.');
    // A resposta volta para onde o pedido nasceu, sem gastar um turno de quem pediu.
    const origin = db.chats.find(x => x.id === m.originChatId);
    if (origin && reply?.content) {
      origin.messages.push({ id: id(), role: 'assistant', agentId: to.id, content: reply.content, model: reply.model, via: { type: 'inbox', from: from.id, messageId: m.id, threadChatId: c.id }, at: Date.now() });
      origin.updatedAt = Date.now(); origin.unread = true;
    }
  } catch (e) { markInboxDeliveryFailed(m, e.message); console.error('mensagem', ...redactForLog(e.message)); }
  finally { inboxBusy.delete(m.to); save(); setTimeout(dispatchInbox, 50); }
}
function dispatchInbox() {
  for (const m of dueMessages(db.messages, [...inboxBusy])) deliver(m);
}
setInterval(dispatchInbox, 5_000);
repairInboxOnStartup(db.messages);
save();
dispatchInbox();

const gate = new ApprovalGate({
  onChange: rec => {
    if (rec.status !== 'pending') appendAudit(db, auditFromApproval(rec));
    save();
  }
});
const approvalView = a => ({ ...a, agentName: db.agents.find(x => x.id === a.agentId)?.name, chatTitle: db.chats.find(c => c.id === a.chatId)?.title });

/** Computador com portão: comandos de risco (ou tudo, na máquina do usuário) esperam sua aprovação. */
const browsers = new Map();
async function askApproval({ agent, chat, emit, signal }, kind, command, reason, remember = true) {
  const rec = { id: id(), agentId: agent.id, chatId: chat.id, kind, command, reason, status: 'pending', createdAt: Date.now() };
  db.approvals.push(rec);
  if (db.approvals.length > 300) db.approvals.splice(0, db.approvals.length - 300);
  emit({ approval: approvalView(rec) });
  const done = await gate.request(rec, signal);
  emit({ approvalDone: { id: rec.id, status: done.status } });
  if (remember && done.status === 'approved' && done.remember) rememberAllowedCommand(chat, command);
  return done.status === 'approved';
}

function guarded(computer, { agent, chat, emit, signal }) {
  const ask = async (kind, command, reason) => {
    const rec = { id: id(), agentId: agent.id, chatId: chat.id, kind, command, reason, status: 'pending', createdAt: Date.now() };
    db.approvals.push(rec);
    if (db.approvals.length > 300) db.approvals.splice(0, db.approvals.length - 300);
    emit({ approval: approvalView(rec) });
    const done = await gate.request(rec, signal);
    emit({ approvalDone: { id: rec.id, status: done.status } });
    if (done.status === 'approved' && done.remember) rememberAllowedCommand(chat, command);
    return done.status === 'approved';
  };
  const globalPolicy = db.settings.approvalPolicy || 'risky';
  const policy = effectiveApprovalPolicy(agent, globalPolicy, db.settings);
  return {
    ...computer,
    async exec(command) {
      let reason = execNeedsApproval({ command, computerKind: computer.kind, policy: globalPolicy, chat, agent, settings: db.settings });
      if (!reason && policy === 'risky' && !(chat.allowedCommands || []).includes(command)) {
        const riskCtx = `Agente ${agent.name} vai executar no próprio computador.`;
        const j = await juliaChoose(db.settings, { context: riskCtx, question: command, options: RISK_OPTIONS }, {
          minScore: 0.6,
          purpose: 'risk',
          avoidedPromptChars: measureTriagePromptChars({ context: riskCtx, question: command, options: RISK_OPTIONS })
        });
        if (j && j.index > 0) reason = `Julia 1: ${RISK_OPTIONS[j.index].split(':')[0].toLowerCase()}`;
      }
      if (reason && !(await ask('exec', command, reason))) return `O usuário NÃO aprovou este comando (${reason}). Não tente contorná-lo; explique o que precisava e ofereça uma alternativa segura.`;
      return computer.exec(command);
    },
    async share(port) {
      const autonomy = shareAutonomyGate(agent, db.settings);
      if (typeof autonomy === 'string') return `Esta ação não é permitida (${autonomy}).`;
      // Link público na internet (boat) pede aprovação; localhost não.
      if (computer.kind === 'boat' && autonomy === undefined && !(await ask('share', `compartilhar porta ${port}`, 'publica um link na internet'))) return 'O usuário não aprovou publicar o link.';
      return computer.share(port);
    }
  };
}

function sandboxDir(agent) {
  const d = dataUrl(`sandbox/${agent.id}/`);
  mkdirSync(new URL('uploads/', d), { recursive: true });
  return d;
}

// Anexos de texto entram no prompt; os demais ficam no computador do agente (ver lib/attachments.mjs).

// Contexto do projeto: instruções + arquivos de texto compartilhados (limite total de ~60 KB).
async function projectContext(project) {
  if (!project) return '';
  const out = [`Projeto: ${project.name}.${project.description ? ' ' + project.description : ''}`];
  if (project.instructions) out.push(`Instruções do projeto:
${project.instructions}`);
  let budget = 60_000;
  for (const f of db.files.filter(f => f.projectId === project.id)) {
    if (!TEXT_EXT.test(f.name) || f.size > budget) { out.push(`(Arquivo do projeto: ${f.name}, ${f.size} bytes)`); continue; }
    budget -= f.size;
    out.push(`<arquivo-do-projeto nome="${f.name}">
${await readFile(dataUrl(f.path), 'utf8').catch(() => '')}
</arquivo-do-projeto>`);
  }
  return out.join('\n\n');
}

async function syncLocalFiles(agent, chat) {
  const m = db.settings.computer.mode;
  if (!(m === 'docker' || (m === 'local' && db.settings.computer.allowLocalCommands))) return;
  const uploads = new URL('uploads/', sandboxDir(agent));
  for (const f of db.files.filter(f => f.agentId === agent.id || (chat.projectId && f.projectId === chat.projectId))) {
    const source = dataUrl(f.path);
    const target = new URL(basename(f.path), uploads);
    if (source.href !== target.href) await copyFile(source, target).catch(() => {});
  }
}

async function turn({ agent, chat, text, prompt, images, signal, group, hops = 0, mcpSession }, emit) {
  const s = settingsForMcp(db.settings, mcpSession);
  const name = id => db.agents.find(a => a.id === id)?.name || 'Outro agente';
  // Em grupo, a fala dos colegas chega rotulada com o nome de quem falou.
  const label = m => labelMessageForAgent(m, agent.id, name, { group });
  // Histórico = tudo antes da pergunta atual; o que os colegas já responderam nesta rodada vai depois dela.
  const at = lastUserTurnIndex(chat.messages);
  const history = trimHistory(at >= 0 ? chat.messages.slice(0, at) : chat.messages).map(label);
  const round = at >= 0 ? chat.messages.slice(at + 1).filter(m => m.content && m.role === 'assistant') : [];
  if (round.length) prompt += '\n\n' + round.map(m => `[${name(m.agentId || agent.id)} respondeu nesta rodada]: ${m.content}`).join('\n\n') + `\n\nAgora é a sua vez, ${agent.name}.`;
  const memories = s.memory && agent.tools.includes('memory') ? db.memories.filter(m => m.agentId === agent.id) : [];
  let computer = null;
  // Sem chave/computador desligado: a ferramenta só não é oferecida (o painel do agente avisa).
  if (agent.tools.includes('computer')) { try { computer = computerFor(agent, s, save); } catch {} }
  let browser = null;
  if (computer?.kind === 'docker' && agent.tools.includes('browser')) {
    const b = browsers.get(agent.id) || browserFor(computer, sandboxDir(agent));
    browsers.set(agent.id, b);
    const ask = (action, opts, label) => {
      const autonomy = browserAutonomyGate(agent, action, s);
      if (typeof autonomy === 'string') return Promise.resolve(false);
      const reason = autonomy === null ? null : browserRisk(action, opts);
      return reason ? askApproval({ agent, chat, emit, signal }, 'browser', label, reason) : Promise.resolve(true);
    };
    const denied = 'O usuário NÃO aprovou esta ação no navegador. Não tente contornar; explique o que ia fazer e pare.';
    browser = {
      open: url => { emit({ screen: true }); return b.open(url); },
      click: async t => (await ask('click', { target: t }, `clicar em “${t}”`)) ? b.click(t) : denied,
      type: async (t, txt, submit) => (await ask('type', { target: t, submit }, `digitar em “${t}”${submit ? ' e enviar' : ''}`)) ? b.type(t, txt, submit) : denied,
      scroll: dy => b.scroll(dy), read: () => b.read()
    };
  }
  if (computer) computer = guarded(computer, { agent, chat, emit, signal });
  if (computer?.kind === 'boat') {
    for (const f of db.files.filter(f => f.agentId === agent.id || (chat.projectId && f.projectId === chat.projectId))) {
      const key = `${agent.id}:${agent.vmId || 'new'}:${f.id}`;
      if (syncedBoatFiles.has(key)) continue;
      try {
        await computer.writeFile(basename(f.path), await readFile(dataUrl(f.path)));
        syncedBoatFiles.add(`${agent.id}:${agent.vmId}:${f.id}`);
      } catch (e) { emit({ warn: `Não consegui enviar ${f.name} ao computador: ${e.message}` }); }
    }
  }
  const ctx = {
    db,
    settings: s,
    computer,
    browser,
    remember: (t, tier = 'profile') => { if (s.memory) { db.memories.push({ id: id(), agentId: agent.id, text: t, tier: tier === 'log' ? 'log' : 'profile', createdAt: Date.now() }); save(); emit({ memory: t, tier }); } },
    inbox: {
      send: a => {
        const to = db.agents.find(x => x.name.toLowerCase() === String(a.to).trim().replace(/^@/, '').toLowerCase());
        const limits = { maxPerHour: 20, maxHops: 3, ...(s.inbox || {}) };
        const chk = checkSend({ from: agent, to, messages: db.messages, hops: hops + 1, limits });
        if (chk.error) return chk.error;
        const m = { id: id(), from: agent.id, to: to.id, body: String(a.message).slice(0, 4000), priority: a.priority || 'normal', status: 'queued', hops: hops + 1, originChatId: chat.id, createdAt: Date.now() };
        db.messages.push(m);
        if (db.messages.length > 1000) db.messages.splice(0, db.messages.length - 1000);
        save(); emit({ sent: { to: to.name, priority: m.priority } }); setTimeout(dispatchInbox, 50);
        return `Mensagem enviada para ${to.name}${m.priority === 'now' ? ' (urgente)' : ''}. A resposta aparece nesta conversa quando chegar; não espere por ela nem invente o que ${to.name} vai dizer.`;
      }
    },
    artifacts: {
      save: async a => {
        const scope = x => chat.projectId ? x.projectId === chat.projectId : x.chatId === chat.id;
        let art = db.artifacts.find(x => scope(x) && x.title.toLowerCase() === a.title.trim().toLowerCase());
        if (art) {
          art.kind = a.kind || art.kind;
          art.agentId = agent.id;
          art.version = (art.version || 1) + 1;
          art.updatedAt = Date.now();
          await persistArtifactContent(art, a.content);
        } else {
          art = { id: id(), projectId: chat.projectId || null, chatId: chat.id, agentId: agent.id, title: a.title.trim(), kind: a.kind || 'documento', content: '', version: 1, createdAt: Date.now(), updatedAt: Date.now() };
          db.artifacts.push(art);
          await persistArtifactContent(art, a.content);
        }
        save(); emit({ artifact: { id: art.id, title: art.title, version: art.version } });
        return `Artefato "${art.title}" salvo (versão ${art.version}).`;
      },
      read: async title => {
        const art = visibleArtifacts(chat).find(x => x.title.toLowerCase() === String(title).trim().toLowerCase());
        if (!art) return `Não há artefato "${title}". Existentes: ${visibleArtifacts(chat).map(x => x.title).join(', ') || 'nenhum'}.`;
        try { return await readArtifactContent(art); }
        catch (e) { return e.message; }
      }
    },
    skills: {
      use: async nm => {
        const hit = resolveSkillContent(nm, db, chat);
        return hit ? hit.content : `Skill "${nm}" não existe. Use list_skills para ver nomes disponíveis.`;
      },
      list: () => formatSkillsList(db, chat),
      save: a => {
        let k = db.skills.find(x => x.name.toLowerCase() === a.name.trim().toLowerCase() && (x.projectId || null) === (chat.projectId || null));
        if (k) Object.assign(k, { description: a.description, content: a.content, updatedAt: Date.now() });
        else { k = { id: id(), name: a.name.trim(), description: a.description, content: a.content, projectId: chat.projectId || null, createdBy: agent.id, createdAt: Date.now(), updatedAt: Date.now() }; db.skills.push(k); }
        save(); emit({ skill: k.name });
        return `Skill "${k.name}" salva.`;
      }
    },
    scheduleRoutine: a => { db.routines.push({ id: id(), agentId: agent.id, lastRun: 0, name: a.name, prompt: a.prompt, everyMinutes: a.everyMinutes, dailyAt: a.dailyAt, weekday: a.weekday }); save(); emit({ routine: a.name }); }
  };
  const project = chat.projectId && db.projects.find(p => p.id === chat.projectId);
  const system = [
    systemPrompt(agent, s, memories),
    await projectContext(project),
    visibleArtifacts(chat).length && `Artefatos do time (leia com read_artifact; salve entregas com save_artifact): ${visibleArtifacts(chat).slice(-20).map(x => `"${x.title}" (${x.kind}, v${x.version})`).join('; ')}`,
    (() => { const others = db.agents.filter(a => a.id !== agent.id && a.status !== 'paused'); return others.length ? `Colegas para mensagem assíncrona (send_message): ${others.map(a => `${a.name} (${a.description || a.category})`).join('; ')}.` : ''; })(),
    visibleSkills(chat).length ? `Skills no banco (use_skill / list_skills): ${visibleSkills(chat).map(k => `${k.name}: ${k.description}`).join(' | ')}` : 'Skills extras podem vir de skills/ ou ~/.cursor/skills-cursor — use list_skills. Quando um passo a passo funcionar, guarde com save_skill.',
    group && [
      `Você trabalha num time: ${group.map(a => `${a.name} (${a.description || a.category})`).join('; ')}.`,
      'Regras do time:',
      '1. Faça só o que é da sua função. Não faça o trabalho de um colega.',
      '2. Se o pedido (ou parte dele) é de outro, delegue escrevendo @Nome e o que precisa dele. Esse colega fala logo depois de você.',
      '3. Se você depende do trabalho de um colega que ainda não chegou, só delegue com @Nome e pare. Não responda antes da hora.',
      '4. Se não tem nada útil a acrescentar, responda exatamente: PASSO',
      '5. Para devolver a palavra a alguém, use @Nome. Sem @, ninguém é chamado.',
      '6. Não comece com o seu nome (a interface já mostra) e não repita o que já foi dito.'
    ].join('\n')
  ].filter(Boolean).join('\n\n');

  // A escolha da conversa vale para todos; sem ela, cada agente usa o seu padrão.
  const model = (chat.model && chat.model in MODELS ? chat.model : null) || agent.model || s.defaultModel;
  const effort = (chat.effort && chat.effort !== 'auto' ? chat.effort : null) || agent.effort || 'auto';
  const pick = model === 'auto' ? await route(text, history, s, { effort }) : { model, by: 'manual' };
  const routedBy = pick.by;
  // Sem o CLI do Codex instalado, o Auto nunca o escolhe (evita uma falha e um desvio a cada pedido de código).
  if (pick.model === 'codex' && !(await codexInstalled)) pick.model = 'claude-sonnet-5-5';
  emit({ route: { ...pick, effort } });

  const testProvider = process.env.RIPPER_TEST_PROVIDER;
  const order = testProvider
    ? [pick.model]
    : providerAttemptOrder(pick.model, await codexInstalled);
  const push = (out, steps, extra) => chat.messages.push({
    id: id(), role: 'assistant', agentId: agent.id, content: out, at: Date.now(),
    ...(steps.length ? { steps } : {}), ...extra
  });
  await runProviderAttemptLoop({
    order,
    signal,
    retry: normalizeProviderRetry(s),
    emit,
    runModel: m => {
      if (testProvider) return runTestProvider({ prompt, signal });
      const providerSystem = MODELS[m].provider === 'codex' && s.computer.mode !== 'local'
        ? `${system}\n\nNesta execução do Codex, o computador está em modo somente leitura; não prometa executar comandos nem acessar a VM Boat.` : system;
      const args = { agent, effort, prompt, images, history, system: providerSystem, settings: s, signal };
      return MODELS[m].provider === 'codex'
        ? runCodex({ ...args, cwd: sandboxDir(agent), ctx })
        : runClaude({ ...args, model: m, ctx });
    },
    onSuccess: ({ model: m, out, steps }) => {
      push(out, steps, { model: m, effort });
      recordUsage(db, m, { charsIn: (text?.length || 0) + (prompt?.length || 0), charsOut: out.length, routedBy });
      if (MODELS[m].provider === 'claude') {
        refreshClaudeSubscriptionUsage(db, s).then(() => save()).catch(() => {});
      }
    },
    onAttemptFailed: async ({ model: m, error: e, aborted, canFallback, out, steps }) => {
      if (aborted) { push(out, steps, { model: m, stopped: true }); return; }
      const prov = MODELS[m].provider;
      const limitSig = parseProviderLimitFromError(e);
      if (limitSig) {
        recordProviderSignal(db, prov, limitSig);
        save();
        emit({ quota: { provider: prov, ...limitSig } });
      }
      emit({ warn: `${MODELS[m].label} falhou: ${e.message}` });
      if (!canFallback) push(out, steps, { model: m, error: e.message });
    }
  });
}

async function chat({ chat, text, fileIds, signal, mcpSession }, emit) {
  chat.messages.push({ id: id(), role: 'user', content: text, files: fileIds?.length ? fileIds : undefined, at: Date.now() });
  const members = groupMembers(chat, db.agents);
  const group = members.length > 1 ? members : null;
  // Julia 1 (ou a heurística) escolhe quem abre; @menções definem a ordem; delegações entram na fila.
  const first = await selectSpeakers(chat, text, db.agents, (t, ms) => classifySpeaker(t, ms, db.settings, heuristicSpeaker));
  const floor = new Floor(first, members, group ? 5 : 1);
  if (group) emit({ turnPlan: turnPlanIds(first, floor) });
  for (let agent = floor.next(); agent; agent = floor.next()) {
    if (signal?.aborted) break;
    emit({ speaker: agent.id });
    await syncLocalFiles(agent, chat);
    const extra = await buildMessageAttachments(db, agent, chat, fileIds);
    for (const w of attachmentWarnings(extra)) emit({ warn: w });
    const before = chat.messages.length;
    await turn({ agent, chat, text, prompt: extra.text ? `${text}\n\n${extra.text}` : text, images: extra.images, signal, group, mcpSession }, emit);
    const reply = chat.messages.length > before ? chat.messages.at(-1) : null;
    if (group && reply && isPass(reply.content)) { chat.messages.pop(); emit({ passed: agent.id }); }
    else if (group && reply) {
      const next = floor.afterReply(agent, reply.content);
      if (next.length) {
        const ids = next.map(a => a.id);
        emit({ delegated: ids, agentHandoff: { from: agent.id, to: ids } });
      }
    }
    emit({ turnDone: agent.id });
    save();
  }
  if (chat.title === 'Nova conversa') chat.title = text.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Conversa';
  chat.updatedAt = Date.now();
  save();
}

// Estáticos do build do Vite: lidos uma vez, comprimidos uma vez, servidos com ETag.
const cache = new Map();
async function serveStatic(req, res, file) {
  let path = new URL('.' + decodeURIComponent(file), DIST);
  if (!path.href.startsWith(DIST.href)) throw new HttpError(400, 'Caminho inválido.');
  let st = await stat(path).catch(() => null);
  // Arquivo de build antigo (aba aberta antes de recompilar): 404 de verdade, nunca o HTML no lugar do JS.
  if (!st?.isFile() && file.startsWith('/assets/')) throw new HttpError(404, 'Arquivo de versão antiga.');
  if (!st?.isFile()) { path = new URL('index.html', DIST); file = '/index.html'; st = await stat(path).catch(() => null); } // SPA
  if (!st) throw new HttpError(503, 'Frontend não compilado. Rode `npm run build`.');
  let e = cache.get(file);
  if (!e || e.mtimeMs !== st.mtimeMs) {
    const buf = await readFile(path);
    e = { mtimeMs: st.mtimeMs, buf, gz: gzipSync(buf), etag: `"${st.mtimeMs.toString(36)}-${buf.length.toString(36)}"` };
    cache.set(file, e);
  }
  const immutable = file.startsWith('/assets/');
  const headers = { ...SECURITY, 'content-type': (MIME[extname(file)] || 'application/octet-stream') + (/\.(html|js|css)$/.test(file) ? '; charset=utf-8' : ''), etag: e.etag, 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', vary: 'accept-encoding' };
  if (req.headers['if-none-match'] === e.etag) { res.writeHead(304, headers); return res.end(); }
  const gz = /gzip/.test(req.headers['accept-encoding'] || '') && /\.(html|js|css|svg|json)$/.test(file);
  res.writeHead(200, gz ? { ...headers, 'content-encoding': 'gzip' } : headers);
  res.end(gz ? e.gz : e.buf);
}

const routes = [
  ['GET', /^\/api\/health$/, () => ({ ok: true })],
  ['GET', /^\/api\/diagnostics$/, async () => collectDiagnostics({
    db,
    settings: db.settings,
    host: HOST,
    port: PORT,
    tokenConfigured: !!TOKEN,
    frontendBuilt: existsSync(DIST),
    codexInstalled: () => codexInstalled,
    juliaStatus: async () => ({ online: await juliaOnline(db.settings), reason: juliaStatus.reason }),
    dockerProbe: () => dockerStatusCached(),
    activeChatCount: activeChatStreamCount(),
    pendingApprovals: db.approvals.filter(a => a.status === 'pending').length
  })],
  ['GET', /^\/api\/catalog$/, (req, m, url, res) => {
    json(res, { models: MODELS, templates: TEMPLATES, categories: CATEGORIES }, 200, { 'cache-control': 'public, max-age=3600' });
    return undefined;
  }],
  ['GET', /^\/api\/data\/backup$/, () => buildBackupPayload(db)],
  ['GET', /^\/api\/data\/backups$/, () => ({ auto: listAutoBackups() })],
  ['POST', /^\/api\/data\/restore$/, async req => {
    const b = await body(req);
    if (!b.confirm) throw new HttpError(400, 'Envie confirm: true para substituir o estado local.');
    const payload = b.backup && b.backup.db ? b.backup : b;
    return restoreBackupPayload(db, payload);
  }],
  ['GET', /^\/api\/state$/, () => ({
    settings: redact(db.settings), agents: db.agents, models: MODELS, templates: TEMPLATES, savedAgentTemplates: listAgentTemplates(db), categories: CATEGORIES,
    chats: db.chats.map(summary), routines: db.routines.map(redactRoutine),
    files: db.files.map(({ path, ...f }) => f), memoriesCount: db.memories.length, pendingInbox: db.messages.filter(m => m.status === 'queued' || m.status === 'delivering').reduce((o, m) => (o[m.originChatId] = (o[m.originChatId] || 0) + 1, o), {}), approvals: db.approvals.filter(a => a.status === 'pending').map(approvalView), artifacts: db.artifacts.map(({ content, size, blob, ...a }) => ({ ...a, size: size ?? content?.length ?? 0, stored: blob ? 'disk' : 'inline' })),     skills: db.skills, memoriesByAgent: db.memories.reduce((o, x) => (o[x.agentId] = (o[x.agentId] || 0) + 1, o), {}), projects: db.projects,
    usage: usageSummary(db),
    limits: accountLimits(db, db.settings),
    usageContract: (() => {
      const b = buildUsageContract(db, db.settings);
      return {
        contractVersion: b.contractVersion,
        summary: b.summary,
        accountUsage: b.accountUsage,
        providerSnapshot: b.providerSnapshot,
        contextWindow: { ...b.contextWindow, emptyLabel: 'sem dados', available: false, hasData: false }
      };
    })()
  })],
  ['GET', /^\/api\/usage$/, async (req, _, url) => {
    const chatId = url.searchParams.get('chatId') || undefined;
    await refreshClaudeSubscriptionUsage(db, db.settings).catch(() => {});
    save();
    return buildUsageContract(db, db.settings, { chatId, measures: usageContextMeasures(chatId) });
  }],
  ['GET', /^\/api\/usage\/limits$/, async () => {
    await refreshClaudeSubscriptionUsage(db, db.settings).catch(() => {});
    save();
    const bundle = buildUsageContract(db, db.settings);
    return {
      contractVersion: bundle.contractVersion,
      accountUsage: bundle.accountUsage,
      providerSnapshot: bundle.providerSnapshot,
      limits: bundle.limits
    };
  }],
  ['GET', /^\/api\/usage\/context$/, (req, _, url) => {
    const chatId = url.searchParams.get('chatId') || undefined;
    const raw = contextBreakdown(db, db.settings, { chatId, measures: usageContextMeasures(chatId) });
    return normalizeContextWindow(raw, { chatId });
  }],
  ['POST', /^\/api\/usage\/compact$/, async req => {
    const b = await body(req);
    if (!b.chatId) throw new HttpError(400, 'Informe chatId.');
    const out = compactChat(db, b.chatId);
    if (!out.ok) throw new HttpError(404, 'Conversa não encontrada.');
    save();
    return out;
  }],
  ['POST', /^\/api\/mcp\/verify$/, async req => {
    const b = await body(req);
    if (b.type === 'stdio' || b.command) {
      return verifyMcpConnector({
        name: String(b.name || 'probe'),
        type: 'stdio',
        command: String(b.command || ''),
        args: b.args || []
      }, { listTools: b.listTools !== false });
    }
    if (!b.url || !/^https:\/\//.test(String(b.url))) throw new HttpError(400, 'URL HTTPS do servidor MCP é obrigatória.');
    let plugin;
    if (b.pluginName) {
      plugin = (db.settings.plugins || []).find(p => p.name === b.pluginName);
    } else if (b.plugin && typeof b.plugin === 'object') {
      plugin = b.plugin;
    }
    return verifyMcpServer(b.url, { plugin, listTools: b.listTools !== false });
  }],
  ['GET', /^\/api\/mcp\/connectors$/, () => ({ connectors: listConnectorRecords(db.settings) })],
  ['POST', /^\/api\/mcp\/connectors$/, async req => {
    const b = await body(req);
    const prev = db.settings.plugins || [];
    let created;
    try {
      created = createPluginRecord(b, prev);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    if (b.auth) created.auth = mergePluginAuth(undefined, b.auth);
    if (b.headers && typeof b.headers === 'object') {
      created.headers = Object.fromEntries(Object.entries(b.headers).slice(0, 4).map(([k, v]) => [String(k).slice(0, 80), String(v).slice(0, 500)]));
    }
    db.settings.plugins = [...prev, created];
    save();
    return { connector: redactPlugin(created) };
  }],
  ['PUT', /^\/api\/mcp\/connectors\/([\w-]{1,40})$/, async (req, [name]) => {
    const idx = (db.settings.plugins || []).findIndex(p => p.name === name);
    if (idx < 0) throw new HttpError(404, 'Conector não encontrado.');
    const b = await body(req);
    const prev = db.settings.plugins[idx];
    let next = updatePluginRecord(prev, b);
    if (b.auth) next.auth = mergePluginAuth(prev.auth, b.auth);
    if (b.headers) {
      next.headers = Object.fromEntries(
        (Array.isArray(b.headers)
          ? b.headers.filter(h => h?.name).map(h => [String(h.name).slice(0, 80), String(h.value || '').slice(0, 500)])
          : Object.entries(b.headers)
        ).slice(0, 4)
      );
    }
    db.settings.plugins[idx] = next;
    save();
    return { connector: redactPlugin(next), authStatus: pluginOAuthStatus(next) };
  }],
  ['DELETE', /^\/api\/mcp\/connectors\/([\w-]{1,40})$/, (req, [name]) => {
    const before = (db.settings.plugins || []).length;
    db.settings.plugins = (db.settings.plugins || []).filter(p => p.name !== name);
    if (db.settings.plugins.length === before) throw new HttpError(404, 'Conector não encontrado.');
    save();
    return { ok: true };
  }],
  ['GET', /^\/api\/mcp\/tools$/, async (req, _, url) => {
    let mcpSession;
    const raw = url.searchParams.get('mcpSession');
    if (raw) {
      try { mcpSession = JSON.parse(raw); } catch { throw new HttpError(400, 'mcpSession JSON inválido.'); }
    }
    return listMcpToolCatalog(db.settings, mcpSession);
  }],
  ['POST', /^\/api\/mcp\/tools$/, async req => {
    const b = await body(req);
    return listMcpToolCatalog(db.settings, b.mcpSession);
  }],
  ['GET', /^\/api\/mcp\/session\/connectors$/, (req, _, url) => {
    let mcpSession;
    const raw = url.searchParams.get('mcpSession');
    if (raw) {
      try { mcpSession = JSON.parse(raw); } catch { throw new HttpError(400, 'mcpSession JSON inválido.'); }
    }
    const s = settingsForMcp(db.settings, mcpSession);
    return {
      connectors: listConnectorRecords(s),
      active: activePlugins(db.settings, mcpSession).map(p => p.name)
    };
  }],
  ['POST', /^\/api\/mcp\/oauth\/refresh$/, async req => {
    const b = await body(req);
    const name = String(b.pluginName || '').trim();
    if (!name) throw new HttpError(400, 'Informe pluginName.');
    try {
      const out = await refreshConnectorOAuth(db, name);
      save();
      return out;
    } catch (e) {
      throw new HttpError(400, e.message || 'Falha ao atualizar OAuth.');
    }
  }],
  ['POST', /^\/api\/mcp\/oauth\/start$/, async (req, _, url) => {
    const b = await body(req);
    const name = String(b.pluginName || '').trim();
    if (!name) throw new HttpError(400, 'Informe pluginName.');
    const plugin = (db.settings.plugins || []).find(p => p.name === name && p.type === 'http');
    if (!plugin) throw new HttpError(404, 'Conector HTTP não encontrado.');
    const mcpUrl = String(b.url || plugin.url || '');
    if (!/^https:\/\//.test(mcpUrl)) throw new HttpError(400, 'URL MCP HTTPS inválida.');
    let discovery = b.discovery;
    if (!discovery?.authorizationServer) {
      const probe = await fetch(mcpUrl, { method: 'GET', headers: { accept: 'application/json' } }).catch(() => null);
      discovery = await discoverMcpOAuth(mcpUrl, { probeHeaders: probe?.headers });
    }
    if (!discovery?.authorizationServer) throw new HttpError(400, 'Não foi possível obter metadados OAuth deste servidor.');
    const redirectUri = oauthRedirectUri(publicBaseUrl(req));
    const started = await startMcpOAuthFlow({ plugin, discovery, redirectUri });
    return { ...started, redirectUri };
  }],
  ['GET', /^\/api\/mcp\/oauth\/status\/([\w-]+)$/, (req, [flowId]) => {
    const flow = getOAuthFlow(flowId);
    if (!flow) throw new HttpError(404, 'Fluxo OAuth não encontrado ou expirado.');
    const plugin = (db.settings.plugins || []).find(p => p.name === flow.pluginName);
    return {
      flowId,
      status: flow.status,
      pluginName: flow.pluginName,
      error: flow.error || undefined,
      authStatus: plugin ? pluginOAuthStatus(plugin) : undefined
    };
  }],
  ['GET', /^\/api\/settings$/, () => ({ settings: redact(db.settings), meta: settingsMeta() })],
  ['PUT', /^\/api\/settings$/, async req => {
    const b = await body(req), s = db.settings;
    try {
      applySettingsPatch(s, b);
      applyPluginsPatch(s, b.plugins, { mergePluginAuth });
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    save(); return redact(s);
  }],
  ['GET', /^\/api\/audit$/, (req, _, url) => ({
    entries: listAudit(db, { limit: +(url.searchParams.get('limit') || 50) })
  })],
  ['GET', /^\/api\/audit-trail$/, (req, _, url) => ({
    store: 'local',
    worm: false,
    entryCount: (db.auditLog || []).length,
    entries: listAudit(db, { limit: +(url.searchParams.get('limit') || 50) })
  })],
  ['GET', /^\/api\/lgpd\/status$/, () => buildLgpdStatus({ settings: db.settings })],
  ['GET', /^\/api\/admin\/overview$/, () => {
    if (!isEnterpriseMode(db.settings)) throw new HttpError(403, 'Centro admin disponível apenas no modo enterprise.');
    return buildAdminOverview(db, db.settings);
  }],
  ['GET', /^\/api\/artifacts\/([\w-]+)\/download$/, async (req, [aid], url, res) => {
    const a = db.artifacts.find(x => x.id === aid);
    if (!a) throw new HttpError(404, 'Artefato não encontrado.');
    let content;
    try { content = await readArtifactContent(a); }
    catch (e) { throw new HttpError(404, e.message); }
    const name = artifactDownloadName(a);
    res.writeHead(200, { ...SECURITY, 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'cache-control': 'private, max-age=60' });
    res.end(content);
  }],
  ['GET', /^\/api\/artifacts\/([\w-]+)$/, async (req, [aid]) => {
    const a = db.artifacts.find(x => x.id === aid);
    if (!a) throw new HttpError(404, 'Artefato não encontrado.');
    const content = await readArtifactContent(a).catch(e => { throw new HttpError(404, e.message); });
    return { ...a, content };
  }],
  ['PUT', /^\/api\/artifacts\/([\w-]+)$/, async (req, [aid]) => {
    const a = db.artifacts.find(x => x.id === aid); if (!a) throw new HttpError(404, 'Artefato não encontrado.');
    const b = await body(req);
    if (typeof b.title === 'string' && b.title.trim()) a.title = b.title.trim().slice(0, 120);
    if (typeof b.content === 'string') {
      a.version = (a.version || 1) + 1;
      await persistArtifactContent(a, b.content);
    }
    a.updatedAt = Date.now(); save(); return { ...a, content: await readArtifactContent(a) };
  }],
  ['DELETE', /^\/api\/artifacts\/([\w-]+)$/, async (req, [aid]) => {
    const a = db.artifacts.find(x => x.id === aid);
    db.artifacts = db.artifacts.filter(x => x.id !== aid);
    if (a) await deleteArtifactStorage(a);
    save(); return {};
  }],
  ['GET', /^\/api\/skills\/catalog$/, (req, _, url) => {
    const chat = url.searchParams.get('chatId') ? db.chats.find(c => c.id === url.searchParams.get('chatId')) : null;
    return { skills: listSkillsCatalog(db, chat) };
  }],
  ['POST', /^\/api\/skills$/, async req => {
    const b = await body(req);
    if (!b.name?.trim() || !b.content?.trim()) throw new HttpError(400, 'Skill precisa de nome e conteúdo.');
    const k = { id: id(), name: b.name.trim().slice(0, 60), description: String(b.description || '').slice(0, 200), content: b.content.slice(0, 20000), projectId: b.projectId || null, createdBy: 'user', createdAt: Date.now(), updatedAt: Date.now() };
    db.skills.push(k); save(); return k;
  }],
  ['PUT', /^\/api\/skills\/([\w-]+)$/, async (req, [kid]) => {
    const k = db.skills.find(x => x.id === kid); if (!k) throw new HttpError(404, 'Skill não encontrada.');
    const b = await body(req);
    for (const f of ['name', 'description', 'content']) if (typeof b[f] === 'string') k[f] = b[f].slice(0, f === 'content' ? 20000 : 200);
    k.updatedAt = Date.now(); save(); return k;
  }],
  ['DELETE', /^\/api\/skills\/([\w-]+)$/, (req, [kid]) => { db.skills = db.skills.filter(k => k.id !== kid); save(); return {}; }],
  ['GET', /^\/api\/julia\/status$/, async () => {
    const online = await juliaOnline(db.settings);
    return { online, url: db.settings.julia.url, reason: online ? 'ok' : (juliaStatus.reason || 'offline') };
  }],
  ['POST', /^\/api\/computer\/cleanup$/, async () => {
    const report = await startupStorageCleanup(db);
    if (report.files?.removedRecords?.length) save();
    return report;
  }],
  ['GET', /^\/api\/computer\/docker$/, async () => dockerStatusCached()],
  ['POST', /^\/api\/computer\/image$/, async () => { ensureImage().catch(e => console.error('imagem', e.message)); return { image: await imageStatus() }; }],
  ['GET', /^\/api\/agents\/([\w-]+)\/vnc$/, async (req, [aid]) => {
    const a = agentOr404(aid);
    if (db.settings.computer.mode !== 'docker') throw new HttpError(409, 'A tela ao vivo precisa do computador em modo Docker.');
    const pc = computerFor(a, db.settings, save);
    const sc = await pc.screen();
    if (!sc) throw new HttpError(503, 'A tela ainda não subiu. Tente de novo em alguns segundos.');
    return { url: `http://127.0.0.1:${sc.port}/vnc.html?autoconnect=1&resize=scale&reconnect=1&show_dot=1`, port: sc.port };
  }],
  ['GET', /^\/api\/messages$/, () => db.messages.slice(-100).reverse().map(m => ({ ...m, fromName: db.agents.find(a => a.id === m.from)?.name, toName: db.agents.find(a => a.id === m.to)?.name }))],
  ['GET', /^\/api\/approvals$/, () => ({
    pending: db.approvals.filter(a => a.status === 'pending').map(approvalView),
    recent: db.approvals.filter(a => a.status !== 'pending').slice(-30).reverse().map(approvalView)
  })],
  ['POST', /^\/api\/approvals\/([\w-]+)$/, async (req, [aid]) => {
    const b = await body(req);
    // Pedido que já não está esperando (servidor reiniciou, expirou): fecha no histórico.
    if (!gate.decide(aid, !!b.approve, { remember: !!b.remember })) {
      const rec = db.approvals.find(a => a.id === aid);
      if (rec?.status === 'pending') { rec.status = 'expired'; rec.decidedAt = Date.now(); save(); }
      throw new HttpError(409, 'Este pedido não está mais aguardando.');
    }
    return { ok: true };
  }],
  ['GET', /^\/api\/projects$/, () => db.projects.map(p => ({
    ...p,
    chatCount: db.chats.filter(c => c.projectId === p.id).length
  }))],
  ['GET', /^\/api\/projects\/([\w-]+)$/, (req, [pid]) => {
    const p = projectOr404(pid);
    return {
      ...p,
      chatCount: db.chats.filter(c => c.projectId === p.id).length,
      fileCount: db.files.filter(f => f.projectId === p.id).length
    };
  }],
  ['POST', /^\/api\/projects$/, async req => {
    const b = await body(req);
    if (typeof b.name === 'string' && !b.name.trim()) throw new HttpError(400, 'Informe o nome do projeto.');
    const p = patchProject({ id: id(), name: 'Novo projeto', description: '', instructions: '', agentIds: [], createdAt: Date.now() }, b);
    db.projects.unshift(p); save(); return p;
  }],
  ['PUT', /^\/api\/projects\/([\w-]+)$/, async (req, [pid]) => { const p = patchProject(projectOr404(pid), await body(req)); save(); return p; }],
  ['DELETE', /^\/api\/projects\/([\w-]+)$/, async (req, [pid]) => {
    projectOr404(pid);
    // Conversas ficam (sem projeto); arquivos só do projeto saem do disco.
    for (const f of db.files.filter(f => f.projectId === pid && !f.agentId)) await unlink(dataUrl(f.path)).catch(() => {});
    db.files = db.files.filter(f => !(f.projectId === pid && !f.agentId));
    db.chats.forEach(c => { if (c.projectId === pid) delete c.projectId; });
    db.projects = db.projects.filter(p => p.id !== pid);
    removeProjectSandboxDir(pid);
    save(); return {};
  }],
  ['GET', /^\/api\/agent-templates$/, () => listAgentTemplates(db)],
  ['POST', /^\/api\/agent-templates$/, async req => {
    const b = await body(req);
    if (!String(b.name || '').trim()) throw new HttpError(400, 'Informe o nome do modelo.');
    const t = createSavedTemplate(db, b, { id: id() });
    save();
    return t;
  }],
  ['PUT', /^\/api\/agent-templates\/([\w-]+)$/, async (req, [tid]) => {
    const t = (db.agentTemplates || []).find(x => x.id === tid);
    if (!t) throw new HttpError(404, 'Modelo não encontrado.');
    patchSavedTemplate(t, await body(req));
    save();
    return t;
  }],
  ['DELETE', /^\/api\/agent-templates\/([\w-]+)$/, (req, [tid]) => {
    db.agentTemplates = (db.agentTemplates || []).filter(x => x.id !== tid);
    save();
    return {};
  }],
  ['POST', /^\/api\/agents$/, async req => {
    const b = await body(req);
    let a;
    if (b.savedTemplateId) {
      a = agentFromSavedTemplate(db, b.savedTemplateId, b, TEMPLATES);
    } else {
      const t = TEMPLATES.find(t => t.id === b.templateId);
      a = patchAgent(newAgent({ ...(t || {}), templateId: t?.id }), b);
    }
    db.agents.push(a); save(); return a;
  }],
  ['PUT', /^\/api\/agents\/([\w-]+)$/, async (req, [aid]) => {
    const b = await body(req);
    if (b.autonomyLevel) b.autonomyLevel = sanitizeAutonomyLevel(b.autonomyLevel, db.settings);
    const a = patchAgent(agentOr404(aid), b);
    save();
    return a;
  }],
  ['DELETE', /^\/api\/agents\/([\w-]+)$/, async (req, [aid]) => {
    const a = agentOr404(aid);
    if (db.agents.length === 1) throw new HttpError(409, 'Mantenha pelo menos um agente.');
    browsers.delete(aid);
    clearBoatIdleTimer(aid);
    if (db.settings.computer.mode === 'boat') await releaseBoatSandbox(a, db.settings, save);
    await cleanupAgentResources(a, db.settings);
    for (const art of db.artifacts.filter(x => x.agentId === aid)) await deleteArtifactStorage(art);
    db.artifacts = db.artifacts.filter(x => x.agentId !== aid);
    for (const f of db.files.filter(f => f.agentId === aid)) await unlink(dataUrl(f.path)).catch(() => {});
    db.files = db.files.filter(f => f.agentId !== aid);
    db.agents = db.agents.filter(x => x.id !== aid);
    db.routines = db.routines.filter(r => r.agentId !== aid);
    db.projects.forEach(p => { p.agentIds = p.agentIds.filter(x => x !== aid); });
    save(); return {};
  }],
  ['GET', /^\/api\/agents\/([\w-]+)\/computer$/, async (req, [aid]) => {
    const a = agentOr404(aid);
    if (!a.tools.includes('computer')) return { status: 'off' };
    try { const c = computerFor(a, db.settings, save); return { status: c ? await c.status() : 'off', kind: c?.kind }; }
    catch { return { status: 'no key' }; }
  }],
  ['GET', /^\/api\/agents\/([\w-]+)\/screen$/, async (req, [aid], url, res) => {
    agentOr404(aid);
    const file = dataUrl(`sandbox/${aid}/.ripper/screen.jpg`);
    const st = await stat(file).catch(() => null);
    if (!st) throw new HttpError(404, 'Sem tela ainda.');
    res.writeHead(200, { ...SECURITY, 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'last-modified': st.mtime.toUTCString() });
    res.end(await readFile(file));
  }],
  ['GET', /^\/api\/agents\/([\w-]+)\/memories$/, (req, [aid]) => db.memories.filter(x => x.agentId === aid)],
  ['PUT', /^\/api\/memories\/([\w-]+)$/, async (req, [mid]) => {
    const m = db.memories.find(x => x.id === mid); if (!m) throw new HttpError(404, 'Memória não encontrada.');
    const b = await body(req);
    if (b.tier === 'profile' || b.tier === 'log') m.tier = b.tier;
    if (typeof b.text === 'string' && b.text.trim()) m.text = b.text.trim().slice(0, 500);
    save(); return m;
  }],
  ['DELETE', /^\/api\/memories\/([\w-]+)$/, (req, [mid]) => { db.memories = db.memories.filter(x => x.id !== mid); save(); return {}; }],
  ['POST', /^\/api\/routines$/, async req => {
    const b = await body(req); agentOr404(b.agentId);
    if (!b.prompt) throw new HttpError(400, 'Diga o que a rotina deve fazer.');
    const r = { id: id(), agentId: b.agentId, name: String(b.name || 'Rotina').slice(0, 80), prompt: String(b.prompt).slice(0, 4000), lastRun: 0, lastStatus: 'never', lastError: null,
      quiet: b.quiet !== false,
      ...(b.trigger === 'webhook' ? { trigger: 'webhook', hookToken: newHookToken(), hookSecret: String(b.hookSecret || '').slice(0, 200) || undefined }
        : b.everyMinutes ? { everyMinutes: Math.max(5, +b.everyMinutes) } : { dailyAt: /^\d\d:\d\d$/.test(b.dailyAt) ? b.dailyAt : '08:00', weekday: b.weekday ?? undefined }) };
    db.routines.push(r); save(); return redactRoutine(r);
  }],
  ['DELETE', /^\/api\/routines\/([\w-]+)$/, (req, [rid]) => { db.routines = db.routines.filter(x => x.id !== rid); save(); return {}; }],
  ['GET', /^\/api\/chats$/, (req, _, url) => {
    const q = url.searchParams.get('q') || '';
    const agentId = url.searchParams.get('agentId') || undefined;
    const limit = url.searchParams.get('limit');
    const cursor = url.searchParams.get('cursor') || undefined;
    const page = listChatsPage(db.chats, { q, agentId, limit: limit ? +limit : 30, cursor });
    return {
      items: page.items.map(summary),
      nextCursor: page.nextCursor,
      total: page.total
    };
  }],
  ['GET', /^\/api\/inbox$/, () => ({
    summary: inboxSummary(db.messages),
    pending: db.messages.filter(m => m.status === 'queued' || m.status === 'delivering').map(m => ({
      ...m,
      fromName: db.agents.find(a => a.id === m.from)?.name,
      toName: db.agents.find(a => a.id === m.to)?.name
    }))
  })],
  ['GET', /^\/api\/chats\/([\w-]+)$/, (req, [cid]) => {
    const c = db.chats.find(c => c.id === cid);
    if (!c) throw new HttpError(404, 'Conversa não encontrada.');
    if (c.unread) { c.unread = false; save(); }
    return { ...c, streaming: isChatStreaming(cid) };
  }],
  ['GET', /^\/api\/chats\/([\w-]+)\/export$/, (req, [cid]) => {
    const c = db.chats.find(c => c.id === cid);
    if (!c) throw new HttpError(404, 'Conversa não encontrada.');
    return exportChatPayload(c);
  }],
  ['POST', /^\/api\/chats\/import$/, async req => {
    const b = await body(req);
    const { chat, warnings } = importChatPayload(db, b, { agentId: b.agentId, projectId: b.projectId, id });
    db.chats.unshift(chat);
    save();
    return { chat: summary(chat), warnings };
  }],
  ['PUT', /^\/api\/chats\/([\w-]+)$/, async (req, [cid]) => {
    const c = db.chats.find(c => c.id === cid); if (!c) throw new HttpError(404, 'Conversa não encontrada.');
    const b = await body(req);
    if (typeof b.title === 'string' && b.title.trim()) c.title = b.title.trim().slice(0, 80);
    if (b.projectId === null) delete c.projectId;
    else if (typeof b.projectId === 'string' && b.projectId) {
      const p = projectOr404(b.projectId);
      const aids = c.agentIds || [c.agentId];
      if (aids.some(a => !p.agentIds.includes(a))) throw new HttpError(400, 'Agente da conversa não está no projeto.');
      c.projectId = p.id;
    }
    c.updatedAt = Date.now();
    save(); return summary(c);
  }],
  ['POST', /^\/api\/chats\/([\w-]+)\/cancel$/, (req, [cid]) => {
    db.chats.find(c => c.id === cid) || (() => { throw new HttpError(404, 'Conversa não encontrada.'); })();
    if (!cancelChatStream(cid)) throw new HttpError(404, 'Nenhuma resposta em andamento.');
    return { ok: true };
  }],
  ['DELETE', /^\/api\/chats\/([\w-]+)$/, (req, [cid]) => { if (isChatStreaming(cid)) throw new HttpError(409, 'Aguarde a resposta terminar.'); db.chats = db.chats.filter(c => c.id !== cid); save(); return {}; }],
  ['POST', /^\/api\/files$/, async (req, _, url) => {
    // Arquivo de um agente, ou de um projeto (visível a todos os agentes membros).
    const chatRef = db.chats.find(c => c.id === url.searchParams.get('chatId'));
    const pid = url.searchParams.get('projectId') || chatRef?.projectId || null;
    const project = pid ? projectOr404(pid) : null;
    const agentParam = url.searchParams.get('agentId');
    if (!project && !agentParam) throw new HttpError(400, 'Informe agentId ou projectId (ou envie chatId ligado a um projeto) para anexar arquivos.');
    const a = project && !agentParam ? null : agentOr404(agentParam);
    const batch = Math.max(1, +(url.searchParams.get('batch') || 1));
    if (batch > MAX_FOLDER_FILES) throw new HttpError(400, `Pastas grandes demais: máximo ${MAX_FOLDER_FILES} arquivos por lote.`);
    const name = basename(String(url.searchParams.get('name') || 'arquivo')).replace(/[^\w.\- ()À-ú]/g, '_').slice(0, 120);
    const buf = await raw(req, MAX_FILE);
    if (!buf.length) throw new HttpError(400, 'Arquivo vazio.');
    const fid = id();
    const folder = project ? `project-${project.id}` : a.id;
    mkdirSync(dataUrl(`sandbox/${folder}/uploads/`), { recursive: true });
    const rel = `sandbox/${folder}/uploads/${fid.slice(0, 8)}-${name}`;
    await writeFile(dataUrl(rel), buf);
    const f = { id: fid, agentId: a?.id || null, projectId: project?.id || null, chatId: url.searchParams.get('chatId') || null, name, type: String(req.headers['content-type'] || 'application/octet-stream').slice(0, 100), size: buf.length, path: rel, createdAt: Date.now() };
    db.files.push(f); save();
    const { path, ...pub } = f; return pub;
  }],
  ['GET', /^\/api\/files\/([\w-]+)$/, async (req, [fid], url, res) => {
    const f = db.files.find(x => x.id === fid); if (!f) throw new HttpError(404, 'Arquivo não encontrado.');
    let buf;
    try { buf = await readFile(dataUrl(f.path)); }
    catch { throw new HttpError(404, 'Arquivo ausente no disco (registro removido na próxima limpeza).'); }
    const inline = /^image\/(png|jpe?g|webp|gif)$/.test(f.type);
    res.writeHead(200, { ...SECURITY, 'content-type': inline ? f.type : 'application/octet-stream', 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'cache-control': 'private, max-age=3600' });
    res.end(buf);
  }],
  ['DELETE', /^\/api\/files\/([\w-]+)$/, async (req, [fid]) => {
    const f = db.files.find(x => x.id === fid); if (!f) return {};
    db.files = db.files.filter(x => x !== f); save();
    await unlink(dataUrl(f.path)).catch(() => {});
    return {};
  }],
  ['POST', /^\/api\/chat$/, async (req, _, url, res) => {
    const b = await body(req);
    let c = db.chats.find(x => x.id === b.chatId);
    const project = (c?.projectId || b.projectId) ? projectOr404(c?.projectId || b.projectId) : null;
    // Participantes: conversa existente manda; nova conversa usa agentIds (grupo) ou agentId (individual).
    const agentIds = c ? (c.agentIds || [c.agentId]) : [...new Set(Array.isArray(b.agentIds) && b.agentIds.length ? b.agentIds : [b.agentId])];
    agentIds.forEach(agentOr404);
    if (project && !c && agentIds.some(a => !project.agentIds.includes(a))) throw new HttpError(400, 'Agente fora do projeto.');
    const agent = agentOr404(agentIds[0]);
    const text = String(b.text || '').trim().slice(0, 32000) || 'Veja o anexo.';
    if (!text && !(b.fileIds || []).length) throw new HttpError(400, 'Mensagem vazia.');
    if (b.model && b.model !== 'agent' && !(b.model in MODELS)) throw new HttpError(400, 'Modelo desconhecido.');
    if (b.effort && !EFFORTS.includes(b.effort)) throw new HttpError(400, 'Esforço desconhecido.');
    if (!c) {
      c = { id: id(), agentId: agent.id, title: 'Nova conversa', messages: [], createdAt: Date.now(), updatedAt: Date.now(),
        ...(project ? { projectId: project.id } : {}), ...(agentIds.length > 1 ? { agentIds } : {}) };
      db.chats.unshift(c);
    }
    if (isChatStreaming(c.id)) throw new HttpError(409, 'Esta conversa já está respondendo. Aguarde ou interrompa a resposta atual.');
    const quota = checkSendQuota(db);
    if (quota.blocked) throw new HttpError(429, quota.userMessage);
    const fileIds = (b.fileIds || []).filter(fid => db.files.some(f => f.id === fid && agentIds.some(a => canUseFile(f, { id: a }, c))));
    for (const fid of fileIds) { const f = db.files.find(x => x.id === fid); if (f && !f.chatId) f.chatId = c.id; }
    res.writeHead(200, { ...SECURITY, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
    const emit = e => res.writable && res.write(`data: ${JSON.stringify(redactSseEvent(e))}\n\n`);
    emit({ chatId: c.id });
    const clientAc = new AbortController();
    res.on('close', () => { if (!res.writableFinished) clientAc.abort(); });
    const { signal } = registerChatStream(c.id, { signal: clientAc.signal, emit });
    const ping = setInterval(() => res.writable && res.write(': ping\n\n'), 15_000);
    // Modelo e esforço ficam gravados na conversa ('agent' = usar o padrão de cada agente).
    if (b.model) c.model = b.model === 'agent' ? undefined : b.model;
    if (b.effort) c.effort = b.effort;
    try { await chat({ chat: c, text, fileIds, signal, mcpSession: b.mcpSession }, emit); }
    finally { clearInterval(ping); unregisterChatStream(c.id); save(); }
    emit({ done: true, title: c.title }); res.end();
    return undefined;
  }]
];

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (TOKEN && url.searchParams.get('token') === TOKEN) {
      res.writeHead(302, { 'set-cookie': `ripper_token=${encodeURIComponent(TOKEN)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`, location: '/' });
      return res.end();
    }
    const hook = req.method === 'POST' && /^\/api\/hooks\/([a-f0-9]{48})$/.exec(p);
    if (hook) {
      const r = db.routines.find(x => x.trigger === 'webhook' && x.hookToken === hook[1]);
      if (!r) throw new HttpError(404, 'Webhook desconhecido.');
      const raw = (await body.raw(req)).toString('utf8');
      if (!verifySignature(r.hookSecret, raw, req.headers['x-hub-signature-256'])) throw new HttpError(401, 'Assinatura inválida.');
      const meta = eventMeta(req.headers);
      if (meta.type === 'ping') return json(res, { ok: true, pong: true });
      const started = runRoutine(r, { ...meta, body: summarizeEvent(raw) });
      return json(res, { ok: true, started }, started ? 202 : 429);
    }
    if (req.method === 'GET' && p === '/api/mcp/oauth/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state') || '';
      const err = url.searchParams.get('error');
      const flow = findOAuthFlowByState(state);
      if (!flow) {
        res.writeHead(400, { ...SECURITY, 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><meta charset=utf-8><title>Ripper OAuth</title><p>Fluxo inválido ou expirado. Feche esta janela e tente de novo no Ripper.</p>');
        return;
      }
      if (err) {
        flow.status = 'error';
        flow.error = url.searchParams.get('error_description') || err;
        res.writeHead(400, { ...SECURITY, 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset=utf-8><title>Ripper OAuth</title><p>Login negado: ${flow.error}</p><script>setTimeout(()=>window.close(),1200)</script>`);
        return;
      }
      if (!code) {
        res.writeHead(400, { ...SECURITY, 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><meta charset=utf-8><title>Ripper OAuth</title><p>Código OAuth ausente.</p>');
        return;
      }
      try {
        const tokens = await exchangeOAuthCode(flow, code);
        const idx = (db.settings.plugins || []).findIndex(p => p.name === flow.pluginName);
        if (idx >= 0) {
          db.settings.plugins[idx] = applyOAuthTokensToPlugin(db.settings.plugins[idx], tokens, flow);
          save();
        }
        flow.status = 'complete';
        res.writeHead(200, { ...SECURITY, 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><meta charset=utf-8><title>Ripper OAuth</title><p>Login concluído. Você pode fechar esta janela.</p><script>setTimeout(()=>window.close(),800)</script>');
      } catch (e) {
        flow.status = 'error';
        flow.error = e.message;
        res.writeHead(500, { ...SECURITY, 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><meta charset=utf-8><title>Ripper OAuth</title><p>Falha ao trocar o código por token. Veja o Ripper e tente novamente.</p>');
      }
      return;
    }
    if (p.startsWith('/api/')) {
      if (!authed(req)) throw new HttpError(401, 'Não autorizado. Abra o Ripper com ?token=<RIPPER_TOKEN>.');
      // Bloqueia requisições de outros sites (CSRF) nas rotas que mudam estado.
      if (req.method !== 'GET' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new HttpError(403, 'Origem não permitida.');
      for (const [method, re, fn] of routes) {
        const m = req.method === method && re.exec(p);
        if (!m) continue;
        const out = await fn(req, m.slice(1), url, res);
        if (out !== undefined && !res.headersSent) json(res, out);
        return;
      }
      throw new HttpError(404, 'Rota não encontrada.');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método não permitido.');
    return await serveStatic(req, res, p === '/' ? '/index.html' : p);
  } catch (e) {
    const code = e instanceof HttpError ? e.code : 500;
    if (code === 500) console.error(...redactForLog(e?.stack || e?.message || String(e)));
    if (!res.headersSent) json(res, { error: code === 500 ? 'Erro interno. Veja o log do servidor.' : e.message }, code); else res.end();
  }
}).listen(PORT, HOST, () => console.log(`Ripper em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));

// Rotinas: o agente dono acorda (por horário ou evento), executa e só deixa conversa se houver novidade.
function runRoutine(r, event) {
  const agent = db.agents.find(a => a.id === r.agentId);
  if (!agent || agent.status === 'paused' || r.lastStatus === 'running') return false;
  if (!tryClaimRoutine(r.id)) return false;
  r.lastRun = Date.now(); r.lastStatus = 'running'; r.lastError = null; save();
  const c = { id: id(), agentId: agent.id, title: event ? `${r.name} · ${event.source}${event.type ? ' ' + event.type : ''}` : r.name, routineId: r.id, messages: [], createdAt: Date.now(), updatedAt: Date.now() };
  db.chats.unshift(c);
  chat({ chat: c, text: routinePrompt(r, event) }, () => {}).then(async () => {
    const replies = c.messages.filter(m => m.role === 'assistant');
    const failed = replies.find(m => m.error)?.error;
    let verdict = null;
    if (!failed && replies.length && r.quiet !== false) {
      const notifyCtx = `Rotina "${r.name}": ${r.prompt}`;
      const notifyQ = replies.map(m => m.content).join('\n').slice(0, 1500);
      const j = await juliaChoose(db.settings, { context: notifyCtx, question: notifyQ, options: NOTIFY_OPTIONS }, {
        minScore: 0.55,
        purpose: 'notify',
        avoidedPromptChars: measureTriagePromptChars({ context: notifyCtx, question: notifyQ, options: NOTIFY_OPTIONS })
      });
      verdict = j ? ['notify', 'silence', 'escalate'][j.index] : null;
    }
    if (verdict === 'escalate') c.urgent = true;
    if (!failed && replies.length && (verdict === 'silence' || (!verdict && replies.every(m => isNothingNew(m.content))))) {
      db.chats = db.chats.filter(x => x !== c);               // nada novo: não polui a lista
      r.lastStatus = 'quiet';
    } else {
      c.unread = true;                                        // novidade: aparece como não lida
      r.lastStatus = failed ? 'failed' : 'succeeded'; r.lastError = failed || null;
    }
    r.lastChatId = r.lastStatus === 'quiet' ? r.lastChatId : c.id;
    save();
  }).catch(e => { r.lastStatus = 'failed'; r.lastError = e.message; save(); console.error('rotina', r.name, ...redactForLog(e.message)); })
    .finally(() => releaseRoutineClaim(r.id));
  return true;
}

setInterval(() => {
  const now = new Date();
  for (const r of db.routines) if (routineDue(r, now)) runRoutine(r);
}, 30_000);

process.on('unhandledRejection', e => console.error('unhandledRejection', ...redactForLog(e?.message || String(e))));
if (!existsSync(DIST)) console.warn('Aviso: frontend não compilado. Rode `npm run build`.');
