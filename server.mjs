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
import { needsApproval, ApprovalGate } from './lib/approvals.mjs';
import { juliaOnline, juliaChoose, juliaStatus, RISK_OPTIONS, NOTIFY_OPTIONS } from './lib/julia.mjs';
import { checkSend, dueMessages, threadKey, inboxPrompt } from './lib/inbox.mjs';
import { browserFor, browserRisk } from './lib/browser.mjs';
import { runClaude, runCodex, systemPrompt } from './lib/providers.mjs';
import { TEMPLATES, CATEGORIES } from './lib/templates.mjs';
import { canUseFile, selectSpeakers, routineDue, mayFallback, Floor, isPass, heuristicSpeaker, groupMembers, trimHistory, isNothingNew, routinePrompt, summarizeEvent } from './lib/agent-flow.mjs';
import { newHookToken, verifySignature, eventMeta } from './lib/hooks.mjs';
import { recordUsage, usageSummary, accountLimits, contextBreakdown, checkSendQuota, compactChat } from './lib/usage.mjs';
import { verifyMcpServer } from './lib/mcp-probe.mjs';

function settingsForMcp(s, mcpSession) {
  if (!mcpSession) return s;
  const disabled = new Set(mcpSession.disabledPlugins || []);
  return {
    ...s,
    plugins: (s.plugins || []).map(p => ({ ...p, enabled: disabled.has(p.name) ? false : p.enabled !== false })),
    claude: { ...s.claude, useConnectors: mcpSession.claudeConnectors === false ? false : !!s.claude.useConnectors }
  };
}

const db = load();
for (const a of db.approvals || []) if (a.status === 'pending') { a.status = 'expired'; a.decidedAt = Date.now(); }
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

const json = (res, data, code = 200) => { res.writeHead(code, { ...SECURITY, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
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
const redact = s => ({ ...s, claude: { ...s.claude, apiKey: s.claude.apiKey ? '••••' : '' }, computer: { ...s.computer, boatApiKey: s.computer.boatApiKey ? '••••' : '' } });
// Prévias em texto puro: nada de ** ou # aparecendo nas listas.
const plain = s => String(s || '').replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
const summary = ({ messages, ...c }) => ({ ...c, preview: plain(messages.at(-1)?.content).slice(0, 90), count: messages.length });
const projectOr404 = pid => db.projects.find(p => p.id === pid) || (() => { throw new HttpError(404, 'Projeto não encontrado.'); })();
const agentOr404 = aid => db.agents.find(a => a.id === aid) || (() => { throw new HttpError(404, 'Agente não encontrado.'); })();
const activeChats = new Set();
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

// Aprovações: pedidos pendentes vivem em memória (a promessa que segura o agente) e no banco (histórico).
// Verificado uma vez: o CLI do Codex está instalado nesta máquina?
const codexInstalled = new Promise(resolve => {
  const p = spawn('codex --version', { shell: true, windowsHide: true }); // comando fixo, sem argumentos do usuário
  p.on('error', () => resolve(false));
  p.on('close', code => resolve(code === 0));
  setTimeout(() => resolve(false), 8000);
});
codexInstalled.then(ok => { if (!ok) console.log('Codex não encontrado: o Ripper Auto usa só o Claude. Instale com: npm i -g @openai/codex'); });

// ---------- mensagens entre agentes ----------
const inboxBusy = new Set();
async function deliver(m) {
  const to = db.agents.find(a => a.id === m.to), from = db.agents.find(a => a.id === m.from);
  if (!to || !from) { m.status = 'failed'; m.error = 'Agente não existe mais.'; save(); return; }
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
    m.status = reply && !reply.error ? 'delivered' : 'failed'; m.error = reply?.error;
    // A resposta volta para onde o pedido nasceu, sem gastar um turno de quem pediu.
    const origin = db.chats.find(x => x.id === m.originChatId);
    if (origin && reply?.content) {
      origin.messages.push({ id: id(), role: 'assistant', agentId: to.id, content: reply.content, model: reply.model, via: { type: 'inbox', from: from.id, messageId: m.id, threadChatId: c.id }, at: Date.now() });
      origin.updatedAt = Date.now(); origin.unread = true;
    }
  } catch (e) { m.status = 'failed'; m.error = e.message; console.error('mensagem', e.message); }
  finally { inboxBusy.delete(m.to); save(); setTimeout(dispatchInbox, 50); }
}
function dispatchInbox() {
  for (const m of dueMessages(db.messages, [...inboxBusy])) deliver(m);
}
setInterval(dispatchInbox, 5_000);
// Entregas interrompidas por reinício voltam para a fila.
for (const m of db.messages || []) if (m.status === 'delivering') m.status = 'queued';

const gate = new ApprovalGate({ onChange: () => save() });
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
  if (remember && done.status === 'approved' && done.remember) (chat.allowedCommands ||= []).push(command);
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
    if (done.status === 'approved' && done.remember) (chat.allowedCommands ||= []).push(command);
    return done.status === 'approved';
  };
  const policy = db.settings.approvalPolicy || 'risky';
  return {
    ...computer,
    async exec(command) {
      let reason = needsApproval({ command, computerKind: computer.kind, policy, allowed: chat.allowedCommands || [] });
      if (!reason && policy === 'risky' && !(chat.allowedCommands || []).includes(command)) {
        const j = await juliaChoose(db.settings, { context: `Agente ${agent.name} vai executar no próprio computador.`, question: command, options: RISK_OPTIONS }, 0.6);
        if (j && j.index > 0) reason = `Julia 1: ${RISK_OPTIONS[j.index].split(':')[0].toLowerCase()}`;
      }
      if (reason && !(await ask('exec', command, reason))) return `O usuário NÃO aprovou este comando (${reason}). Não tente contorná-lo; explique o que precisava e ofereça uma alternativa segura.`;
      return computer.exec(command);
    },
    async share(port) {
      // Link público na internet (boat) pede aprovação; localhost não.
      if (computer.kind === 'boat' && !(await ask('share', `compartilhar porta ${port}`, 'publica um link na internet'))) return 'O usuário não aprovou publicar o link.';
      return computer.share(port);
    }
  };
}

function sandboxDir(agent) {
  const d = dataUrl(`sandbox/${agent.id}/`);
  mkdirSync(new URL('uploads/', d), { recursive: true });
  return d;
}

// Anexos de texto entram no prompt; os demais ficam no computador do agente.
const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif)$/;
// Texto entra no prompt; imagens vão como imagem de verdade (o modelo enxerga); o resto só é citado.
async function attachments(agent, chat, fileIds = []) {
  const parts = [], images = [];
  for (const fid of fileIds.slice(0, 10)) {
    const f = db.files.find(x => x.id === fid && canUseFile(x, agent, chat));
    if (!f) continue;
    if (TEXT_EXT.test(f.name) && f.size < 200_000) parts.push(`<arquivo nome="${f.name}">
${await readFile(dataUrl(f.path), 'utf8')}
</arquivo>`);
    else if (IMAGE_TYPES.test(f.type) && f.size <= 5 << 20) images.push({ name: f.name, mediaType: f.type, path: fileURLToPath(dataUrl(f.path)), data: (await readFile(dataUrl(f.path))).toString('base64') });
    else parts.push(`<arquivo nome="${f.name}" tipo="${f.type}" tamanho="${f.size}">Arquivo binário anexado (${f.size} bytes).</arquivo>`);
  }
  return { text: parts.join('\n'), images };
}

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
  const label = m => m.role === 'assistant' && m.agentId && m.agentId !== agent.id ? { role: 'user', content: `[${name(m.agentId)} disse]: ${m.content}` } : m;
  // Histórico = tudo antes da pergunta atual; o que os colegas já responderam nesta rodada vai depois dela.
  const at = chat.messages.findLastIndex(m => m.role === 'user');
  const history = trimHistory(chat.messages.slice(0, at)).map(label);
  const round = chat.messages.slice(at + 1).filter(m => m.content);
  if (round.length) prompt += '\n\n' + round.map(m => `[${name(m.agentId)} respondeu nesta rodada]: ${m.content}`).join('\n\n') + `\n\nAgora é a sua vez, ${agent.name}.`;
  const memories = s.memory && agent.tools.includes('memory') ? db.memories.filter(m => m.agentId === agent.id) : [];
  let computer = null;
  // Sem chave/computador desligado: a ferramenta só não é oferecida (o painel do agente avisa).
  if (agent.tools.includes('computer')) { try { computer = computerFor(agent, s, save); } catch {} }
  let browser = null;
  if (computer?.kind === 'docker' && agent.tools.includes('browser')) {
    const b = browsers.get(agent.id) || browserFor(computer, sandboxDir(agent));
    browsers.set(agent.id, b);
    const ask = (action, opts, label) => {
      const reason = browserRisk(action, opts);
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
      save: a => {
        const scope = x => chat.projectId ? x.projectId === chat.projectId : x.chatId === chat.id;
        let art = db.artifacts.find(x => scope(x) && x.title.toLowerCase() === a.title.trim().toLowerCase());
        if (art) Object.assign(art, { content: a.content, kind: a.kind || art.kind, agentId: agent.id, version: (art.version || 1) + 1, updatedAt: Date.now() });
        else { art = { id: id(), projectId: chat.projectId || null, chatId: chat.id, agentId: agent.id, title: a.title.trim(), kind: a.kind || 'documento', content: a.content, version: 1, createdAt: Date.now(), updatedAt: Date.now() }; db.artifacts.push(art); }
        save(); emit({ artifact: { id: art.id, title: art.title, version: art.version } });
        return `Artefato "${art.title}" salvo (versão ${art.version}).`;
      },
      read: title => {
        const art = visibleArtifacts(chat).find(x => x.title.toLowerCase() === String(title).trim().toLowerCase());
        return art ? art.content : `Não há artefato "${title}". Existentes: ${visibleArtifacts(chat).map(x => x.title).join(', ') || 'nenhum'}.`;
      }
    },
    skills: {
      use: nm => { const k = visibleSkills(chat).find(x => x.name.toLowerCase() === String(nm).trim().toLowerCase()); return k ? k.content : `Skill "${nm}" não existe.`; },
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
    visibleSkills(chat).length ? `Skills disponíveis (carregue com use_skill): ${visibleSkills(chat).map(k => `${k.name}: ${k.description}`).join(' | ')}` : 'Quando um passo a passo funcionar bem e puder se repetir, guarde com save_skill.',
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

  // Transferência automática: Claude falhou (limite/erro) → Codex, e vice-versa (se o Codex existir).
  const order = MODELS[pick.model].provider === 'codex' ? [pick.model, 'claude-sonnet-5-5'] : (await codexInstalled) ? [pick.model, 'codex'] : [pick.model];
  let out = '';
  const steps = []; // ferramentas usadas (a aba Computador mostra os comandos)
  const push = extra => chat.messages.push({ id: id(), role: 'assistant', agentId: agent.id, content: out, at: Date.now(), ...(steps.length ? { steps } : {}), ...extra });
  for (const m of order) {
    let attempt = '';
    try {
      const providerSystem = MODELS[m].provider === 'codex' && s.computer.mode !== 'local'
        ? `${system}\n\nNesta execução do Codex, o computador está em modo somente leitura; não prometa executar comandos nem acessar a VM Boat.` : system;
      const args = { agent, effort, prompt, images, history, system: providerSystem, settings: s, signal };
      const gen = MODELS[m].provider === 'codex' ? runCodex({ ...args, cwd: sandboxDir(agent), ctx }) : runClaude({ ...args, model: m, ctx });
      for await (const ev of gen) { if (ev.text) { attempt += ev.text; out += ev.text; } if (ev.tool) steps.push({ tool: ev.tool, detail: ev.detail, at: Date.now() }); emit(ev); }
      push({ model: m, effort });
      recordUsage(db, m, { charsIn: (text?.length || 0) + (prompt?.length || 0), charsOut: out.length, routedBy });
      break;
    } catch (e) {
      if (signal?.aborted) { push({ model: m, stopped: true }); break; }
      emit({ warn: `${MODELS[m].label} falhou: ${e.message}` });
      if (!mayFallback(attempt, m === order.at(-1))) { push({ model: m, error: e.message }); break; }
      emit({ handoff: order[1] });
    }
  }
}

async function chat({ chat, text, fileIds, signal, mcpSession }, emit) {
  chat.messages.push({ id: id(), role: 'user', content: text, files: fileIds?.length ? fileIds : undefined, at: Date.now() });
  const members = groupMembers(chat, db.agents);
  const group = members.length > 1 ? members : null;
  // Julia 1 (ou a heurística) escolhe quem abre; @menções definem a ordem; delegações entram na fila.
  const first = await selectSpeakers(chat, text, db.agents, (t, ms) => classifySpeaker(t, ms, db.settings, heuristicSpeaker));
  const floor = new Floor(first, members, group ? 5 : 1);
  for (let agent = floor.next(); agent; agent = floor.next()) {
    if (signal?.aborted) break;
    emit({ speaker: agent.id });
    await syncLocalFiles(agent, chat);
    const extra = await attachments(agent, chat, fileIds);
    const before = chat.messages.length;
    await turn({ agent, chat, text, prompt: extra.text ? `${text}\n\n${extra.text}` : text, images: extra.images, signal, group, mcpSession }, emit);
    const reply = chat.messages.length > before ? chat.messages.at(-1) : null;
    if (group && reply && isPass(reply.content)) { chat.messages.pop(); emit({ passed: agent.id }); }
    else if (group && reply) { const next = floor.afterReply(agent, reply.content); if (next.length) emit({ delegated: next.map(a => a.id) }); }
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
  ['GET', /^\/api\/state$/, () => ({
    settings: redact(db.settings), agents: db.agents, models: MODELS, templates: TEMPLATES, categories: CATEGORIES,
    chats: db.chats.map(summary), routines: db.routines.map(({ hookSecret, ...r }) => ({ ...r, hasSecret: !!hookSecret })),
    files: db.files.map(({ path, ...f }) => f), memoriesCount: db.memories.length, pendingInbox: db.messages.filter(m => m.status === 'queued' || m.status === 'delivering').reduce((o, m) => (o[m.originChatId] = (o[m.originChatId] || 0) + 1, o), {}), approvals: db.approvals.filter(a => a.status === 'pending').map(approvalView), artifacts: db.artifacts.map(({ content, ...a }) => ({ ...a, size: content.length })),     skills: db.skills, memoriesByAgent: db.memories.reduce((o, x) => (o[x.agentId] = (o[x.agentId] || 0) + 1, o), {}), projects: db.projects,
    usage: usageSummary(db),
    limits: accountLimits(db, db.settings)
  })],
  ['GET', /^\/api\/usage\/limits$/, () => accountLimits(db, db.settings)],
  ['GET', /^\/api\/usage\/context$/, (req, _, url) => {
    const chatId = url.searchParams.get('chatId') || undefined;
    const mcpToolCount = +(url.searchParams.get('mcpTools') || 0) || (db.settings.plugins?.length || 0) * 8;
    const skillCount = db.skills?.length || 0;
    return contextBreakdown(db, db.settings, { chatId, mcpToolCount, skillCount });
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
    if (!b.url || !/^https:\/\//.test(String(b.url))) throw new HttpError(400, 'URL HTTPS do servidor MCP é obrigatória.');
    return verifyMcpServer(b.url);
  }],
  ['PUT', /^\/api\/settings$/, async req => {
    const b = await body(req), s = db.settings;
    if (typeof b.name === 'string') s.name = b.name.slice(0, 80);
    if (typeof b.customInstructions === 'string') s.customInstructions = b.customInstructions.slice(0, 8000);
    if (b.defaultModel in MODELS) s.defaultModel = b.defaultModel;
    if (typeof b.memory === 'boolean') s.memory = b.memory;
    if (['risky', 'always', 'never'].includes(b.approvalPolicy)) s.approvalPolicy = b.approvalPolicy;
    if (b.inbox) s.inbox = { maxPerHour: Math.max(1, Math.min(200, +b.inbox.maxPerHour || 20)), maxHops: Math.max(1, Math.min(10, +b.inbox.maxHops || 3)) };
    if (b.memoryLogInContext != null) s.memoryLogInContext = Math.max(0, Math.min(50, +b.memoryLogInContext || 0));
    if (b.claude) s.claude = { mode: b.claude.mode === 'api' ? 'api' : 'subscription', useConnectors: !!b.claude.useConnectors, apiKey: b.claude.apiKey === '••••' ? s.claude.apiKey : String(b.claude.apiKey || '') };
    if (b.chatgpt) s.chatgpt = { useConnectedApps: !!b.chatgpt.useConnectedApps };
    if (b.computer) s.computer = { mode: ['boat', 'docker', 'local', 'off'].includes(b.computer.mode) ? b.computer.mode : s.computer.mode, vmSize: ['small', 'default', 'large'].includes(b.computer.vmSize) ? b.computer.vmSize : 'default', idleStopMinutes: Math.max(1, Math.min(1440, +b.computer.idleStopMinutes || 10)), boatApiKey: b.computer.boatApiKey === '••••' ? s.computer.boatApiKey : String(b.computer.boatApiKey || ''), allowLocalCommands: b.computer.allowLocalCommands === true, dockerImage: /^[\w./:-]{1,120}$/.test(b.computer.dockerImage || '') ? b.computer.dockerImage : (s.computer.dockerImage || 'node:22-bookworm') };
    if (b.julia?.url && /^https?:\/\//.test(b.julia.url)) s.julia = { url: b.julia.url };
    if (Array.isArray(b.plugins)) s.plugins = b.plugins.filter(p => p?.name && /^[\w-]{1,40}$/.test(p.name)).map(p => {
      const prev = s.plugins.find(x => x.name === p.name);
      const auth = p.auth && typeof p.auth === 'object' ? {
        mode: ['oauth_now', 'oauth_lazy', 'none'].includes(p.auth.mode) ? p.auth.mode : 'oauth_lazy',
        oauthClient: ['published', 'dcr', 'custom'].includes(p.auth.oauthClient) ? p.auth.oauthClient : 'published',
        clientId: String(p.auth.clientId || '').slice(0, 200),
        clientSecret: p.auth.clientSecret === '••••' ? (prev?.auth?.clientSecret || '') : String(p.auth.clientSecret || '').slice(0, 500),
        headers: Array.isArray(p.auth.headers) ? p.auth.headers.slice(0, 4).map(h => ({ name: String(h.name || '').slice(0, 80), value: String(h.value || '').slice(0, 500) })).filter(h => h.name) : undefined
      } : prev?.auth;
      const hdr = Array.isArray(p.headers) ? Object.fromEntries(p.headers.slice(0, 4).filter(h => h?.name).map(h => [String(h.name).slice(0, 80), String(h.value || '').slice(0, 500)])) : p.headers;
      return p.type === 'http'
        ? { name: p.name, type: 'http', url: String(p.url), enabled: p.enabled !== false, ...(auth ? { auth } : {}), ...(hdr ? { headers: hdr } : {}) }
        : { name: p.name, type: 'stdio', command: String(p.command), args: (p.args || []).map(String), enabled: p.enabled !== false };
    });
    save(); return redact(s);
  }],
  ['GET', /^\/api\/artifacts\/([\w-]+)$/, (req, [aid]) => db.artifacts.find(a => a.id === aid) || (() => { throw new HttpError(404, 'Artefato não encontrado.'); })()],
  ['PUT', /^\/api\/artifacts\/([\w-]+)$/, async (req, [aid]) => {
    const a = db.artifacts.find(x => x.id === aid); if (!a) throw new HttpError(404, 'Artefato não encontrado.');
    const b = await body(req);
    if (typeof b.title === 'string' && b.title.trim()) a.title = b.title.trim().slice(0, 120);
    if (typeof b.content === 'string') { a.content = b.content.slice(0, 60000); a.version = (a.version || 1) + 1; }
    a.updatedAt = Date.now(); save(); return a;
  }],
  ['DELETE', /^\/api\/artifacts\/([\w-]+)$/, (req, [aid]) => { db.artifacts = db.artifacts.filter(a => a.id !== aid); save(); return {}; }],
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
  ['GET', /^\/api\/computer\/docker$/, async () => ({ version: await dockerAvailable(), image: await imageStatus() })],
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
  ['POST', /^\/api\/projects$/, async req => {
    const b = await body(req);
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
    db.projects = db.projects.filter(p => p.id !== pid); save(); return {};
  }],
  ['POST', /^\/api\/agents$/, async req => {
    const b = await body(req);
    const t = TEMPLATES.find(t => t.id === b.templateId);
    const a = patchAgent(newAgent({ ...(t || {}), templateId: t?.id }), b);
    db.agents.push(a); save(); return a;
  }],
  ['PUT', /^\/api\/agents\/([\w-]+)$/, async (req, [aid]) => { const a = patchAgent(agentOr404(aid), await body(req)); save(); return a; }],
  ['DELETE', /^\/api\/agents\/([\w-]+)$/, (req, [aid]) => {
    agentOr404(aid);
    if (db.agents.length === 1) throw new HttpError(409, 'Mantenha pelo menos um agente.');
    db.agents = db.agents.filter(x => x.id !== aid);
    db.routines = db.routines.filter(r => r.agentId !== aid);
    db.projects.forEach(p => { p.agentIds = p.agentIds.filter(a => a !== aid); });
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
    db.routines.push(r); save(); return r;
  }],
  ['DELETE', /^\/api\/routines\/([\w-]+)$/, (req, [rid]) => { db.routines = db.routines.filter(x => x.id !== rid); save(); return {}; }],
  ['GET', /^\/api\/chats\/([\w-]+)$/, (req, [cid]) => { const c = db.chats.find(c => c.id === cid); if (!c) throw new HttpError(404, 'Conversa não encontrada.'); if (c.unread) { c.unread = false; save(); } return c; }],
  ['PUT', /^\/api\/chats\/([\w-]+)$/, async (req, [cid]) => {
    const c = db.chats.find(c => c.id === cid); if (!c) throw new HttpError(404, 'Conversa não encontrada.');
    const b = await body(req); if (typeof b.title === 'string' && b.title.trim()) c.title = b.title.trim().slice(0, 80);
    save(); return summary(c);
  }],
  ['DELETE', /^\/api\/chats\/([\w-]+)$/, (req, [cid]) => { if (activeChats.has(cid)) throw new HttpError(409, 'Aguarde a resposta terminar.'); db.chats = db.chats.filter(c => c.id !== cid); save(); return {}; }],
  ['POST', /^\/api\/files$/, async (req, _, url) => {
    // Arquivo de um agente, ou de um projeto (visível a todos os agentes membros).
    const chatRef = db.chats.find(c => c.id === url.searchParams.get('chatId'));
    const pid = url.searchParams.get('projectId') || chatRef?.projectId || null;
    const project = pid ? projectOr404(pid) : null;
    const a = project && !url.searchParams.get('agentId') ? null : agentOr404(url.searchParams.get('agentId'));
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
    const buf = await readFile(dataUrl(f.path));
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
    if (activeChats.has(c.id)) throw new HttpError(409, 'Esta conversa já está respondendo. Aguarde ou interrompa a resposta atual.');
    const quota = checkSendQuota(db);
    if (quota.blocked) throw new HttpError(429, quota.userMessage);
    activeChats.add(c.id);
    const fileIds = (b.fileIds || []).filter(fid => db.files.some(f => f.id === fid && agentIds.some(a => canUseFile(f, { id: a }, c))));
    for (const fid of fileIds) { const f = db.files.find(x => x.id === fid); if (f && !f.chatId) f.chatId = c.id; }
    res.writeHead(200, { ...SECURITY, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
    const emit = e => res.writable && res.write(`data: ${JSON.stringify(e)}\n\n`);
    emit({ chatId: c.id });
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    const ping = setInterval(() => res.writable && res.write(': ping\n\n'), 15_000);
    // Modelo e esforço ficam gravados na conversa ('agent' = usar o padrão de cada agente).
    if (b.model) c.model = b.model === 'agent' ? undefined : b.model;
    if (b.effort) c.effort = b.effort;
    try { await chat({ chat: c, text, fileIds, signal: ac.signal, mcpSession: b.mcpSession }, emit); }
    finally { clearInterval(ping); activeChats.delete(c.id); save(); }
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
    if (code === 500) console.error(e);
    if (!res.headersSent) json(res, { error: code === 500 ? 'Erro interno. Veja o log do servidor.' : e.message }, code); else res.end();
  }
}).listen(PORT, HOST, () => console.log(`Ripper em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));

// Rotinas: o agente dono acorda (por horário ou evento), executa e só deixa conversa se houver novidade.
function runRoutine(r, event) {
  const agent = db.agents.find(a => a.id === r.agentId);
  if (!agent || agent.status === 'paused' || r.lastStatus === 'running') return false;
  r.lastRun = Date.now(); r.lastStatus = 'running'; r.lastError = null; save();
  const c = { id: id(), agentId: agent.id, title: event ? `${r.name} · ${event.source}${event.type ? ' ' + event.type : ''}` : r.name, routineId: r.id, messages: [], createdAt: Date.now(), updatedAt: Date.now() };
  db.chats.unshift(c);
  chat({ chat: c, text: routinePrompt(r, event) }, () => {}).then(async () => {
    const replies = c.messages.filter(m => m.role === 'assistant');
    const failed = replies.find(m => m.error)?.error;
    let verdict = null;
    if (!failed && replies.length && r.quiet !== false) {
      const j = await juliaChoose(db.settings, { context: `Rotina "${r.name}": ${r.prompt}`, question: replies.map(m => m.content).join('\n').slice(0, 1500), options: NOTIFY_OPTIONS }, 0.55);
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
  }).catch(e => { r.lastStatus = 'failed'; r.lastError = e.message; save(); console.error('rotina', r.name, e.message); });
  return true;
}

setInterval(() => {
  const now = new Date();
  for (const r of db.routines) if (routineDue(r, now)) runRoutine(r);
}, 30_000);

process.on('unhandledRejection', e => console.error('unhandledRejection', e));
if (!existsSync(DIST)) console.warn('Aviso: frontend não compilado. Rode `npm run build`.');
