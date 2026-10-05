import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat, writeFile, unlink, copyFile } from 'node:fs/promises';
import { mkdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authed as checkAuth } from './lib/auth.mjs';
import { load, save, flush, id, newAgent, patchAgent, dataUrl, safeCheckStoreReady } from './lib/store.mjs';
import { route, classifySpeaker, MODELS, EFFORTS, enabledModels, clampEffort } from './lib/router.mjs';
import { computerFor } from './lib/boat.mjs';
import { dockerAvailable, imageStatus, ensureImage, hostnameOf, transcribeAudio } from './lib/docker.mjs';
import { sandboxStatus } from './lib/exec-sandbox.mjs';
import { ApprovalGate } from './lib/approvals.mjs';
import { autoStartJulia, juliaOnline, juliaChoose, juliaStatus, measureTriagePromptChars, RISK_OPTIONS, NOTIFY_OPTIONS, MEMORY_OPTIONS, REPLY_OPTIONS } from './lib/julia.mjs';
import {
  checkSend, dueMessages, threadKey, inboxPrompt, callAgentPrompt, repairInboxOnStartup, markInboxDeliveryFailed, inboxSummary,
  findAgentByName, clampCallTimeoutMs, interpretInboxReply, formatCallAgentResult, peerAllowed
} from './lib/inbox.mjs';
import {
  PROTOCOL_ID,
  delegateTask,
  workerProtocolEvent,
  ingestWorkerInboxReply,
  findDelegation,
  delegationsSummary,
  MESSAGE_KIND
} from './lib/manager-worker-protocol.mjs';
import { trackInboxDelegation, taskItemsSummary } from './lib/task-items.mjs';
import { closeTaskFromInboxReply } from './lib/task-closure.mjs';
import { createGoogleTasksSync } from './lib/google-tasks-sync.mjs';
import { rememberAllowedCommand, execNeedsApproval } from './lib/permissions.mjs';
import { browserAutonomyGate, shareAutonomyGate, socialPostAutonomyGate, effectiveApprovalPolicy, sanitizeAutonomyLevel } from './lib/autonomy.mjs';
import {
  enabledSocialWebhooks,
  resolveSocialWebhook,
  socialPostNeedsApproval,
  socialApprovalCommand,
  postToSocialWebhook
} from './lib/social-webhooks.mjs';
import { listChatsPage } from './lib/history.mjs';
import { tryClaimRoutine, releaseRoutineClaim } from './lib/persist-coord.mjs';
import { browserFor, browserRisk } from './lib/browser.mjs';
import { runClaude, runCodex, systemPrompt, describeImage } from './lib/providers.mjs';
import { runOpenRouter, syncOpenRouterModels, checkCompatKey, compatCatalog, COMPAT } from './lib/openrouter.mjs';
import { recordExternal, listExternal, externalCsv, EXTERNAL_KINDS } from './lib/external-actions.mjs';
import { buildPulse, pulseDue } from './lib/pulse.mjs';
import { emailReady, listEmails, readEmail, sendEmail, newEmailsSince, testEmail, getAttachment, safeName, attachmentText, readHint } from './lib/email.mjs';
import { gh, githubReady, normalizeRepo, repoChanges, describeChange, prBranch, gitAuthArg, hideToken } from './lib/github.mjs';
import { whatsappTriggerMatches, emailTriggerMatches, parseKeywords } from './lib/event-triggers.mjs';
import { isPaidModel, paidBlockReason, addSpend, spendToday, spendLimits, normalizeBilling } from './lib/paid-usage.mjs';
import { runTestProvider } from './lib/test-provider.mjs';
import { TEMPLATES, CATEGORIES } from './lib/templates.mjs';
import { memoryContext, isDuplicateMemory, canUseFile, selectSpeakers, routineDue, Floor, isPass, heuristicSpeaker, groupMembers, trimHistory, isNothingNew, routinePrompt, summarizeEvent, lastUserTurnIndex, labelMessageForAgent, turnPlanIds } from './lib/agent-flow.mjs';
import { providerAttemptOrder, runProviderAttemptLoop } from './lib/provider-turn.mjs';
import { normalizeProviderRetry } from './lib/provider-retry.mjs';
import { patchSettings, settingsMeta, SettingsValidationError } from './lib/settings-patch.mjs';
import { normalizeContextPruning, pruneContextMessages } from './lib/context-pruning.mjs';
import { coalesceSendParts } from './lib/input-queue.mjs';
import { effectiveFeatureFlags, isFlagEnabled } from './lib/feature-flags.mjs';
import { applyAccessControlPatch } from './lib/access-control-patch.mjs';
import { canDelegate, delegationDeniedMessage, normalizeAccessControl, accessControlMeta } from './lib/rbac.mjs';
import { executeLgpdErasure, lgpdMeta } from './lib/lgpd-pii.mjs';
import { appendAudit, auditFromApproval, listAudit } from './lib/audit.mjs';
import { buildAdminOverview } from './lib/admin-overview.mjs';
import { buildLgpdStatus } from './lib/lgpd-status.mjs';
import { listAuditTrail, countAuditTrail } from './lib/audit-trail.mjs';
import { isEnterpriseMode } from './lib/enterprise.mjs';
import {
  recordCorporateAudit,
  auditFromApprovalRecord,
  auditSettingsPatch,
  auditAgentLifecycle,
  auditDataRestore
} from './lib/corporate-audit.mjs';
import { newHookToken, verifySignature, eventMeta } from './lib/hooks.mjs';
import { recordUsage, usageSummary, accountLimits, contextBreakdown, checkSendQuota, compactChat, parseProviderLimitFromError, recordProviderSignal } from './lib/usage.mjs';
import { checkRunBudget, ToolLoopDetector, tokenBudgetAlertFromCheck } from './lib/token-budget-governor.mjs';
import { buildUsageContract, normalizeContextWindow } from './lib/usage-api.mjs';
import { buildMeteringReport, listMeteringEvents, usageEventsToCsv } from './lib/metering.mjs';
import { buildTokenRoiContract, routingSummary } from './lib/token-roi.mjs';
import { listScripts, deleteScript } from './lib/script-pool.mjs';
import { listClaudeConnectors } from './lib/claude-connectors.mjs';
import { buildInbox, resolveInboxItem } from './lib/inbox-feed.mjs';
import { vmPathToData, mimeOf, inlineType } from './lib/deliver-file.mjs';
import { parseWhatsappMessages, whatsappPrompt, sendWhatsappText, whatsappReady } from './lib/whatsapp.mjs';
import { evolutionSecrets, connectInstance, instanceState, disconnectInstance, sendText as sendEvolutionText, parseEvolutionAny, parseEvolutionGroup, groupName, evolutionMedia, withMediaText, downloadMedia, contactMode, isAllowed, makeRateLimiter, channelSafeAgent } from './lib/evolution.mjs';
import { history as waHistory, recordMessage as recordWaMessage, listChats as waListChats, readChat as waReadChat, findContacts as waFindContacts, styleProfile as waStyleProfile, styleHint, stats as waStats, wipeHistory as waWipeHistory } from './lib/whatsapp-store.mjs';
import { timingSafeEqual } from 'node:crypto';
import { registerChatStream, cancelChatStream, unregisterChatStream, isChatStreaming, activeChatStreamCount } from './lib/chat-stream.mjs';
import { beginChatRun, bumpChatRunSeq, finishChatRun, chatRunPublic, canResumeChatRun, trimPartialRepliesAfterLastUser } from './lib/chat-run.mjs';
import { exportChatPayload, importChatPayload } from './lib/chat-transfer.mjs';
import { listAgentTemplates, createSavedTemplate, patchSavedTemplate, agentFromSavedTemplate } from './lib/agent-templates.mjs';
import { architectSuggest } from './lib/architect-suggest.mjs';
import {
  parseTeamBrief,
  normalizeTeamStructure,
  createTeamProposal,
  listTeamProposals,
  applyTeamProposal,
  orchestrateTeamStructure,
  structureFromArchitectScaffold,
  ORCHESTRATOR_SYSTEM
} from './lib/team-orchestrator.mjs';
import { ripperBuiltinSchemaChars, listRipperBuiltinToolNames } from './lib/ripper-builtin-tools.mjs';
import { refreshClaudeSubscriptionUsage } from './lib/claude-subscription-usage.mjs';
import {
  lookupSemanticCache,
  resolveSemanticCacheConfig,
  storeSemanticCacheEntry
} from './lib/semantic-cache.mjs';
import { verifyMcpConnector } from './lib/mcp-probe.mjs';
import { shutdownStdioSupervisors } from './lib/mcp-stdio-supervisor.mjs';
import { closeSpares } from './lib/claude-prewarm.mjs';
import {
  applyOAuthTokensToPlugin,
  refreshPluginOAuthToken,
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
import { redactRoutine, redactSseEvent, redactJsonPayload, redactForLog, redactSecretsInText } from './lib/redact.mjs';
import { installLogRedactionMiddleware } from './lib/log-redact-middleware.mjs';
import { logger, configureLogger, runWithRequestContext, shouldLogHttpRoute } from './lib/logger.mjs';
import {
  assertVaultStoreBody,
  generateVaultRef,
  isVaultRef,
  redactVaultEntry,
  sanitizeHeaderValueForStorage,
  validateSealedBlob,
  vaultContextFromSession,
  resolvePluginsVaultSecrets
} from './lib/credential-vault.mjs';
import { collectDiagnostics } from './lib/diagnostics.mjs';
import { runBootLint } from './lib/boot-lint.mjs';
import {
  metricsAccessAllowed,
  incrementHttpInFlight,
  recordHttpRequest,
  recordChatTurn,
  normalizeMetricRoute,
  formatPrometheusExposition,
  prometheusContentType
} from './lib/metrics.mjs';
import { collectX9Sources } from './lib/x9-sources.mjs';
import { runX9Scan } from './lib/x9-scan.mjs';
import {
  buildBackupPayload,
  restoreBackupPayload,
  listAutoBackups,
  createDataSnapshot,
  listDataSnapshots,
  restoreDataSnapshot,
  maybeRunScheduledBackup,
  pruneOldSnapshots,
  normalizeBackupSettings
} from './lib/backup.mjs';
import { memoAsync } from './lib/ttl-cache.mjs';
import { attachRequestId } from './lib/request-id.mjs';
import { isShuttingDown, registerGracefulShutdown, SHUTDOWN_MESSAGE } from './lib/shutdown.mjs';
import { closeUsageEventsStore, listUsageEventsSince } from './lib/usage-events.mjs';
import { agentDayStats } from './lib/agent-day-stats.mjs';
import { closeJuliaEventsStore } from './lib/julia-events.mjs';
import { closePersistCoordStore } from './lib/persist-coord.mjs';
import { checkRateLimit } from './lib/rate-limit.mjs';
import {
  parseCorsAllowlist,
  mergeResponseHeaders,
  handleApiCorsPreflight,
  mutatingOriginError
} from './lib/security-headers.mjs';
import { resolveHttpBudget, rejectOversizeBody, attachHttpTimeout } from './lib/http-budget.mjs';
import {
  chatIdempotencyContext,
  replayIdempotentResponse,
  captureResponseBody,
  closeIdempotencyStore
} from './lib/idempotency.mjs';
import { buildOpenApiDocument, OPENAPI_DOCS_HTML } from './lib/openapi.mjs';
import {
  applyGoogleTokensToSettings,
  exchangeGoogleTasksCode,
  findGoogleTasksOAuthFlowByState,
  getGoogleTasksOAuthFlow,
  googleTasksOAuthStatus,
  googleTasksRedirectUri,
  startGoogleTasksOAuthFlow
} from './lib/google-tasks-oauth.mjs';
import {
  listTaskDelegations,
  pullFromGoogleTasks,
  pushAllLinkedTasks,
  pushTaskToGoogle,
  syncTaskRecord,
  taskSyncBridgeStatus,
  upsertTaskDelegation
} from './lib/task-sync-bridge.mjs';
import {
  deleteVaultCredential,
  getVaultCredential,
  listVaultEntries,
  migrateLegacySecretsToVault,
  persistOAuthTokensInVault,
  resolvePluginWithVault,
  putVaultCredential,
  vaultConfigured,
  isVaultPlaintextResponse,
  stripVaultPlaintextMarker,
  vaultCredentialApiResponse
} from './lib/connection-vault.mjs';
import {
  resolveRetentionSettings,
  applyRetentionSettingsPatch,
  runRetentionPurge,
  startRetentionScheduler,
  envRetentionOverrides
} from './lib/retention-ttl.mjs';
import {
  chaosStatusPayload,
  maybeChaosProviderFailure,
  chaosSseBeforeEmit,
  resolveEffectiveChaos,
  scheduleChaosFire
} from './lib/chaos.mjs';
import { detectImageType, isSafeBrandStoragePath, newBrandLogoFilename, readBrandLogoUpload, BRAND_LOGO_MAX } from './lib/brand.mjs';

installLogRedactionMiddleware();

function settingsForMcp(s, mcpSession) {
  return settingsForMcpSession(s, mcpSession);
}

const APP_PKG = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const SERVER_STARTED_AT = Date.now();
const db = load();
syncOpenRouterModels(db.settings); // modelos do OpenRouter escolhidos em Configurações
// Quem já usava Claude por API key escolheu pagar antes do consentimento existir: não quebra o turno dele.
if (db.settings.claude?.mode === 'api' && db.settings.claude.apiKey && !db.settings.billing) { db.settings.billing = normalizeBilling({ paidConsent: true }); save(); }
if (db.chats.some(c => c.channel)) { db.chats = db.chats.filter(c => !c.channel); save(); } // conversa de WhatsApp fica no WhatsApp (versões antigas criavam aqui)
configureLogger({ settings: db.settings });

function googleTokenRefreshHook(tokens) {
  db.settings = applyGoogleTokensToSettings(db.settings, tokens);
  save();
}

const syncBridgeOpts = () => ({ onTokensRefreshed: googleTokenRefreshHook });
const googleTasksRuntime = () => ({ db, ...syncBridgeOpts() });
const googleTasksSync = createGoogleTasksSync({
  enabled: db.settings?.taskSync?.google?.enabled !== false,
  runtime: googleTasksRuntime()
});
for (const a of db.approvals || []) if (a.status === 'pending') { a.status = 'expired'; a.decidedAt = Date.now(); }
await migrateInlineArtifacts(db.artifacts).catch(e => console.error('[artifacts] migração:', e.message));
const _storageCleanup = await startupStorageCleanup(db).catch(e => ({ error: e.message }));
if (_storageCleanup?.files?.removedRecords?.length) save();
const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';          // só a própria máquina, a não ser que você peça
const TOKEN = process.env.RIPPER_TOKEN || '';            // obrigatório ao expor na rede
const DIST = new URL('./dist/', import.meta.url);
const HTTP_BUDGET = resolveHttpBudget();
const MAX_JSON = HTTP_BUDGET.maxBodyBytes;
const MAX_FILE = 25 << 20;
const TEXT_EXT = /\.(txt|md|csv|tsv|json|jsonl|xml|html|css|js|mjs|ts|tsx|jsx|py|rb|go|rs|java|c|cpp|h|sql|yaml|yml|toml|ini|log|sh)$/i;

if (HOST !== '127.0.0.1' && HOST !== 'localhost' && !TOKEN) {
  console.error('Recusado: HOST expõe o Ripper na rede sem RIPPER_TOKEN. Defina RIPPER_TOKEN=<segredo longo>.');
  process.exit(1);
}

runBootLint({ host: HOST, port: PORT, token: TOKEN });

class HttpError extends Error {
  constructor(code, msg, details) {
    super(msg);
    this.code = code;
    if (details?.length) this.details = details;
  }
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf', '.ico': 'image/x-icon' };
const CORS_ALLOWLIST = parseCorsAllowlist();
const hdr = (req, extra = {}) => mergeResponseHeaders(req, CORS_ALLOWLIST, extra);

const json = (res, data, code = 200, extra = {}, req = null) => {
  let payload = data;
  if (req?.requestId && data && typeof data === 'object' && data !== null && 'error' in data) {
    payload = { ...data, requestId: req.requestId };
  }
  const bodyOut = isVaultPlaintextResponse(payload) ? stripVaultPlaintextMarker(payload) : redactJsonPayload(payload);
  res.writeHead(code, hdr(req, { 'content-type': 'application/json; charset=utf-8', 'cache-control': extra['cache-control'] || 'no-store', ...extra }));
  res.end(JSON.stringify(bodyOut));
};
function probePayload(extra = {}) {
  return { ok: true, version: APP_PKG.version, uptimeSeconds: Math.floor((Date.now() - SERVER_STARTED_AT) / 1000), ...extra };
}
async function raw(req, limit) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new HttpError(413, `Corpo da requisição excede o limite de ${limit} bytes.`); chunks.push(c); }
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

function chatDetail(c, cid) {
  return {
    ...c,
    streaming: isChatStreaming(cid),
    run: chatRunPublic(c.run),
    interrupted: c.run?.status === 'interrupted'
  };
}

async function streamChatResponse(req, c, { text, fileIds, mcpSession, resume = false, credentialRefs, voice }, res) {
  res.writeHead(200, hdr(req, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' }));
  const clientAc = new AbortController();
  const chaosCfg = resolveEffectiveChaos(db.settings);
  let emitChain = Promise.resolve();
  const emitRaw = e => {
    emitChain = emitChain.then(async () => {
      await chaosSseBeforeEmit(chaosCfg, clientAc.signal);
      if (!res.writable) return;
      bumpChatRunSeq(c);
      const payload = e?.error && req.requestId ? { ...e, requestId: req.requestId } : e;
      res.write(`data: ${JSON.stringify(redactSseEvent(payload, db.settings))}\n\n`);
    });
  };
  emitRaw({ chatId: c.id, runId: c.run?.runId, eventSeq: c.run?.lastEventSeq, resume: !!resume });
  res.on('close', () => { if (!res.writableFinished) clientAc.abort(); });
  const { signal: streamSignal } = registerChatStream(c.id, { signal: clientAc.signal, emit: emitRaw });
  const ping = setInterval(() => res.writable && res.write(': ping\n\n'), 15_000);
  let completed = false;
  let turnMetricRecorded = false;
  const chatEmit = e => {
    if (e?.speaker) turnMetricRecorded = true;
    emitRaw(e);
  };
  try {
    await chat({
      chat: c, text, fileIds, signal: streamSignal, mcpSession, skipUserPush: resume, credentialRefs, voice
    }, chatEmit);
    completed = !streamSignal.aborted;
  } finally {
    clearInterval(ping);
    unregisterChatStream(c.id);
    let status = completed ? 'done' : 'interrupted';
    if (streamSignal.aborted) {
      const last = c.messages.at(-1);
      if (last?.role === 'assistant' && (last.stopped || last.error)) status = 'done';
    }
    finishChatRun(c, status);
    if (!turnMetricRecorded && status === 'interrupted') recordChatTurn('interrupted');
    save();
  }
  if (completed) {
    emitRaw({ done: true, title: c.title, runId: c.run?.runId, eventSeq: c.run?.lastEventSeq });
  } else {
    emitRaw({ interrupted: true, runId: c.run?.runId, eventSeq: c.run?.lastEventSeq });
  }
  await emitChain;
  res.end();
  return undefined;
}
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
    systemChars: agent ? systemPrompt(agent, db.settings).length + memoryContext(memories, db.settings.memoryLogInContext ?? 10).length : 0,
    skillsListChars,
    pluginsChars,
    mcpPluginCount: plugins.length,
    builtinToolCount: agent ? listRipperBuiltinToolNames(agent, db.settings).length : 0,
    builtinSchemaChars: agent ? ripperBuiltinSchemaChars(agent, db.settings) : 0,
    groupContextChars
  };
}

function parseMeteringMsParam(raw, fallback) {
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : fallback;
}

function requireEnterpriseAdmin() {
  if (!isEnterpriseMode(db.settings)) {
    throw new HttpError(403, 'Disponível apenas no modo enterprise (Centro admin).');
  }
}

function requireEnterpriseBrand() {
  if (!isEnterpriseMode(db.settings)) {
    throw new HttpError(403, 'Marca personalizada disponível apenas no modo enterprise.');
  }
}

// Aprovações: pedidos pendentes vivem em memória (a promessa que segura o agente) e no banco (histórico).
// Verificado uma vez: o CLI do Codex está instalado nesta máquina?
const codexInstalled = new Promise(resolve => {
  const p = spawn('codex --version', { shell: true, windowsHide: true }); // comando fixo, sem argumentos do usuário
  p.on('error', () => resolve(false));
  p.on('close', code => resolve(code === 0));
  setTimeout(() => resolve(false), 8000);
});
let codexOk = false; // espelho síncrono para o estado da UI
codexInstalled.then(ok => { codexOk = ok; if (!ok) console.log('Codex não encontrado: o Ripper Auto usa só o Claude. Instale com: npm i -g @openai/codex'); });

const dockerStatusCached = memoAsync(async () => ({ version: await dockerAvailable(), image: await imageStatus() }), 30_000);

// ---------- mensagens entre agentes ----------
const inboxBusy = new Set();
const inboxLimits = () => ({ maxPerHour: 20, maxHops: 3, ...(db.settings?.inbox || {}) });

/** Entrega uma mensagem/call na thread A2A e roda o turno do destinatário. */
async function runInboxDelivery(m, { signal } = {}) {
  const to = db.agents.find(a => a.id === m.to), from = db.agents.find(a => a.id === m.from);
  if (!to || !from) return { ok: false, error: 'Agente não existe mais.', threadChatId: null };
  const key = threadKey(from.id, to.id);
  let c = db.chats.find(x => x.inboxKey === key);
  if (!c) {
    c = { id: id(), agentId: to.id, agentIds: [from.id, to.id], inboxKey: key, title: `${from.name} ↔ ${to.name}`, messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    db.chats.unshift(c);
  }
  const prompt = m.kind === 'call'
    ? callAgentPrompt(m, from.name)
    : m.protocol?.id === PROTOCOL_ID
      ? `${m.body}\n\nResponda de forma direta; para delegações use JSON manager-worker na primeira linha (accept, progress, complete ou reject).`
      : inboxPrompt(m, from.name);
  c.messages.push({
    id: id(), role: 'user', content: prompt,
    inbox: { from: from.id, messageId: m.id, priority: m.priority, kind: m.kind || 'message' },
    at: Date.now()
  });
  const lenBeforeTurn = c.messages.length;
  await turn({ agent: to, chat: c, text: m.body, prompt, images: [], group: null, hops: m.hops, signal }, () => {});
  const parsed = interpretInboxReply(c.messages, lenBeforeTurn);
  c.updatedAt = Date.now(); c.unread = true;
  m.threadChatId = c.id;
  m.deliveredAt = Date.now();
  return { ...parsed, threadChatId: c.id, reply: parsed.ok ? { content: parsed.content, model: parsed.model } : null };
}

const fmtBytes = n => n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1).replace('.', ',')} MB`;

/** Áudio → transcrição (Whisper local); imagem → descrição curta (Haiku). Volta como texto da mensagem. */
async function mediaToText(ev, media) {
  const { buffer, mimetype } = await downloadMedia(ev);
  if (media.kind === 'image') {
    const desc = await describeImage({ data: buffer.toString('base64'), mediaType: mimetype || 'image/jpeg', settings: db.settings }).catch(() => '');
    return `[Imagem${desc ? `: ${desc}` : ''}]${media.caption ? `
${media.caption}` : ''}`;
  }
  mkdirSync(dataUrl('tmp/'), { recursive: true });
  const rel = `tmp/wa-${id()}.${/mpeg|mp3/.test(mimetype) ? 'mp3' : 'ogg'}`;
  await writeFile(dataUrl(rel), buffer);
  try { return `[Áudio transcrito] ${await transcribeAudio(rel)}`; }
  catch { return '[Áudio que não consegui transcrever]'; }
  finally { await unlink(dataUrl(rel)).catch(() => {}); }
}

/**
 * Conversa do WhatsApp fica no WhatsApp: o agente só VÊ. Nada vira conversa no Ripper.
 * A cada mensagem montamos uma conversa temporária com o histórico do contato (whatsapp.sqlite),
 * rodamos o turno e descartamos. Modelo: o mais econômico liberado, esforço baixo — são só mensagens.
 */
/** Aviso do sistema na Caixa (backup falhou etc.). Um por chave enquanto não for resolvido. */
function raiseSystemAlert({ key, title, body, href, hrefLabel, quiet }) {
  db.systemAlerts ||= [];
  const open = db.systemAlerts.find(a => a.key === key && !a.done);
  if (open) Object.assign(open, { body, at: Date.now() });
  else db.systemAlerts.push({ id: id(), key, at: Date.now(), title, body, href, hrefLabel, ...(quiet ? { quiet: true } : {}) });
  if (db.systemAlerts.length > 100) db.systemAlerts.splice(0, db.systemAlerts.length - 100);
  save();
}
function resolveSystemAlert(key) {
  for (const a of db.systemAlerts || []) if (a.key === key && !a.done) a.done = true;
}

/** Limite de uso pago atingido: um aviso na Caixa (uma vez por agente/limite por dia). */
function alertSpendLimit(agent, which) {
  const day = spendToday(db).day, lim = spendLimits(db.settings);
  db.spendAlerts ||= [];
  if (db.spendAlerts.some(a => a.day === day && a.which === which && (which === 'total' || a.agentId === agent.id))) return;
  db.spendAlerts.push({ id: id(), day, which, agentId: agent.id, at: Date.now(), limitUsd: which === 'agent' ? lim.perAgentDailyUsd : lim.totalDailyUsd });
  if (db.spendAlerts.length > 100) db.spendAlerts.splice(0, db.spendAlerts.length - 100);
  recordCorporateAudit(db.settings, { category: 'billing', action: `billing.limit_${which}`, agentId: agent.id, at: Date.now() });
}

function channelModel(s) {
  return ['claude-haiku-4-5', 'claude-sonnet-5-5'].find(m => enabledModels(s).includes(m)) || enabledModels(s)[0];
}
function channelChat(kind, msg, agent) {
  return {
    id: `${kind}:${msg.from}`, agentId: agent.id, channel: kind, channelKey: `${kind}:${msg.from}`,
    title: `WhatsApp · ${msg.name || '+' + msg.from}`, model: channelModel(db.settings), effort: 'low',
    messages: waHistory(msg.from, 20).map((h, i) => ({ id: `h${i}`, role: h.fromMe ? 'assistant' : 'user', agentId: agent.id, content: h.text, at: h.at })),
    createdAt: Date.now(), updatedAt: Date.now()
  };
}
async function channelReply(kind, msg, agent, prompt) {
  const c = channelChat(kind, msg, agent);
  c.messages.push({ id: id(), role: 'user', content: msg.text, at: Date.now() });
  const before = c.messages.length;
  await turn({ agent: channelSafeAgent(agent), chat: c, text: msg.text, prompt, images: [], group: null }, () => {});
  // só texto de verdade: erro ou resposta cortada nunca vai para o contato
  return { chat: c, reply: c.messages.slice(before).findLast(m => m.role === 'assistant' && m.content && !m.stopped && !m.error) };
}

const waSeen = new Set(); // a Meta reentrega o mesmo evento; o id da mensagem evita responder duas vezes
async function handleWhatsappMessage(msg) {
  if (waSeen.has(msg.id)) return;
  waSeen.add(msg.id); if (waSeen.size > 500) waSeen.delete(waSeen.values().next().value);
  const w = db.settings.whatsapp;
  const agent = db.agents.find(a => a.id === w.agentId);
  if (!agent) throw new Error('Agente do canal WhatsApp não existe mais.');
  recordWaMessage({ id: msg.id, phone: msg.from, fromMe: false, text: msg.text, name: msg.name });
  const { reply } = await channelReply('whatsapp', msg, agent, whatsappPrompt(msg));
  if (!reply) return;
  try { await sendWhatsappText(w, msg.from, reply.content); }
  catch (e) { recordExternal({ kind: 'whatsapp.auto_reply', agentId: agent.id, target: `+${msg.from}`, text: reply.content, approved: 'auto', ok: false, error: e.message }); throw e; }
  recordExternal({ kind: 'whatsapp.auto_reply', agentId: agent.id, target: `+${msg.from}`, text: reply.content, approved: 'auto' });
  recordWaMessage({ id: `out-${reply.id}`, phone: msg.from, fromMe: true, text: reply.content });
}

/**
 * WhatsApp por QR (Evolution). Responde só quem você liberou, rascunha para aprovação o resto,
 * respeita pausa e limite por hora, e o agente roda sem computador/navegador/plugins.
 * Guarda o histórico de quem está em "responde sozinho"/"rascunho" (o agente precisa do contexto);
 * dos demais, só com "Ler conversas" ligado.
 */
const waWebSeen = new Set();
const waWebRate = makeRateLimiter({ perContact: 20, global: 60 });
async function handleWhatsappWebMessage(msg) {
  const w = db.settings.whatsappWeb || {};
  if (!isEnterpriseMode(db.settings)) return;
  if (waWebSeen.has(msg.id)) return;
  waWebSeen.add(msg.id); if (waWebSeen.size > 500) waWebSeen.delete(waWebSeen.values().next().value);
  const mode = contactMode(msg.from, w);
  if (w.readAll || mode === 'auto' || mode === 'draft') recordWaMessage({ id: msg.id, phone: msg.from, fromMe: msg.fromMe, text: msg.text, name: msg.name, at: msg.at });
  if (msg.fromMe || !w.enabled || w.paused) return; // sua mensagem, canal desligado ou pausado: só registra
  if (!mode || mode === 'read') return;
  const agent = db.agents.find(a => a.id === w.agentId);
  if (!agent) throw new Error('Agente do WhatsApp (QR) não existe mais.');
  // Rascunho: a Julia decide antes se precisa de resposta ("ok 👍" não precisa) — não gasta o modelo à toa.
  if (mode === 'draft') {
    const j = await juliaChoose(db.settings, { context: 'Mensagem recebida no WhatsApp do usuário.', question: msg.text, options: REPLY_OPTIONS }, { minScore: 0.6, purpose: 'whatsapp_reply' });
    if (j && j.index === 1) return;
  }
  if (!waWebRate(msg.from)) return;
  const prompt = whatsappPrompt(msg) + (w.readAll ? styleHint(waStyleProfile()) : '');
  const { chat: c, reply } = await channelReply('whatsapp-web', msg, agent, prompt);
  if (!reply) return;
  if (mode === 'draft') {
    // Fica na bandeja de aprovações; só sai se você aprovar (expira sem resposta = não envia).
    const ok = await askApproval({ agent, chat: c, emit: () => {}, signal: null }, 'whatsapp', `Para ${msg.name || ''} +${msg.from}:\n${reply.content}`, 'Rascunho de resposta no seu WhatsApp.', false);
    if (!ok) return;
  }
  const approved = mode === 'draft' ? 'user' : 'auto';
  try { await sendEvolutionText(msg.from, reply.content); }
  catch (e) { recordExternal({ kind: 'whatsapp.auto_reply', agentId: agent.id, target: `${msg.name || ''} +${msg.from}`.trim(), text: reply.content, approved, ok: false, error: e.message }); throw e; }
  recordExternal({ kind: 'whatsapp.auto_reply', agentId: agent.id, target: `${msg.name || ''} +${msg.from}`.trim(), text: reply.content, approved });
  recordWaMessage({ id: `out-${reply.id}`, phone: msg.from, fromMe: true, text: reply.content });
}

/**
 * Conectores prontos para o turno: credencial do cofre carregada e token OAuth renovado se estiver
 * vencendo — e o token novo é SALVO (renovar só na memória perdia o refresh token rotativo).
 */
async function pluginsForTurn(s, agent) {
  const out = [];
  for (const orig of s.plugins || []) {
    let pl = resolvePluginWithVault(orig, { agentId: agent.id });
    const o = pl.auth?.oauth;
    if (pl.type === 'http' && o?.refreshToken && o.expiresAt && o.expiresAt < Date.now() + 120_000) {
      const r = await refreshPluginOAuthToken(pl).catch(e => ({ ok: false, error: e.message }));
      if (r.ok && r.tokens?.accessToken) {
        const flow = { clientId: pl.auth.clientId, clientSecret: pl.auth.clientSecret, tokenEndpoint: pl.auth.tokenEndpoint };
        const idx = db.settings.plugins.findIndex(x => x.name === orig.name);
        if (idx >= 0) { db.settings.plugins[idx] = persistOAuthTokensInVault(db.settings.plugins[idx], r.tokens, flow); save(); }
        pl = applyOAuthTokensToPlugin(pl, r.tokens, flow);
      } else console.warn('[conector] não renovou o token de', orig.name, r.error || '');
    }
    out.push(pl);
  }
  return out;
}

async function deliver(m) {
  const to = db.agents.find(a => a.id === m.to), from = db.agents.find(a => a.id === m.from);
  if (!to || !from) { markInboxDeliveryFailed(m, 'Agente não existe mais.'); save(); return; }
  inboxBusy.add(to.id); m.status = 'delivering'; save();
  try {
    const result = await runInboxDelivery(m, {});
    if (result.ok) { m.status = 'delivered'; m.error = null; }
    else markInboxDeliveryFailed(m, result.error || 'Sem resposta do destinatário.');
    if (result.reply?.content && m.protocol?.id === PROTOCOL_ID && m.protocol.delegationId && to.id === findDelegation(db, m.protocol.delegationId)?.workerId) {
      ingestWorkerInboxReply({
        db,
        id,
        worker: to,
        manager: from,
        delegationId: m.protocol.delegationId,
        replyText: result.reply.content,
        hops: m.hops,
        limits: inboxLimits()
      });
    }
    const origin = db.chats.find(x => x.id === m.originChatId);
    if (origin && result.reply?.content) {
      origin.messages.push({
        id: id(), role: 'assistant', agentId: to.id, content: result.reply.content, model: result.reply.model,
        via: { type: 'inbox', from: from.id, messageId: m.id, threadChatId: result.threadChatId }, at: Date.now()
      });
      origin.updatedAt = Date.now(); origin.unread = true;
    }
    if (result.reply?.content && result.ok) {
      try {
        await closeTaskFromInboxReply({
          db,
          inboxMessage: m,
          replyText: result.reply.content,
          id,
          limits: inboxLimits(),
          hops: m.hops || 0,
          googleTasksSync
        });
      } catch (e) { console.error('task-closure', ...redactForLog(db.settings, e.message)); }
    }
  } catch (e) { markInboxDeliveryFailed(m, e.message); console.error('mensagem', ...redactForLog(db.settings, e.message)); }
  finally { inboxBusy.delete(m.to); save(); setTimeout(dispatchInbox, 50); }
}
function dispatchInbox() {
  try {
    for (const m of dueMessages(db.messages, [...inboxBusy])) deliver(m);
  } catch (e) {
    console.error('inbox.dispatch_failed', e?.code || e?.message || String(e));
  }
}
const inboxTimer = setInterval(dispatchInbox, 5_000);
if (typeof inboxTimer.unref === 'function') inboxTimer.unref();
repairInboxOnStartup(db.messages);
save();
dispatchInbox();
startRetentionScheduler({ db, save, isStreaming: isChatStreaming });

const gate = new ApprovalGate({
  onChange: rec => {
    if (rec.status !== 'pending') {
      appendAudit(db, auditFromApproval(rec));
      recordCorporateAudit(db.settings, auditFromApprovalRecord(rec));
    }
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
      const link = await computer.share(port);
      if (computer.kind === 'boat') recordExternal({ kind: 'link.shared', agentId: agent.id, chatId: chat.id, target: String(link), text: `porta ${port}`, approved: autonomy === undefined ? 'user' : 'rule' });
      return link;
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

async function turn({ agent, chat, text, prompt, images, signal, group, hops = 0, mcpSession, credentialRefs }, emit) {
  const t0 = Date.now(), timing = {}; // tempos do turno: preparo, roteamento, 1ª palavra, total
  let s = settingsForMcp(db.settings, mcpSession);
  const vault = vaultContextFromSession(mcpSession, db);
  if (vault.dek) {
    s = { ...s, plugins: await resolvePluginsVaultSecrets(s.plugins || [], vault) };
  }
  if (credentialRefs?.length) {
    prompt += `\n\n[O usuário anexou credenciais guardadas no cofre (${credentialRefs.join(', ')}) para uso em conectores MCP. Nunca peça senha ou token em texto claro.]`;
  }
  const name = id => db.agents.find(a => a.id === id)?.name || 'Outro agente';
  // Em grupo, a fala dos colegas chega rotulada com o nome de quem falou.
  const label = m => labelMessageForAgent(m, agent.id, name, { group });
  // Histórico = tudo antes da pergunta atual; o que os colegas já responderam nesta rodada vai depois dela.
  const at = lastUserTurnIndex(chat.messages);
  const historySlice = at >= 0 ? chat.messages.slice(0, at) : chat.messages;
  const pruneCfg = normalizeContextPruning(s);
  const { messages: prunedSlice, pruned, stats: pruneStats } = pruneContextMessages(historySlice, pruneCfg);
  if (pruned) emit({ contextPrune: pruneStats });
  const history = trimHistory(prunedSlice).map(label);
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
      if (!reason) return Promise.resolve(true);
      // Ação arriscada (envio, compra, login…) aprovada: entra no registro de ações externas.
      return askApproval({ agent, chat, emit, signal }, 'browser', label, reason).then(ok => {
        if (ok) recordExternal({ kind: 'browser.action', agentId: agent.id, chatId: chat.id, target: label, text: reason, approved: 'user' });
        return ok;
      });
    };
    const denied = 'O usuário NÃO aprovou esta ação no navegador. Não tente contornar; explique o que ia fazer e pare.';
    browser = {
      open: url => { emit({ screen: true }); return b.open(url); },
      click: async t => (await ask('click', { target: t }, `clicar em “${t}”`)) ? b.click(t) : denied,
      type: async (t, txt, submit) => (await ask('type', { target: t, submit }, `digitar em “${t}”${submit ? ' e enviar' : ''}`)) ? b.type(t, txt, submit) : denied,
      scroll: dy => b.scroll(dy), read: () => b.read()
    };
  }
  const rawComputer = computer; // o Ripper usa sem pedir aprovação (ex.: git com token do Guardião); o agente só vê o guardado
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
  const x9Sources = () => collectX9Sources({ db, settings: s });
  const delivered = []; // arquivos entregues neste turno: viram botões na resposta
  const ctx = {
    db,
    settings: s,
    // Entrega um arquivo do computador do agente na conversa (Abrir / Baixar / Mostrar na pasta).
    deliverFile: async a => {
      const rel = vmPathToData(a.path, agent.id);
      if (!rel) return 'Caminho inválido: use um arquivo dentro de /work ou /shared.';
      const st = await stat(dataUrl(rel)).catch(() => null);
      if (!st?.isFile()) return `Arquivo não encontrado: ${a.path}. Confira o caminho com ls.`;
      const name = basename(rel);
      const rec = { id: id(), agentId: agent.id, projectId: chat.projectId || null, chatId: chat.id, name, type: mimeOf(name), size: st.size, path: rel, delivered: true, createdAt: Date.now() };
      db.files.push(rec); save();
      delivered.push(rec.id);
      const { path, ...pub } = rec;
      emit({ file: pub });
      return `"${name}" entregue: o usuário vê botões para abrir, baixar e mostrar na pasta. Não cite caminho, porta nem link.`;
    },
    x9: isEnterpriseMode(s) ? {
      context: () => JSON.stringify(x9Sources(), null, 2),
      checklist: () => JSON.stringify(runX9Scan({ db, settings: s, sources: x9Sources() }), null, 2)
    } : null,
    computer,
    browser,
    remember: async (t, tier = 'profile') => {
      if (!s.memory) return;
      const mine = db.memories.filter(m => m.agentId === agent.id);
      if (isDuplicateMemory(t, mine)) return; // já sabe: não incha o contexto de toda conversa
      tier = tier === 'log' ? 'log' : 'profile';
      // Perfil entra em toda conversa; a Julia rebaixa detalhe passageiro para o registro datado (nada se perde).
      if (tier === 'profile') {
        const j = await juliaChoose(db.settings, { context: `Memória que o agente ${agent.name} quer guardar no perfil do usuário.`, question: t, options: MEMORY_OPTIONS }, {
          minScore: 0.6, purpose: 'memory',
          avoidedPromptChars: measureTriagePromptChars({ context: '', question: t, options: MEMORY_OPTIONS })
        });
        if (j && j.index === 1) tier = 'log';
      }
      db.memories.push({ id: id(), agentId: agent.id, text: t, tier, createdAt: Date.now() });
      save(); emit({ memory: t, tier });
    },
    inbox: {
      send: a => {
        const to = findAgentByName(a.to, db.agents);
        const limits = { maxPerHour: 20, maxHops: 3, ...(s.inbox || {}) };
        const chk = checkSend({ from: agent, to, messages: db.messages, hops: hops + 1, limits, busyToIds: inboxBusy });
        if (chk.error) return chk.error;
        if (to) {
          const gate = canDelegate(
            { type: 'agent', id: agent.id },
            { type: 'agent', id: to.id },
            'send_message',
            db.accessControl,
            { agents: db.agents }
          );
          const denied = delegationDeniedMessage(gate);
          if (denied) return denied;
        }
        const m = { id: id(), from: agent.id, to: to.id, body: String(a.message).slice(0, 4000), priority: a.priority || 'normal', status: 'queued', hops: hops + 1, originChatId: chat.id, createdAt: Date.now() };
        db.messages.push(m);
        trackInboxDelegation(db, m, { id });
        if (db.messages.length > 1000) db.messages.splice(0, db.messages.length - 1000);
        save(); emit({ sent: { to: to.name, priority: m.priority } }); setTimeout(dispatchInbox, 50);
        return `Mensagem enviada para ${to.name}${m.priority === 'now' ? ' (urgente)' : ''}. A resposta aparece nesta conversa quando chegar; não espere por ela nem invente o que ${to.name} vai dizer.`;
      },
      call: async a => {
        const to = findAgentByName(a.to, db.agents);
        const limits = { maxPerHour: 20, maxHops: 3, ...(s.inbox || {}) };
        const chk = checkSend({ from: agent, to, messages: db.messages, hops: hops + 1, limits, busyToIds: inboxBusy });
        if (chk.error) return formatCallAgentResult({ ok: false, error: chk.error });
        if (to) {
          const gate = canDelegate(
            { type: 'agent', id: agent.id },
            { type: 'agent', id: to.id },
            'send_message',
            db.accessControl,
            { agents: db.agents }
          );
          const denied = delegationDeniedMessage(gate);
          if (denied) return formatCallAgentResult({ ok: false, error: denied });
        }
        const timeoutMs = clampCallTimeoutMs(a.timeout_seconds, s.inbox || {});
        const m = {
          id: id(), from: agent.id, to: to.id, kind: 'call',
          body: String(a.message).slice(0, 4000), priority: 'now', status: 'delivering',
          hops: hops + 1, originChatId: chat.id, createdAt: Date.now()
        };
        db.messages.push(m);
        if (db.messages.length > 1000) db.messages.splice(0, db.messages.length - 1000);
        inboxBusy.add(to.id);
        save();
        emit({ callAgent: { to: to.name, timeoutMs } });
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), timeoutMs);
        let result;
        try {
          result = await runInboxDelivery(m, { signal: ac.signal });
          if (result.ok) { m.status = 'delivered'; m.error = null; }
          else {
            const err = ac.signal.aborted && !result.error?.includes('interrompida')
              ? `Tempo esgotado (${Math.round(timeoutMs / 1000)}s) aguardando ${to.name}.`
              : (result.error || 'Sem resposta do destinatário.');
            markInboxDeliveryFailed(m, err);
            result = { ok: false, error: err };
          }
        } catch (e) {
          markInboxDeliveryFailed(m, e.message);
          result = { ok: false, error: e.message };
        } finally {
          clearTimeout(timer);
          inboxBusy.delete(to.id);
          save();
          setTimeout(dispatchInbox, 50);
        }
        return formatCallAgentResult(result);
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
    scheduleRoutine: a => { db.routines.push({ id: id(), agentId: agent.id, lastRun: 0, name: a.name, prompt: a.prompt, everyMinutes: a.everyMinutes, dailyAt: a.dailyAt, weekday: a.weekday }); save(); emit({ routine: a.name }); },
    // Só em conversa de canal externo (WhatsApp): o agente leva o recado para o dono no Ripper.
    // O dono responde lá, onde o agente tem conectores (agenda etc.) — quem é de fora nunca aciona nada.
    ownerNotify: chat.channel ? {
      send: a => {
        const key = `owner:${agent.id}`;
        let inbox = db.chats.find(x => x.channelKey === key);
        if (!inbox) { inbox = { id: id(), agentId: agent.id, channelKey: key, title: `${agent.name} · Avisos`, messages: [], createdAt: Date.now(), updatedAt: Date.now() }; db.chats.unshift(inbox); }
        const phone = String(chat.channelKey || '').split(':')[1] || '';
        const name = chat.title.replace(/^WhatsApp · /, '');
        const contact = name.includes(phone) ? `+${phone}` : `${name} (+${phone})`;
        inbox.messages.push({
          id: id(), role: 'assistant', agentId: agent.id, at: Date.now(),
          content: `**Recado do WhatsApp — ${contact}**\n\n${String(a.summary || '').trim()}${a.action ? `\n\n**Ação sugerida:** ${String(a.action).trim()}` : ''}\n\nResponda aqui (ex.: "pode marcar") que eu cuido e confirmo com o contato.`,
          via: { type: 'owner-notify', fromChatId: chat.id, contact, phone, summary: String(a.summary || '').trim(), action: String(a.action || '').trim() }
        });
        inbox.updatedAt = Date.now(); inbox.unread = true; save();
        recordCorporateAudit(db.settings, { category: 'whatsapp', action: 'whatsapp.owner_notified', agentId: agent.id, chatId: chat.id, at: Date.now() });
        return 'Recado entregue ao responsável no Ripper. Diga ao contato que vai confirmar e retorna em breve; não confirme nada antes disso.';
      }
    } : null,
    // GitHub (Guardião): lê só os repositórios configurados; comentar/abrir issue sempre com a sua aprovação.
    github: !chat.channel && githubReady(s.github) ? (() => {
      const g = s.github;
      const allowed = repo => g.repos.includes(normalizeRepo(repo));
      const write = async (kind, repo, label, run) => {
        if (!allowed(repo)) return `${repo} não está na lista do Guardião (Configurações → Canais → GitHub).`;
        const ok = await askApproval({ agent, chat, emit, signal }, 'github', label, 'Publica no GitHub em seu nome.', false);
        if (!ok) return 'O usuário NÃO aprovou. Nada foi publicado.';
        try { const r = await run(); recordExternal({ kind, agentId: agent.id, chatId: chat.id, target: r.html_url || repo, approved: 'user' }); return `Publicado: ${r.html_url}`; }
        catch (e) { recordExternal({ kind, agentId: agent.id, chatId: chat.id, target: repo, approved: 'user', ok: false, error: e.message }); return `Falhou: ${e.message}`; }
      };
      return {
        read: async a => {
          const path = '/' + String(a.path || '').replace(/^\/+/, '');
          const m = /^\/repos\/([\w.-]+\/[\w.-]+)/.exec(path);
          if (!m || !allowed(m[1])) return `Só leio os repositórios do Guardião: ${g.repos.join(', ')}.`;
          try {
            const r = await gh(g, path, a.diff ? { accept: 'application/vnd.github.diff' } : {});
            const out = typeof r === 'string' ? r : JSON.stringify(r, null, 1);
            return out.length > 30000 ? out.slice(0, 30000) + '\n[… cortado]' : out;
          } catch (e) { return e.message; }
        },
        comment: a => write('github.comment', a.repo, `Comentar em ${a.repo} #${a.number}:\n\n${a.text}`, () => gh(g, `/repos/${normalizeRepo(a.repo)}/issues/${a.number}/comments`, { method: 'POST', body: { body: a.text } })),
        issue: a => write('github.issue', a.repo, `Abrir issue em ${a.repo}: ${a.title}\n\n${a.text}`, () => gh(g, `/repos/${normalizeRepo(a.repo)}/issues`, { method: 'POST', body: { title: a.title, body: a.text } })),
        // Clonar e enviar branch: o token vai só no comando (cabeçalho HTTP), nunca fica salvo no repositório nem aparece na saída.
        ...(rawComputer?.kind === 'docker' ? (() => {
          const auth = gitAuthArg(g.token), hide = out => hideToken(out, g.token);
          const dir = repo => `/work/repos/${normalizeRepo(repo).split('/')[1]}`;
          const okExit = out => /\[exit 0\]\s*$/.test(out);
          return {
            clone: async a => {
              const repo = normalizeRepo(a.repo);
              if (!allowed(repo)) return `${a.repo} não está na lista do Guardião.`;
              const d = dir(repo);
              const out = await rawComputer.exec(`if [ -d ${d}/.git ]; then git -C ${d} ${auth} fetch -q --prune origin && git -C ${d} checkout -q $(git -C ${d} remote show origin | sed -n 's/.*HEAD branch: //p') && git -C ${d} reset -q --hard @{u}; else mkdir -p /work/repos && git ${auth} clone -q https://github.com/${repo}.git ${d}; fi && git -C ${d} config user.name "${agent.name} (Ripper)" && git -C ${d} config user.email "ripper@users.noreply.github.com" && git -C ${d} log --oneline -1`);
              return okExit(out) ? `Pronto em ${d} (branch principal atualizado). Crie um branch ripper/<algo>, corrija, rode os testes e faça commit; depois github_open_pr.\n${hide(out)}` : `Falhou ao clonar:\n${hide(out)}`;
            },
            openPr: async a => {
              const repo = normalizeRepo(a.repo);
              if (!allowed(repo)) return `${a.repo} não está na lista do Guardião.`;
              const branch = prBranch(a.branch);
              const d = dir(repo);
              const info = await gh(g, `/repos/${repo}`);
              const stat = await rawComputer.exec(`git -C ${d} branch -f ${branch} HEAD && git -C ${d} diff --stat origin/${info.default_branch}...${branch} | tail -20 && git -C ${d} log --oneline origin/${info.default_branch}..${branch} | head -10`);
              if (!okExit(stat) || !/\d+ files? changed/.test(stat)) return `Nada para enviar: faça commit das mudanças em ${d} primeiro.\n${hide(stat)}`;
              const ok = await askApproval({ agent, chat, emit, signal }, 'github', `Abrir PR em ${repo}: ${a.title}\nBranch ${branch} → ${info.default_branch}\n\n${hide(stat).replace(/\[exit 0\]\s*$/, '')}\n${a.body}`, 'Envia o branch e abre o PR no GitHub em seu nome.', false);
              if (!ok) return 'O usuário NÃO aprovou. Nada foi enviado.';
              const push = await rawComputer.exec(`git -C ${d} ${auth} push -q -f origin ${branch}:refs/heads/${branch}`);
              if (!okExit(push)) { recordExternal({ kind: 'github.pr', agentId: agent.id, chatId: chat.id, target: repo, approved: 'user', ok: false, error: hide(push).slice(0, 300) }); return `Falhou ao enviar o branch:\n${hide(push)}`; }
              try {
                const pr = await gh(g, `/repos/${repo}/pulls`, { method: 'POST', body: { title: a.title, body: `${a.body}\n\n---\nAberto por ${agent.name} (Ripper) com a aprovação do dono.`, head: branch, base: info.default_branch } });
                recordExternal({ kind: 'github.pr', agentId: agent.id, chatId: chat.id, target: pr.html_url, approved: 'user' });
                return `PR aberto: ${pr.html_url}`;
              } catch (e) { recordExternal({ kind: 'github.pr', agentId: agent.id, chatId: chat.id, target: repo, approved: 'user', ok: false, error: e.message }); return `Branch enviado, mas o PR falhou: ${e.message}`; }
            }
          };
        })() : {})
      };
    })() : null,
    // E-mail (IMAP/SMTP): lê ao vivo, sem cópia local; enviar sempre com a sua aprovação. Só em conversa sua.
    email: !chat.channel && emailReady(s.email) ? {
      list: async a => {
        recordCorporateAudit(db.settings, { category: 'email', action: 'email.list', agentId: agent.id, chatId: chat.id, at: Date.now() });
        try {
          const rows = await listEmails(s.email, { query: a.query, unread: a.unread, sinceDays: a.days, limit: a.limit });
          return rows.length ? rows.map(r => `uid ${r.uid} · ${new Date(r.at).toLocaleString('pt-BR')} · ${r.from} · "${r.subject}"${r.unread ? ' · não lido' : ''}`).join(String.fromCharCode(10)) : 'Nenhum e-mail encontrado nesse período.';
        } catch (e) { return `Não consegui abrir a caixa de e-mail: ${e.message}`; }
      },
      read: async a => {
        recordCorporateAudit(db.settings, { category: 'email', action: 'email.read', agentId: agent.id, chatId: chat.id, at: Date.now() });
        try {
          const m = await readEmail(s.email, a.uid);
          return m ? `De: ${m.from}
Assunto: ${m.subject}
Data: ${new Date(m.at).toLocaleString('pt-BR')}${m.attachments.length ? `\nAnexos (baixe com email_attachment): ${m.attachments.map(x => `${x.name} (${fmtBytes(x.size)})`).join(', ')}` : ''}

${m.text}` : 'E-mail não encontrado.';
        } catch (e) { return `Não consegui ler o e-mail: ${e.message}`; }
      },
      attachment: async a => {
        recordCorporateAudit(db.settings, { category: 'email', action: 'email.attachment', agentId: agent.id, chatId: chat.id, at: Date.now() });
        let att;
        try { att = await getAttachment(s.email, a.uid, a.name); } catch (e) { return `Não consegui baixar o anexo: ${e.message}`; }
        if (!att) return `Anexo "${a.name}" não encontrado nesse e-mail. Confira os nomes com email_read.`;
        const name = safeName(att.name), rel = `sandbox/${agent.id}/anexos/${name}`;
        mkdirSync(dataUrl(`sandbox/${agent.id}/anexos/`), { recursive: true });
        await writeFile(dataUrl(rel), att.content);
        // aparece na conversa com Abrir / Baixar / Mostrar na pasta
        const rec = { id: id(), agentId: agent.id, projectId: chat.projectId || null, chatId: chat.id, name, type: att.type || mimeOf(name), size: att.content.length, path: rel, delivered: true, createdAt: Date.now() };
        db.files.push(rec); save();
        delivered.push(rec.id); { const { path, ...pub } = rec; emit({ file: pub }); }
        const vm = `/work/anexos/${name}`, txt = attachmentText(name, att.content), hint = readHint(vm);
        return [`Anexo salvo: ${vm} (${fmtBytes(att.content.length)}). O usuário já vê o arquivo na conversa.`,
          txt != null ? `Conteúdo:\n${txt}` : hint ? (rawComputer ? `Para ler, rode no computador:\n${hint}` : 'Para ler o conteúdo, este agente precisa de computador (Habilidades → Computador).') : ''].filter(Boolean).join('\n\n');
      },
      send: async a => {
        let to = String(a.to || '').trim(), subject = String(a.subject || '').trim(), inReplyTo;
        if (a.reply_to_uid) {
          const orig = await readEmail(s.email, a.reply_to_uid).catch(() => null);
          if (orig) { to ||= orig.replyTo; inReplyTo = orig.messageId; if (!subject) subject = /^re:/i.test(orig.subject) ? orig.subject : `Re: ${orig.subject}`; }
        }
        if (!/@/.test(to) || !a.text?.trim()) return 'Informe o destinatário (e-mail) e o texto.';
        const attachments = [];
        for (const f of a.files || []) {
          const rel = vmPathToData(f, agent.id);
          const st = rel && await stat(dataUrl(rel)).catch(() => null);
          if (!st?.isFile()) return `Arquivo não encontrado: ${f}. Use um caminho em /work ou /shared (confira com ls).`;
          attachments.push({ filename: basename(rel), path: fileURLToPath(dataUrl(rel)), size: st.size });
        }
        if (attachments.reduce((n, x) => n + x.size, 0) > 20 * 1024 * 1024) return 'Os anexos passam de 20 MB: a maioria dos provedores recusa. Mande um link ou divida.';
        const ok = await askApproval({ agent, chat, emit, signal }, 'email', `Para ${to}
Assunto: ${subject}${attachments.length ? `\nAnexos: ${attachments.map(x => `${x.filename} (${fmtBytes(x.size)})`).join(', ')}` : ''}

${a.text}`, 'O e-mail sai da sua conta em seu nome.', false);
        if (!ok) return 'O usuário NÃO aprovou o envio. Nada foi enviado.';
        try { await sendEmail(s.email, { to, subject, text: a.text, inReplyTo, attachments: attachments.map(({ filename, path }) => ({ filename, path })) }); }
        catch (e) {
          recordExternal({ kind: 'email.sent', agentId: agent.id, chatId: chat.id, target: to, text: a.text, approved: 'user', ok: false, error: e.message });
          return `Falha ao enviar o e-mail: ${e.message}`;
        }
        recordExternal({ kind: 'email.sent', agentId: agent.id, chatId: chat.id, target: to, text: a.text, approved: 'user' });
        return `E-mail enviado para ${to}.`;
      }
    } : null,
    // Enviar WhatsApp pela API conectada (QR/Evolution ou Meta) — nunca pelo navegador.
    // Só em conversa sua com o agente (não em conversa de canal externo) e sempre com a sua aprovação.
    // Enviar não depende de 'Responder mensagens' (resposta automática): basta o QR com lista de números, ou a API oficial pronta.
    whatsapp: !chat.channel && isEnterpriseMode(s) && (s.whatsappWeb?.allowlist?.length || s.whatsappWeb?.readAll || whatsappReady(s.whatsapp)) ? {
      // Leitura (opt-in "Ler conversas"): cada leitura vai para a auditoria.
      canRead: !!s.whatsappWeb?.readAll,
      chats: a => {
        recordCorporateAudit(db.settings, { category: 'whatsapp', action: 'whatsapp.list_chats', agentId: agent.id, chatId: chat.id, at: Date.now() });
        const rows = waListChats(a.limit);
        return rows.length ? rows.map(r => `${r.phone.startsWith('g') ? 'Grupo' : '+' + r.phone}${r.name ? ` (${r.name})` : ''} · ${new Date(r.lastAt).toLocaleString('pt-BR')}${r.unread ? ` · ${r.unread} não lida(s)` : ''} · "${String(r.last || '').slice(0, 80)}"`).join(String.fromCharCode(10)) : 'Nenhuma conversa guardada ainda (só a partir de quando a leitura foi ligada).';
      },
      read: a => {
        const typed = String(a.contact || '').replace(/\D/g, '');
        const phone = typed.length >= 10 ? typed : waFindContacts(a.contact, 1)[0]?.phone;
        if (!phone) return `Contato "${a.contact}" não encontrado.`;
        recordCorporateAudit(db.settings, { category: 'whatsapp', action: 'whatsapp.read_chat', agentId: agent.id, chatId: chat.id, at: Date.now() });
        const rows = waReadChat(phone, a.limit);
        return rows.length ? rows.map(r => `[${new Date(r.at).toLocaleString('pt-BR')}] ${r.fromMe ? 'Você' : 'Contato'}: ${r.text}`).join(String.fromCharCode(10)) : 'Sem mensagens guardadas com esse contato.';
      },
      contacts: a => {
        const rows = waFindContacts(a.query, a.limit);
        return rows.length ? rows.map(r => `${r.phone.startsWith('g') ? 'Grupo' : '+' + r.phone}${r.name ? ` — ${r.name}` : ''}`).join(String.fromCharCode(10)) : 'Nenhum contato encontrado.';
      },
      send: async a => {
        const to = String(a.to || '').replace(/\D/g, ''), msgText = String(a.text || '').trim();
        if (to.length < 10 || !msgText) return 'Informe o número com DDI e DDD (ex.: +55 16 99999-9999) e o texto.';
        const viaQr = !!s.whatsappWeb?.allowlist?.length;
        if (viaQr && !contactMode(to, s.whatsappWeb)) return `+${to} não está na lista de números permitidos do WhatsApp (Configurações → Plugins → Canal WhatsApp). Nada foi enviado.`;
        const ok = await askApproval({ agent, chat, emit, signal }, 'whatsapp', `Para +${to}:\n${msgText}`, 'A mensagem sai no WhatsApp em seu nome.', false);
        if (!ok) return 'O usuário NÃO aprovou o envio. Nada foi enviado.';
        try { viaQr ? await sendEvolutionText(to, msgText) : await sendWhatsappText(s.whatsapp, to, msgText); }
        catch (e) {
          recordExternal({ kind: 'whatsapp.sent', agentId: agent.id, chatId: chat.id, target: `+${to}`, text: msgText, approved: 'user', ok: false, error: e.message });
          return `Falha ao enviar pelo WhatsApp: ${e.message}${viaQr ? '' : ' (na API oficial, fora da janela de 24 h só vale mensagem de template)'}`; }
        // Vai para o histórico do WhatsApp (o agente vê a continuação); não vira conversa no Ripper.
        recordWaMessage({ id: `out-${id()}`, phone: to, fromMe: true, text: msgText });
        recordExternal({ kind: 'whatsapp.sent', agentId: agent.id, chatId: chat.id, target: `+${to}`, text: msgText, approved: 'user' });
        return `Mensagem enviada para +${to}.`;
      }
    } : null,
    social: agent.tools.includes('social') && isFlagEnabled(s, 'socialWebhooks') ? {
      webhooks: enabledSocialWebhooks(s),
      list: () => {
        const rows = enabledSocialWebhooks(s).map(h => ({ id: h.id, name: h.name }));
        return rows.length
          ? `Webhooks ativos: ${rows.map(r => `${r.name} (${r.id})`).join('; ')}`
          : 'Nenhum webhook social ativo. Configure em Conectores → Webhooks sociais.';
      },
      post: async a => {
        const hook = resolveSocialWebhook(s, a.webhookId);
        const body = String(a.text || '');
        if (!body.trim()) return 'Texto vazio; nada a publicar.';
        if (a.draft) return `Rascunho para "${hook.name}" (não enviado):\n${body.slice(0, 2000)}`;
        const autonomy = socialPostAutonomyGate(agent, s);
        if (typeof autonomy === 'string') return `Esta ação não é permitida (${autonomy}).`;
        const cmd = socialApprovalCommand(hook, body);
        const globalPolicy = s.approvalPolicy || 'risky';
        const policy = effectiveApprovalPolicy(agent, globalPolicy, s);
        const reason = autonomy === null ? null : socialPostNeedsApproval({ policy, commandKey: cmd, allowed: chat.allowedCommands || [] });
        if (reason && !(await askApproval({ agent, chat, emit, signal }, 'social', cmd, reason))) {
          return 'O usuário NÃO aprovou publicar neste webhook. Não tente contornar; ofereça editar o rascunho ou publicar depois.';
        }
        const result = await postToSocialWebhook(hook, body);
        recordExternal({ kind: 'social.posted', agentId: agent.id, chatId: chat.id, target: hook.name, text: body, approved: reason ? 'user' : 'rule', ok: !!result.ok, error: result.ok ? undefined : `HTTP ${result.status}` });
        if (!result.ok) return `Webhook respondeu ${result.status}: ${result.body || '(sem corpo)'}`;
        return `Publicado em "${hook.name}" (HTTP ${result.status}).`;
      }
    } : null
  };
  // Uso pago (OpenRouter, Claude por API key): soma o custo real e avisa na Caixa ao bater o limite.
  let turnCost = 0;
  const chargePaid = usd => {
    turnCost += usd;
    const hit = addSpend(db, s, agent.id, usd);
    if (hit) alertSpendLimit(agent, hit);
    save();
  };
  // Subtarefas em paralelo: cada uma é um turno curto do mesmo agente (web + computador, sem delegar nem histórico).
  const subtaskSteps = []; // estado final de cada subtarefa: fica salvo na resposta
  ctx.parallel = {
    run: async tasks => {
      const subModel = enabledModels(s).includes('claude-sonnet-5-5') ? 'claude-sonnet-5-5' : enabledModels(s).find(m => MODELS[m].provider === 'claude');
      if (!subModel) return 'Nenhum modelo Claude liberado para subtarefas.';
      const paidWhy = isPaidModel(subModel, s) && paidBlockReason(db, s, agent.id);
      if (paidWhy) return paidWhy;
      const batch = id();
      const subCtx = { db, settings: s, computer, deliverFile: ctx.deliverFile };
      const subAgent = { ...agent, tools: agent.tools.filter(t => ['web', 'computer'].includes(t)) };
      const system = `${systemPrompt(subAgent, s)}\n\nVocê executa UMA subtarefa de um pedido maior, em paralelo com outras. Entregue só o resultado, completo e direto.`;
      const results = await Promise.all(tasks.map(async (t, i) => {
        const key = `${batch}:${i}`;
        emit({ subtask: { key, title: t.title, status: 'running', chars: 0 } });
        let out = '';
        try {
          for await (const ev of runClaude({ agent: subAgent, model: subModel, effort: 'medium', prompt: t.prompt, history: [], system, settings: s, ctx: subCtx, signal })) {
            if (ev.cost) chargePaid(ev.cost);
            if (ev.text) { out += ev.text; if (out.length % 400 < ev.text.length) emit({ subtask: { key, title: t.title, status: 'running', chars: out.length } }); }
          }
          recordUsage(db, subModel, { charsIn: t.prompt.length, charsOut: out.length, routedBy: 'parallel', agentId: agent.id });
          emit({ subtask: { key, title: t.title, status: 'done', chars: out.length } });
          subtaskSteps.push({ kind: 'subtask', key, title: t.title, status: 'done', chars: out.length });
          return `## ${t.title}\n${out.trim() || '(sem resultado)'}`;
        } catch (e) {
          emit({ subtask: { key, title: t.title, status: 'error', chars: out.length } });
          subtaskSteps.push({ kind: 'subtask', key, title: t.title, status: 'error', chars: out.length });
          return `## ${t.title}\nFalhou: ${e.message}`;
        }
      }));
      return results.join('\n\n');
    }
  };
  const project = chat.projectId && db.projects.find(p => p.id === chat.projectId);
  const systemStable = systemPrompt(agent, s);
  const system = [
    systemStable,
    memoryContext(memories, s.memoryLogInContext ?? 10),
    await projectContext(project),
    visibleArtifacts(chat).length && `Artefatos do time (leia com read_artifact; salve entregas com save_artifact): ${visibleArtifacts(chat).slice(-20).map(x => `"${x.title}" (${x.kind}, v${x.version})`).join('; ')}`,
    (() => {
      const others = db.agents.filter(a => a.id !== agent.id && a.status !== 'paused' && peerAllowed(agent, a));
      if (!others.length) return '';
      return `Colegas A2A — call_agent (resposta imediata, espere o retorno) ou send_message (assíncrono, não espere): ${others.map(a => `${a.name} (${a.description || a.category})`).join('; ')}.`;
    })(),
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
  const chosen = (chat.model && chat.model in MODELS ? chat.model : null) || agent.model || s.defaultModel;
  // Modelo desligado em Configurações → Modelos vira Auto (que só escolhe entre os liberados).
  const model = chosen === 'auto' || enabledModels(s).includes(chosen) ? chosen : 'auto';
  const requestedEffort = (chat.effort && chat.effort !== 'auto' ? chat.effort : null) || agent.effort || 'auto';
  const corrections = (db.juliaCorrections || []).filter(x => x.agentId === agent.id).slice(-20);
  timing.prepMs = Date.now() - t0;
  const pick = model === 'auto' ? await route(text, history, s, { effort: requestedEffort, corrections }) : { model, by: 'manual' };
  // A Julia pode ter escolhido o esforço; em todo caso, nunca passa do teto do modelo.
  const effort = clampEffort(s, pick.model, pick.effort || requestedEffort);
  const routedBy = pick.by;
  // Sem o CLI do Codex instalado, o Auto nunca o escolhe (evita uma falha e um desvio a cada pedido de código).
  if (pick.model === 'codex' && !(await codexInstalled)) pick.model = enabledModels(s).find(m => MODELS[m].provider === 'claude') || 'claude-sonnet-5-5';
  timing.routeMs = Date.now() - t0 - timing.prepMs;
  emit({ route: { ...pick, effort } });

  const testProvider = process.env.RIPPER_TEST_PROVIDER;
  const order = testProvider
    ? [pick.model]
    : providerAttemptOrder(pick.model, await codexInstalled).filter((m, i) => i === 0 || enabledModels(s).includes(m));
  // Reserva fora do Claude (Codex, OpenRouter) com o Sonnet desligado: cai no primeiro Claude liberado.
  const claudeBackup = enabledModels(s).find(m => MODELS[m].provider === 'claude' && m !== pick.model);
  if (!testProvider && order.length === 1 && MODELS[pick.model]?.provider !== 'claude' && claudeBackup) order.push(claudeBackup);
  const push = (out, steps, extra) => chat.messages.push({
    id: id(), role: 'assistant', agentId: agent.id, content: out, at: Date.now(),
    ...(steps.length || subtaskSteps.length ? { steps: [...subtaskSteps, ...steps] } : {}), ...extra
  });

  const semanticCacheCfg = resolveSemanticCacheConfig(s);
  const cacheContext = history.join('\n').slice(-2000);
  const canUseSemanticCache = semanticCacheCfg.enabled && !images?.length && !testProvider;
  if (canUseSemanticCache) {
    const cached = lookupSemanticCache({
      agentId: agent.id,
      model: pick.model,
      question: text,
      context: cacheContext,
      config: semanticCacheCfg
    });
    if (cached.hit) {
      emit({ semanticCache: { hit: true, score: cached.score } });
      push(cached.answer, [], {
        model: pick.model,
        effort,
        routedBy,
        semanticCache: { hit: true, score: cached.score }
      });
      recordChatTurn('ok');
      return;
    }
    emit({ semanticCache: { hit: false } });
  }

  const loopDetector = new ToolLoopDetector(s.tokenBudget);
  const emitTurn = ev => {
    if (ev.circuitBreaker) {
      logger.warn('provider.circuit_breaker', {
        chatId: chat.id,
        provider: ev.circuitBreaker.provider,
        state: ev.circuitBreaker.state,
        model: ev.circuitBreaker.model,
        retryAfterMs: ev.circuitBreaker.retryAfterMs,
        probe: ev.circuitBreaker.probe
      });
    }
    if (ev.tool) {
      const hit = loopDetector.observe(ev.tool);
      if (hit.loop) {
        emit({ tokenBudget: { kind: 'tool_loop', tool: hit.tool, count: hit.count, message: hit.message }, stopped: true });
        emit({ warn: hit.message });
        cancelChatStream(chat.id, 'tool_loop'); // antes era signal.abort(), que não existe em AbortSignal: o loop nunca parava
        return;
      }
    }
    if (ev.cost) { chargePaid(ev.cost); return; }
    if (ev.text && timing.firstMs == null) timing.firstMs = Date.now() - t0;
    emit(ev);
  };
  const turnPlugins = await pluginsForTurn(s, agent); // cofre + token renovado, uma vez por turno
  const loopResult = await runProviderAttemptLoop({
    order,
    signal,
    retry: normalizeProviderRetry(s),
    emit: emitTurn,
    runModel: m => {
      const chaosErr = maybeChaosProviderFailure(resolveEffectiveChaos(db.settings));
      if (chaosErr) throw chaosErr;
      if (testProvider) return runTestProvider({ prompt, signal });
      const paidWhy = isPaidModel(m, s) && paidBlockReason(db, s, agent.id);
      if (paidWhy) throw new Error(paidWhy); // a fila de tentativas cai para o próximo modelo (ex.: assinatura)
      const providerSystem = MODELS[m].provider === 'codex' && s.computer.mode !== 'local'
        ? `${system}\n\nNesta execução do Codex, o computador está em modo somente leitura; não prometa executar comandos nem acessar a VM Boat.` : system;
      const args = { agent, effort: clampEffort(s, m, effort), prompt, images, history, system: providerSystem, systemStable, settings: { ...s, plugins: turnPlugins }, signal };
      if (MODELS[m].provider in COMPAT) return runOpenRouter({ ...args, model: m, ctx }); // OpenRouter, OpenAI, Gemini, Ollama
      return MODELS[m].provider === 'codex'
        ? runCodex({ ...args, cwd: sandboxDir(agent), ctx })
        : runClaude({ ...args, model: m, ctx });
    },
    onSuccess: ({ model: m, out, steps }) => {
      timing.totalMs = Date.now() - t0;
      logger.info('turn.timing', { agent: agent.name, model: m, ...timing });
      push(out, steps, { model: m, effort, routedBy, timing, ...(turnCost ? { costUsd: turnCost } : {}), ...(delivered.length ? { files: [...delivered] } : {}) });
      recordUsage(db, m, {
        charsIn: (text?.length || 0) + (prompt?.length || 0),
        charsOut: out.length,
        routedBy,
        agentId: agent.id
      });
      if (canUseSemanticCache) {
        storeSemanticCacheEntry({
          agentId: agent.id,
          model: m,
          question: text,
          context: cacheContext,
          answer: out,
          effort,
          config: semanticCacheCfg
        });
      }
      if (MODELS[m].provider === 'claude') {
        refreshClaudeSubscriptionUsage(db, s).then(() => save()).catch(() => {});
      }
    },
    onAttemptFailed: async ({ model: m, error: e, aborted, canFallback, out, steps }) => {
      if (aborted) { push(out, steps, { model: m, stopped: true, stopReason: typeof signal?.reason === 'string' ? signal.reason : 'user' }); return; }
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
  if (loopResult.aborted) recordChatTurn('interrupted');
  else if (loopResult.ok) recordChatTurn('ok');
  else recordChatTurn('error');
}

async function chat({ chat, text, fileIds, signal, mcpSession, skipUserPush = false, credentialRefs, voice }, emit) {
  logger.info('chat.turn.start', { chatId: chat.id, resume: skipUserPush });
  const refs = (credentialRefs || []).filter(isVaultRef);
  try {
  if (!skipUserPush) {
    const uid = id();
    chat.messages.push({
      id: uid, role: 'user', content: text, files: fileIds?.length ? fileIds : undefined,
      ...(refs.length ? { credentialRefs: refs } : {}),
      ...(voice ? { voice: true } : {}), // ditado: aparece em itálico
      at: Date.now()
    });
    if (chat.run?.status === 'running' && !chat.run.userMessageId) chat.run.userMessageId = uid;
  }
  const members = groupMembers(chat, db.agents);
  const group = members.length > 1 ? members : null;
  // Julia 1 (ou a heurística) escolhe quem abre; @menções definem a ordem; delegações entram na fila.
  const first = await selectSpeakers(chat, text, db.agents, (t, ms) => classifySpeaker(t, ms, db.settings, heuristicSpeaker));
  const floor = new Floor(first, members, group ? 5 : 1);
  if (group) emit({ turnPlan: turnPlanIds(first, floor) });
  for (let agent = floor.next(); agent; agent = floor.next()) {
    if (signal?.aborted) break;
    const runBudget = checkRunBudget(db, db.settings, { agentId: agent.id });
    if (runBudget.blocked) {
      const alert = tokenBudgetAlertFromCheck(runBudget) || { kind: runBudget.kind, message: runBudget.userMessage };
      emit({ tokenBudget: alert, stopped: true });
      if (runBudget.userMessage) emit({ warn: runBudget.userMessage });
      break;
    }
    emit({ speaker: agent.id });
    await syncLocalFiles(agent, chat);
    const extra = await buildMessageAttachments(db, agent, chat, fileIds);
    for (const w of attachmentWarnings(extra)) emit({ warn: w });
    const before = chat.messages.length;
    await turn({
      agent, chat, text,
      prompt: extra.text ? `${text}\n\n${extra.text}` : text,
      images: extra.images, signal, group, mcpSession, credentialRefs: refs
    }, emit);
    const reply = chat.messages.length > before ? chat.messages.at(-1) : null;
    if (group && reply && isPass(reply.content)) { chat.messages.pop(); emit({ passed: agent.id }); }
    else if (group && reply) {
      const deniedPeers = [];
      const next = floor.afterReply(agent, reply.content, {
        allowPeer: peer => {
          const gate = canDelegate(
            { type: 'agent', id: agent.id },
            { type: 'agent', id: peer.id },
            'delegate_task',
            db.accessControl,
            { agents: db.agents }
          );
          if (!gate.ok) { deniedPeers.push(gate); return false; }
          return true;
        }
      });
      for (const gate of deniedPeers) emit({ warn: delegationDeniedMessage(gate) });
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
  } finally {
    logger.info('chat.turn.end', { chatId: chat.id });
  }
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
  const headers = hdr(req, { 'content-type': (MIME[extname(file)] || 'application/octet-stream') + (/\.(html|js|css)$/.test(file) ? '; charset=utf-8' : ''), etag: e.etag, 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', vary: 'accept-encoding' });
  if (req.headers['if-none-match'] === e.etag) { res.writeHead(304, headers); return res.end(); }
  const gz = /gzip/.test(req.headers['accept-encoding'] || '') && /\.(html|js|css|svg|json)$/.test(file);
  res.writeHead(200, gz ? { ...headers, 'content-encoding': 'gzip' } : headers);
  res.end(gz ? e.gz : e.buf);
}

const routes = [
  ['GET', /^\/api\/health$/, () => probePayload()],
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
    const templates = isEnterpriseMode(db.settings) ? TEMPLATES : TEMPLATES.filter(t => t.id !== 'x9-auditor');
    json(res, { models: MODELS, templates, categories: CATEGORIES }, 200, { 'cache-control': 'public, max-age=3600' }, req);
    return undefined;
  }],
  ['GET', /^\/api\/data\/backup$/, () => buildBackupPayload(db)],
  ['GET', /^\/api\/data\/backups$/, () => ({ auto: listAutoBackups(), snapshots: listDataSnapshots() })],
  ['POST', /^\/api\/data\/restore$/, async req => {
    const b = await body(req);
    if (!b.confirm) throw new HttpError(400, 'Envie confirm: true para substituir o estado local.');
    const payload = b.backup && b.backup.db ? b.backup : b;
    recordCorporateAudit(db.settings, auditDataRestore({
      schemaVersion: payload?.db?.schemaVersion,
      agents: payload?.db?.agents?.length,
      chats: payload?.db?.chats?.length
    }));
    return restoreBackupPayload(db, payload);
  }],
  ['POST', /^\/api\/backup$/, async () => {
    const created = createDataSnapshot({ reason: 'manual' });
    const cfg = normalizeBackupSettings(db.settings.backup);
    const removed = pruneOldSnapshots(cfg.keepCount);
    save();
    return { ok: true, ...created, removed };
  }],
  ['GET', /^\/api\/backup\/list$/, () => ({ snapshots: listDataSnapshots(), auto: listAutoBackups() })],
  ['POST', /^\/api\/backup\/restore$/, async req => {
    const b = await body(req);
    if (!b.confirm) throw new HttpError(400, 'Envie confirm: true — o restore sobrescreve os dados vivos em RIPPER_DATA.');
    if (!b.id && !b.path) throw new HttpError(400, 'Informe id (snapshot em backups/) ou path relativo a backups/.');
    try {
      return await restoreDataSnapshot(db, { confirm: true, id: b.id, path: b.path });
    } catch (e) {
      throw new HttpError(400, e.message);
    }
  }],
  ['GET', /^\/api\/state$/, () => ({
    settings: redact(db.settings), agents: db.agents, models: MODELS,
    templates: isEnterpriseMode(db.settings) ? TEMPLATES : TEMPLATES.filter(t => t.id !== 'x9-auditor'),
    savedAgentTemplates: listAgentTemplates(db), categories: CATEGORIES,
    chats: db.chats.map(summary), routines: db.routines.map(redactRoutine),
    files: db.files.map(({ path, ...f }) => f), memoriesCount: db.memories.length, pendingInbox: db.messages.filter(m => m.status === 'queued' || m.status === 'delivering').reduce((o, m) => (o[m.originChatId] = (o[m.originChatId] || 0) + 1, o), {}), approvals: db.approvals.filter(a => a.status === 'pending').map(approvalView), artifacts: db.artifacts.map(({ content, size, blob, ...a }) => ({ ...a, size: size ?? content?.length ?? 0, stored: blob ? 'disk' : 'inline' })),     skills: db.skills, memoriesByAgent: db.memories.reduce((o, x) => (o[x.agentId] = (o[x.agentId] || 0) + 1, o), {}), projects: db.projects,
    usage: usageSummary(db),
    paidSpend: spendToday(db),
    agentStats: (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return agentDayStats(listUsageEventsSince(d.getTime()), db.chats, d.getTime()); })(),
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
    })(),
    meta: { ...settingsMeta(), codexInstalled: codexOk },
    inboxCount: buildInbox(db).count
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
  ['GET', /^\/api\/usage\/token-roi$/, async () => {
    requireEnterpriseAdmin();
    return { ...buildTokenRoiContract(), routing: routingSummary(db) };
  }],
  ['GET', /^\/api\/metering$/, async (req, _, url) => {
    requireEnterpriseAdmin();
    const now = Date.now();
    const since = parseMeteringMsParam(url.searchParams.get('since'), now - 30 * 86400_000);
    const until = parseMeteringMsParam(url.searchParams.get('until'), now);
    await refreshClaudeSubscriptionUsage(db, db.settings).catch(() => {});
    save();
    return buildMeteringReport(db, db.settings, { since, until });
  }],
  ['GET', /^\/api\/metering\/export$/, async (req, _, url, res) => {
    requireEnterpriseAdmin();
    const now = Date.now();
    const since = parseMeteringMsParam(url.searchParams.get('since'), now - 30 * 86400_000);
    const until = parseMeteringMsParam(url.searchParams.get('until'), now);
    const events = listMeteringEvents({ since, until });
    const csv = usageEventsToCsv(events);
    const name = `ripper-usage-events-${new Date().toISOString().slice(0, 10)}.csv`;
    res.writeHead(200, hdr(req, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'private, max-age=60'
    }));
    res.end(csv);
  }],
  ['POST', /^\/api\/mcp\/verify$/, async req => {
    const b = await body(req);
    if (b.type === 'stdio' || b.command) {
      return verifyMcpConnector({
        name: String(b.name || 'probe'),
        type: 'stdio',
        command: String(b.command || ''),
        args: b.args || []
      }, { listTools: b.listTools !== false, chaosSettings: db.settings });
    }
    if (!b.url || !/^https:\/\//.test(String(b.url))) throw new HttpError(400, 'URL HTTPS do servidor MCP é obrigatória.');
    let plugin;
    if (b.pluginName) {
      plugin = (db.settings.plugins || []).find(p => p.name === b.pluginName);
    } else if (b.plugin && typeof b.plugin === 'object') {
      plugin = b.plugin;
    }
    return verifyMcpConnector(b.url, { plugin, listTools: b.listTools !== false, chaosSettings: db.settings });
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
      created.headers = Object.fromEntries(
        Object.entries(b.headers).slice(0, 4).map(([k, v]) => [String(k).slice(0, 80), sanitizeHeaderValueForStorage(k, v)])
      );
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
          ? b.headers.filter(h => h?.name).map(h => [String(h.name).slice(0, 80), sanitizeHeaderValueForStorage(h.name, h.value)])
          : Object.entries(b.headers).map(([k, v]) => [k, sanitizeHeaderValueForStorage(k, v)])
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
    return listMcpToolCatalog(db.settings, mcpSession, { credentialVault: db.credentialVault });
  }],
  ['POST', /^\/api\/mcp\/tools$/, async req => {
    const b = await body(req);
    return listMcpToolCatalog(db.settings, b.mcpSession, { credentialVault: db.credentialVault });
  }],
  ['GET', /^\/api\/vault\/entries$/, () => ({
    entries: Object.entries(db.credentialVault || {}).map(([ref, e]) => ({ ref, ...redactVaultEntry(e) }))
  })],
  ['GET', /^\/api\/vault\/entries\/(vlt_[\w-]+)$/, (req, [ref]) => {
    const e = db.credentialVault?.[ref];
    if (!e) throw new HttpError(404, 'Credencial não encontrada.');
    return { ref, label: e.label, purpose: e.purpose, createdAt: e.createdAt, sealed: e.sealed };
  }],
  ['POST', /^\/api\/vault\/entries$/, async req => {
    const b = await body(req);
    try { assertVaultStoreBody(b); } catch (e) { throw new HttpError(400, e.message); }
    let meta;
    try { meta = validateSealedBlob(b.sealed); } catch (e) { throw new HttpError(400, e.message); }
    const ref = generateVaultRef();
    db.credentialVault = db.credentialVault || {};
    db.credentialVault[ref] = {
      sealed: b.sealed,
      label: meta.label || b.label || 'Credencial',
      purpose: meta.purpose || b.purpose || 'connector',
      createdAt: Date.now()
    };
    save();
    return { ref, label: db.credentialVault[ref].label, purpose: db.credentialVault[ref].purpose };
  }],
  ['DELETE', /^\/api\/vault\/entries\/(vlt_[\w-]+)$/, (req, [ref]) => {
    if (!db.credentialVault?.[ref]) throw new HttpError(404, 'Credencial não encontrada.');
    const { [ref]: _, ...rest } = db.credentialVault;
    db.credentialVault = rest;
    save();
    return { ok: true };
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
  ['GET', /^\/api\/task-sync\/status$/, () => taskSyncBridgeStatus(db.settings)],
  ['GET', /^\/api\/task-sync\/tasks$/, () => ({ tasks: listTaskDelegations(db) })],
  ['POST', /^\/api\/task-sync\/tasks$/, async req => {
    const b = await body(req);
    if (!b.title) throw new HttpError(400, 'Informe title.');
    const row = upsertTaskDelegation(db, {
      title: b.title,
      notes: b.notes,
      status: b.status,
      agentId: b.agentId,
      chatId: b.chatId,
      delegation: b.delegation
    }, { id });
    save();
    if (b.pushToGoogle) {
      try {
        const pushed = await pushTaskToGoogle(db, db.settings, row.id, syncBridgeOpts());
        save();
        return { task: row, push: pushed };
      } catch (e) {
        throw new HttpError(e.status || 400, e.message);
      }
    }
    return { task: row };
  }],
  ['PATCH', /^\/api\/task-sync\/tasks\/([\w-]+)$/, async (req, [tid]) => {
    const prev = (db.taskDelegations || []).find(t => t.id === tid);
    if (!prev) throw new HttpError(404, 'Tarefa não encontrada.');
    const b = await body(req);
    const row = upsertTaskDelegation(db, {
      ...prev,
      ...(b.title != null ? { title: b.title } : {}),
      ...(b.notes != null ? { notes: b.notes } : {}),
      ...(b.status != null ? { status: b.status } : {})
    }, { id });
    save();
    if (b.pushToGoogle !== false) {
      try {
        const pushed = await pushTaskToGoogle(db, db.settings, row.id, syncBridgeOpts());
        save();
        return { task: row, push: pushed };
      } catch (e) {
        if (e.code === 'NOT_AUTHENTICATED' || e.code === 'NOT_CONFIGURED') {
          return { task: row, push: { ok: false, error: e.message, code: e.code } };
        }
        throw new HttpError(e.status || 400, e.message);
      }
    }
    return { task: row };
  }],
  ['POST', /^\/api\/task-sync\/sync$/, async req => {
    const b = await body(req);
    const direction = b.direction || 'both';
    try {
      if (b.recordId) {
        const out = await syncTaskRecord(db, db.settings, b.recordId, { direction, ...syncBridgeOpts() });
        save();
        return out;
      }
      const pull = b.pull !== false
        ? await pullFromGoogleTasks(db, db.settings, { importNew: !!b.importNew, ...syncBridgeOpts() })
        : null;
      const push = b.push !== false
        ? await pushAllLinkedTasks(db, db.settings, { allRecords: !!b.allRecords, ...syncBridgeOpts() })
        : null;
      save();
      return { pull, push };
    } catch (e) {
      throw new HttpError(e.status || 400, e.message);
    }
  }],
  ['POST', /^\/api\/task-sync\/google\/oauth\/start$/, async (req, _, url) => {
    const redirectUri = googleTasksRedirectUri(publicBaseUrl(req));
    try {
      return await startGoogleTasksOAuthFlow({ redirectUri, settings: db.settings });
    } catch (e) {
      throw new HttpError(400, e.message);
    }
  }],
  ['GET', /^\/api\/task-sync\/google\/oauth\/status\/([\w-]+)$/, (req, [flowId]) => {
    const flow = getGoogleTasksOAuthFlow(flowId);
    if (!flow) throw new HttpError(404, 'Fluxo OAuth Google não encontrado ou expirado.');
    return {
      flowId,
      status: flow.status,
      error: flow.error || undefined,
      auth: googleTasksOAuthStatus(db.settings)
    };
  }],
  ['GET', /^\/api\/vault\/connections$/, () => listVaultEntries()],
  ['PUT', /^\/api\/vault\/connections\/([\w.-]{1,64})$/, async (req, [key]) => {
    const b = await body(req);
    try {
      return { entry: putVaultCredential(key, b) };
    } catch (e) {
      throw new HttpError(vaultConfigured() ? 400 : 503, e.message);
    }
  }],
  ['GET', /^\/api\/vault\/connections\/([\w.-]{1,64})$/, (req, [key], url) => {
    const agentId = url.searchParams.get('agentId') || '';
    if (!agentId) throw new HttpError(400, 'Informe agentId para ler credencial com escopo.');
    try {
      const cred = getVaultCredential(key, { agentId });
      if (!cred) throw new HttpError(404, 'Credencial não encontrada.');
      return vaultCredentialApiResponse(key, agentId, cred);
    } catch (e) {
      if (e.message?.includes('permissão')) throw new HttpError(403, e.message);
      throw new HttpError(vaultConfigured() ? 400 : 503, e.message);
    }
  }],
  ['DELETE', /^\/api\/vault\/connections\/([\w.-]{1,64})$/, (req, [key]) => {
    try {
      if (!deleteVaultCredential(key)) throw new HttpError(404, 'Credencial não encontrada.');
      return { ok: true };
    } catch (e) {
      throw new HttpError(400, e.message);
    }
  }],
  ['POST', /^\/api\/vault\/migrate-from-plugins$/, () => {
    try {
      const out = migrateLegacySecretsToVault(db);
      save();
      return out;
    } catch (e) {
      throw new HttpError(vaultConfigured() ? 400 : 503, e.message);
    }
  }],
  ['GET', /^\/api\/chaos\/status$/, () => chaosStatusPayload(db.settings)],
  ['POST', /^\/api\/chaos\/fire$/, async req => {
    const b = await body(req);
    try {
      return scheduleChaosFire(b.kind);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
  }],
  ['GET', /^\/api\/brand\/file\/([\w.-]+)$/, async (req, [name], url, res) => {
    requireEnterpriseBrand();
    const rel = `brand/${name}`;
    if (!isSafeBrandStoragePath(rel)) throw new HttpError(400, 'Arquivo inválido.');
    let buf;
    try { buf = await readFile(dataUrl(rel)); }
    catch { throw new HttpError(404, 'Logo não encontrado.'); }
    const type = detectImageType(buf);
    if (!type) throw new HttpError(404, 'Logo não encontrado.');
    res.writeHead(200, hdr(req, { 'content-type': type, 'cache-control': 'private, max-age=3600' }));
    res.end(buf);
    return undefined;
  }],
  ['POST', /^\/api\/brand\/logo$/, async req => {
    requireEnterpriseBrand();
    const { buf } = await readBrandLogoUpload(req, (r, lim) => raw(r, lim));
    if (!buf.length) throw new HttpError(400, 'Arquivo vazio.');
    if (buf.length > BRAND_LOGO_MAX) throw new HttpError(413, 'Imagem grande demais (máx. 2 MB).');
    const type = detectImageType(buf);
    if (!type) throw new HttpError(400, 'Envie uma imagem PNG, JPEG, WebP ou GIF.');
    const rel = `brand/${newBrandLogoFilename(type)}`;
    mkdirSync(dataUrl('brand/'), { recursive: true });
    await writeFile(dataUrl(rel), buf);
    return { logoUrl: rel };
  }],
  ['GET', /^\/api\/settings$/, () => ({ settings: redact(db.settings), meta: settingsMeta() })],
  ['GET', /^\/api\/flags$/, () => ({ flags: effectiveFeatureFlags(db.settings) })],
  // Provedores de IA → OpenRouter: testar a chave e listar o catálogo (para escolher modelos).
  // Provedores compatíveis com OpenAI: testar conexão e listar modelos (o caminho antigo /api/openrouter/* continua)
  ['POST', /^\/api\/(?:providers\/)?(openrouter|openai|gemini|ollama)\/test$/, async (req, [prov]) => {
    const b = await body(req);
    const key = !b.apiKey || b.apiKey === '••••' ? db.settings[prov]?.apiKey : String(b.apiKey).trim();
    const settings = b.url ? { ...db.settings, ollama: { ...db.settings.ollama, url: b.url } } : db.settings;
    if (!key && !COMPAT[prov].noKey) return { ok: false, error: 'Informe a chave.' };
    try { return await checkCompatKey(prov, settings, key); } catch (e) { return { ok: false, error: `Sem resposta do ${COMPAT[prov].label}: ${e.message}` }; }
  }],
  ['GET', /^\/api\/(?:providers\/)?(openrouter|openai|gemini|ollama)\/models$/, async (req, [prov]) => {
    try { return await compatCatalog(prov, db.settings); } catch (e) { throw new HttpError(502, e.message); }
  }],
  ['PUT', /^\/api\/settings$/, async req => {
    const b = await body(req), s = db.settings;
    const before = structuredClone(s);
    if (!isEnterpriseMode(s) && b.brand !== undefined) delete b.brand;
    try {
      patchSettings(s, b, { mergePluginAuth });
    } catch (e) {
      if (e instanceof SettingsValidationError) throw new HttpError(400, e.message, e.details);
      throw new HttpError(400, e.message);
    }
    recordCorporateAudit(s, auditSettingsPatch(before, s, b));
    if (!before.billing?.paidConsentAt !== !s.billing?.paidConsentAt) recordExternal({ kind: s.billing?.paidConsentAt ? 'billing.paid_on' : 'billing.paid_off', approved: 'user' });
    save();
    configureLogger({ settings: s });
    return redact(s);
  }],
  ['GET', /^\/api\/lgpd\/status$/, () => ({
    ...buildLgpdStatus({ settings: db.settings }),
    lgpd: lgpdMeta(db.settings)
  })],
  ['POST', /^\/api\/lgpd\/erasure$/, async req => {
    const b = await body(req);
    if (b.confirm !== true && b.confirm !== 'ERASE') {
      throw new HttpError(400, 'Confirme a eliminação com { "confirm": true } ou "confirm": "ERASE".');
    }
    const scope = b.scope === 'profile' ? 'profile' : 'all';
    const report = await executeLgpdErasure(db, { scope });
    save();
    return { ok: true, scope, report };
  }],
  ['GET', /^\/api\/retention$/, () => ({
    retention: resolveRetentionSettings(db.settings),
    envOverrides: envRetentionOverrides()
  })],
  ['PUT', /^\/api\/retention$/, async req => {
    const b = await body(req);
    applyRetentionSettingsPatch(db.settings, b);
    save();
    return { retention: resolveRetentionSettings(db.settings) };
  }],
  ['POST', /^\/api\/retention\/run$/, async () => {
    const report = await runRetentionPurge(db, { isStreaming: isChatStreaming, force: true });
    if (report.changed) save();
    return report;
  }],
  ['GET', /^\/api\/audit$/, (req, _, url) => ({
    entries: listAudit(db, { limit: +(url.searchParams.get('limit') || 50) })
  })],
  // Registro de ações externas (sempre ligado). ?kind, ?agentId, ?since; .csv exporta.
  ['GET', /^\/api\/external-actions(\.csv)?$/, (req, [csv], url, res) => {
    const q = { since: +(url.searchParams.get('since') || 0) || 0, kind: url.searchParams.get('kind') || undefined, agentId: url.searchParams.get('agentId') || undefined };
    const entries = listExternal({ ...q, limit: csv ? 5000 : 300 });
    if (!csv) return { kinds: EXTERNAL_KINDS, entries };
    res.writeHead(200, hdr(req, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="acoes-externas-${new Date().toISOString().slice(0, 10)}.csv"` }));
    res.end(externalCsv(entries, aid => db.agents.find(a => a.id === aid)?.name || aid));
  }],
  ['GET', /^\/api\/audit-trail$/, (req, _, url) => {
    if (!isEnterpriseMode(db.settings)) throw new HttpError(403, 'Trilha de auditoria corporativa exige modo enterprise.');
    const since = +(url.searchParams.get('since') || 0);
    return {
      store: 'sqlite',
      worm: true,
      enterprise: true,
      entryCount: countAuditTrail(),
      entries: listAuditTrail({
        limit: +(url.searchParams.get('limit') || 50),
        since: Number.isFinite(since) ? since : 0
      })
    };
  }],
  ['GET', /^\/api\/admin\/overview$/, () => {
    if (!isEnterpriseMode(db.settings)) throw new HttpError(403, 'Centro admin disponível apenas no modo enterprise.');
    return buildAdminOverview(db, db.settings);
  }],
  ['GET', /^\/api\/x9\/context$/, () => {
    requireEnterpriseAdmin();
    const sources = collectX9Sources({ db, settings: db.settings });
    return sources;
  }],
  ['POST', /^\/api\/x9\/scan$/, () => {
    requireEnterpriseAdmin();
    const sources = collectX9Sources({ db, settings: db.settings });
    return { sources, ...runX9Scan({ db, settings: db.settings, sources }) };
  }],
  ['GET', /^\/api\/access-control$/, () => ({
    accessControl: normalizeAccessControl(db.accessControl),
    meta: accessControlMeta()
  })],
  ['PUT', /^\/api\/access-control$/, async req => {
    try {
      const ac = applyAccessControlPatch(db, await body(req));
      save();
      return { accessControl: ac, meta: accessControlMeta() };
    } catch (e) {
      throw new HttpError(400, e.message);
    }
  }],
  ['POST', /^\/api\/access-control\/can-delegate$/, async req => {
    const b = await body(req);
    const actor = b.actor;
    const target = b.target;
    const action = b.action;
    if (!actor?.id || !target?.id || !action) throw new HttpError(400, 'Informe actor, target e action.');
    const result = canDelegate(actor, target, action, db.accessControl, { agents: db.agents });
    if (!result.ok) return { allowed: false, code: result.code, error: result.error };
    return { allowed: true };
  }],
  // WhatsApp por QR: só admin enterprise; segredos da Evolution nunca saem daqui.
  ['GET', /^\/api\/whatsapp-web\/status$/, async () => {
    requireEnterpriseAdmin();
    const style = waStyleProfile();
    return { state: await instanceState().catch(() => 'unknown'), docker: await dockerAvailable(), history: waStats(), styleFrom: style?.count || 0 };
  }],
  ['GET', /^\/api\/whatsapp-web\/contacts$/, (req, _, url) => {
    requireEnterpriseAdmin();
    const w = db.settings.whatsappWeb || {};
    return { contacts: waFindContacts(url.searchParams.get('q') || '', 100).map(c => ({ ...c, mode: c.phone.startsWith('g') ? 'group' : contactMode(c.phone, w) })) };
  }],
  ['DELETE', /^\/api\/whatsapp-web\/history$/, () => {
    requireEnterpriseAdmin();
    waWipeHistory();
    db.chats = db.chats.filter(c => c.channel !== 'whatsapp-web'); save();
    recordCorporateAudit(db.settings, { category: 'whatsapp', action: 'whatsapp_web.history_wiped', at: Date.now() });
    return { ok: true };
  }],
  ['POST', /^\/api\/whatsapp-web\/connect$/, async () => {
    requireEnterpriseAdmin();
    if (!(await dockerAvailable())) throw new HttpError(400, 'O Docker precisa estar rodando para o WhatsApp por QR.');
    const r = await connectInstance(PORT);
    recordCorporateAudit(db.settings, { category: 'whatsapp', action: 'whatsapp_web.connect_requested', at: Date.now() });
    return r;
  }],
  ['POST', /^\/api\/whatsapp-web\/disconnect$/, async req => {
    requireEnterpriseAdmin();
    const { wipe } = await body(req).catch(() => ({}));
    await disconnectInstance({ wipe: wipe === true });
    if (wipe === true) { waWipeHistory(); db.chats = db.chats.filter(c => c.channel !== 'whatsapp-web'); }
    db.settings.whatsappWeb = { ...(db.settings.whatsappWeb || {}), enabled: false }; save();
    recordCorporateAudit(db.settings, { category: 'whatsapp', action: wipe ? 'whatsapp_web.wiped' : 'whatsapp_web.disconnected', at: Date.now() });
    return { ok: true };
  }],
  // Conectores reais da conta claude.ai (para a tela Conectores mostrar o que os agentes vão poder usar).
  ['GET', /^\/api\/claude\/connectors$/, async (req, _, url) => {
    if (db.settings.claude?.mode === 'api') return { connectors: [], note: 'Conectores do claude.ai só existem no modo assinatura.' };
    return { connectors: await listClaudeConnectors({ force: url.searchParams.get('refresh') === '1' }).catch(e => { throw new HttpError(502, `Não consegui ler os conectores do claude.ai: ${e.message}`); }) };
  }],
  // Guardião do GitHub: confere o token e cria (ou reaproveita) o agente + a rotina que recebe os eventos.
  ['POST', /^\/api\/github\/guardian$/, async () => {
    const g = db.settings.github;
    if (!githubReady(g)) throw new HttpError(400, 'Salve o token e pelo menos um repositório antes.');
    let me;
    try { me = (await gh(g, '/user')).login; } catch (e) { throw new HttpError(400, `O token não funcionou: ${e.message}`); }
    for (const repo of g.repos) { try { await gh(g, `/repos/${repo}`); } catch (e) { throw new HttpError(400, `Sem acesso a ${repo}: ${e.message}`); } }
    let a = db.agents.find(x => x.id === g.agentId);
    if (!a) {
      a = newAgent({
        name: 'Guardião', category: 'Engenharia', description: 'Vigia os repositórios do GitHub: revisa PRs, investiga CI quebrado e delega correções.',
        tools: ['web', 'memory', 'routines', 'files', 'computer'], model: 'auto',
        instructions: [
          'Você é o Guardião do GitHub. Cada evento (PR, issue, CI que falhou) chega pela sua rotina.',
          'PR: leia o diff (github_read com diff=true) e os arquivos alterados. Aponte bugs, riscos de segurança e o que falta de teste. Seja específico (arquivo e linha). Publique a revisão com github_comment.',
          'CI que falhou: descubra a causa pelo log/commit e diga quem deve corrigir.',
          'Issue: classifique (bug, pedido, dúvida), estime o esforço e sugira o próximo passo.',
          'Correção pequena e clara (teste quebrado, bug de poucas linhas): corrija você mesmo — github_clone, crie o branch ripper/<assunto>, edite, RODE OS TESTES do projeto, faça commit e chame github_open_pr com o que mudou e como testou. Nunca abra PR com teste falhando.',
          'Correção grande ou fora da sua área: delegue a um colega com send_message (repositório, arquivo, o que fazer, e que ele use github_clone e github_open_pr).',
          'Nada relevante (PR trivial, issue já resolvida): responda NADA_NOVO.'
        ].join('\n')
      });
      db.agents.push(a);
      recordCorporateAudit(db.settings, auditAgentLifecycle('create', a));
    }
    let r = db.routines.find(x => x.trigger === 'github' && x.agentId === a.id);
    if (!r) {
      r = { id: id(), agentId: a.id, name: 'Eventos do GitHub', prompt: 'Trate este evento do GitHub conforme as suas instruções.', trigger: 'github', quiet: true, lastRun: 0, lastStatus: 'never', lastError: null };
      db.routines.push(r);
    }
    db.settings.github = { ...g, agentId: a.id, me, since: g.since || Date.now() };
    save();
    return { agentId: a.id, login: me, repos: g.repos };
  }],
  // Testa login IMAP + SMTP com o que está salvo (ou com o que veio no corpo, antes de salvar)
  ['POST', /^\/api\/email\/test$/, async req => {
    const b = await body(req);
    const e = { ...db.settings.email, ...b, pass: b.pass && b.pass !== '••••' ? b.pass : db.settings.email?.pass };
    try { return await testEmail(e); } catch (err) { throw new HttpError(400, `Não conectou: ${err.message}`); }
  }],
  // Resumo do dia na hora (o mesmo que chega na Caixa às 8h)
  ['GET', /^\/api\/pulse$/, () => currentPulse()],
  // Caixa: aprovações + recados de canal + novidades de rotina
  ['GET', /^\/api\/inbox$/, () => {
    const box = buildInbox(db);
    return { ...box, items: box.items.map(it => (it.kind === 'approval' ? { ...it, approval: approvalView(it.approval) } : it)) };
  }],
  ['POST', /^\/api\/inbox\/(notice|routine|spend|system)\/([\w-]+)\/done$/, (req, [kind, iid]) => {
    if (!resolveInboxItem(db, kind, iid)) throw new HttpError(404, 'Item não encontrado.');
    save();
    return { ok: true, count: buildInbox(db).count };
  }],
  // O que o agente conversou com um contato (para o dono conferir pela Caixa). Leitura auditada.
  ['GET', /^\/api\/whatsapp-web\/history\/(\d{10,15})$/, (req, [phone]) => {
    requireEnterpriseAdmin();
    recordCorporateAudit(db.settings, { category: 'whatsapp', action: 'whatsapp.read_from_inbox', at: Date.now() });
    return { messages: waHistory(phone, 30) };
  }],
  ['GET', /^\/api\/scripts$/, () => ({ scripts: listScripts() })],
  ['DELETE', /^\/api\/scripts\/(\d+)$/, (req, [sid]) => {
    if (!deleteScript(sid)) throw new HttpError(404, 'Script não encontrado.');
    return { ok: true };
  }],
  ['GET', /^\/api\/artifacts\/([\w-]+)\/download$/, async (req, [aid], url, res) => {
    const a = db.artifacts.find(x => x.id === aid);
    if (!a) throw new HttpError(404, 'Artefato não encontrado.');
    let content;
    try { content = await readArtifactContent(a); }
    catch (e) { throw new HttpError(404, e.message); }
    const name = artifactDownloadName(a);
    res.writeHead(200, hdr(req, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'cache-control': 'private, max-age=60' }));
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
  ['GET', /^\/api\/sandbox\/status$/, async () => sandboxStatus(db.settings)],
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
  ['POST', /^\/api\/architect\/suggest$/, async req => {
    const b = await body(req);
    try {
      return architectSuggest({ goal: b.goal, constraints: b.constraints });
    } catch (e) {
      if (e.code === 400) throw new HttpError(400, e.message);
      throw e;
    }
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
  ['GET', /^\/api\/team-proposals$/, () => listTeamProposals(db)],
  ['GET', /^\/api\/team-proposals\/([\w-]+)$/, (req, [pid]) => {
    const p = (db.teamProposals || []).find(x => x.id === pid);
    if (!p) throw new HttpError(404, 'Proposta de time não encontrada.');
    return p;
  }],
  ['POST', /^\/api\/team-proposals$/, async req => {
    const b = await body(req);
    let structure;
    let source = 'parse';
    let brief = String(b.brief || b.goal || '').trim();
    if (b.structure && typeof b.structure === 'object') {
      structure = normalizeTeamStructure(b.structure);
      source = 'structure';
    } else if (b.goal) {
      structure = structureFromArchitectScaffold(architectSuggest({ goal: b.goal, constraints: b.constraints }));
      source = 'architect';
    } else if (!brief) {
      throw new HttpError(400, 'Envie goal, brief (texto) ou structure (JSON).');
    } else if (b.orchestrate) {
      const orchAgent = newAgent({ name: 'Orquestrador de times', tools: [], instructions: '', model: channelModel(db.settings) });
      const runModel = process.env.RIPPER_TEST_PROVIDER
        ? prompt => runTestProvider({ prompt })
        : prompt => runClaude({
          agent: orchAgent,
          model: orchAgent.model,
          effort: 'low',
          prompt: brief,
          history: [],
          system: ORCHESTRATOR_SYSTEM,
          settings: db.settings,
          ctx: { db }
        });
      structure = await orchestrateTeamStructure(brief, { settings: db.settings, runModel });
      if (!structure) throw new HttpError(422, 'O modelo não devolveu um time válido.');
      source = 'model';
    } else {
      structure = parseTeamBrief(brief);
      if (!structure) throw new HttpError(422, 'Não foi possível entender o brief. Use lista de agentes ou um bloco JSON.');
    }
    const proposal = createTeamProposal(db, { brief, structure, source });
    save();
    return proposal;
  }],
  ['POST', /^\/api\/team-proposals\/([\w-]+)\/apply$/, async (req, [pid]) => {
    const b = await body(req);
    try {
      const out = applyTeamProposal(db, pid, {
        createProject: b.createProject !== false,
        projectName: b.projectName,
        projectDescription: b.projectDescription
      });
      save();
      return out;
    } catch (e) {
      if (e.code === 404) throw new HttpError(404, e.message);
      if (e.code === 409) throw new HttpError(409, e.message);
      throw e;
    }
  }],
  ['DELETE', /^\/api\/team-proposals\/([\w-]+)$/, (req, [pid]) => {
    const i = (db.teamProposals || []).findIndex(x => x.id === pid);
    if (i < 0) throw new HttpError(404, 'Proposta de time não encontrada.');
    db.teamProposals.splice(i, 1);
    save();
    return {};
  }],
  ['POST', /^\/api\/agents$/, async req => {
    const b = await body(req);
    if (b.templateId === 'x9-auditor' && !isEnterpriseMode(db.settings)) {
      throw new HttpError(403, 'O template X9 — Auditor está disponível apenas no modo enterprise.');
    }
    let a;
    if (b.savedTemplateId) {
      a = agentFromSavedTemplate(db, b.savedTemplateId, b, TEMPLATES);
      if (a.templateId === 'x9-auditor' && !isEnterpriseMode(db.settings)) {
        throw new HttpError(403, 'O template X9 — Auditor está disponível apenas no modo enterprise.');
      }
    } else {
      const t = TEMPLATES.find(t => t.id === b.templateId);
      a = patchAgent(newAgent({ ...(t || {}), templateId: t?.id }), b);
    }
    db.agents.push(a);
    recordCorporateAudit(db.settings, auditAgentLifecycle('create', a));
    save(); return a;
  }],
  ['PUT', /^\/api\/agents\/([\w-]+)$/, async (req, [aid]) => {
    const b = await body(req);
    if (b.autonomyLevel) b.autonomyLevel = sanitizeAutonomyLevel(b.autonomyLevel, db.settings);
    const a = patchAgent(agentOr404(aid), b);
    recordCorporateAudit(db.settings, auditAgentLifecycle('update', a));
    save();
    return a;
  }],
  ['DELETE', /^\/api\/agents\/([\w-]+)$/, async (req, [aid]) => {
    const a = agentOr404(aid);
    recordCorporateAudit(db.settings, auditAgentLifecycle('delete', a));
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
    res.writeHead(200, hdr(req, { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'last-modified': st.mtime.toUTCString() }));
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
    const routineGate = canDelegate(
      { type: 'user', id: 'owner' },
      { type: 'agent', id: b.agentId },
      'assign_routine',
      db.accessControl,
      { agents: db.agents }
    );
    if (!routineGate.ok) throw new HttpError(403, routineGate.error);
    if (!b.prompt) throw new HttpError(400, 'Diga o que a rotina deve fazer.');
    const r = { id: id(), agentId: b.agentId, name: String(b.name || 'Rotina').slice(0, 80), prompt: String(b.prompt).slice(0, 4000), lastRun: 0, lastStatus: 'never', lastError: null,
      quiet: b.quiet !== false,
      ...(b.trigger === 'webhook' ? { trigger: 'webhook', hookToken: newHookToken(), hookSecret: String(b.hookSecret || '').slice(0, 200) || undefined }
        : b.trigger === 'email' ? { trigger: 'email', keywords: parseKeywords(b.keywords) }
        : b.trigger === 'whatsapp' ? { trigger: 'whatsapp', keywords: parseKeywords(b.keywords), scope: ['contacts', 'groups', 'any'].includes(b.scope) ? b.scope : 'contacts' }
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
    tasks: taskItemsSummary(db.taskItems),
    pending: db.messages.filter(m => m.status === 'queued' || m.status === 'delivering').map(m => ({
      ...m,
      fromName: db.agents.find(a => a.id === m.from)?.name,
      toName: db.agents.find(a => a.id === m.to)?.name
    }))
  })],
  ['GET', /^\/api\/delegations$/, (_, __, url) => {
    const status = url.searchParams.get('status');
    const managerId = url.searchParams.get('managerId');
    const workerId = url.searchParams.get('workerId');
    let items = db.delegations || [];
    if (status) items = items.filter(d => d.status === status);
    if (managerId) items = items.filter(d => d.managerId === managerId);
    if (workerId) items = items.filter(d => d.workerId === workerId);
    return { summary: delegationsSummary(db.delegations), items: items.slice(0, 200) };
  }],
  ['POST', /^\/api\/delegations$/, async req => {
    const b = await body(req);
    const manager = agentOr404(b.managerId);
    const worker = agentOr404(b.workerId);
    const limits = { maxPerHour: 20, maxHops: 3, ...(db.settings.inbox || {}) };
    const hops = Math.max(0, +b.hops || 0);
    const out = delegateTask({
      db,
      id,
      manager,
      worker,
      title: b.title,
      description: b.description,
      originChatId: b.originChatId || null,
      priority: b.priority,
      hops,
      limits
    });
    if (out.error) throw new HttpError(400, out.error);
    save();
    setTimeout(dispatchInbox, 50);
    return { delegation: out.delegation, messageId: out.message.id };
  }],
  ['POST', /^\/api\/delegations\/([\w-]+)\/events$/, async (req, [delegationId]) => {
    const b = await body(req);
    const worker = agentOr404(b.workerId);
    const kind = b.kind;
    if (!Object.values(MESSAGE_KIND).includes(kind) || kind === MESSAGE_KIND.delegate) {
      throw new HttpError(400, 'kind inválido (accept, progress, complete, reject).');
    }
    const limits = { maxPerHour: 20, maxHops: 3, ...(db.settings.inbox || {}) };
    const out = workerProtocolEvent({
      db,
      id,
      worker,
      delegationId,
      kind,
      payload: b.payload || {},
      hops: Math.max(0, +b.hops || 0),
      limits
    });
    if (out.error) throw new HttpError(400, out.error);
    save();
    setTimeout(dispatchInbox, 50);
    return { delegation: out.delegation, messageId: out.notifyMessage.id };
  }],
  ['GET', /^\/api\/chats\/([\w-]+)$/, (req, [cid]) => {
    const c = db.chats.find(c => c.id === cid);
    if (!c) throw new HttpError(404, 'Conversa não encontrada.');
    if (c.unread) { c.unread = false; save(); }
    return chatDetail(c, cid);
  }],
  ['GET', /^\/api\/conversations\/([\w-]+)$/, (req, [cid]) => {
    const c = db.chats.find(c => c.id === cid);
    if (!c) throw new HttpError(404, 'Conversa não encontrada.');
    if (c.unread) { c.unread = false; save(); }
    return chatDetail(c, cid);
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
  ['POST', /^\/api\/chats\/([\w-]+)\/resume$/, async (req, [cid], url, res) => {
    // Retoma a última pergunta do usuário sem duplicá-la: só quando run.status === interrupted,
    // remove respostas parciais (stopped/vazias) e reabre o SSE como um POST /api/chat.
    const c = db.chats.find(x => x.id === cid);
    if (!c) throw new HttpError(404, 'Conversa não encontrada.');
    if (isChatStreaming(cid)) throw new HttpError(409, 'Esta conversa já está respondendo.');
    const check = canResumeChatRun(c, { streaming: false });
    if (!check.ok) throw new HttpError(check.reason?.includes('já tem resposta') ? 409 : 400, check.reason);
    check.ok && trimPartialRepliesAfterLastUser(c);
    const { text, fileIds } = check;
    beginChatRun(c, { runId: id(), userMessageId: c.messages[check.at]?.id });
    save();
    return streamChatResponse(req, c, { text, fileIds, mcpSession: (await body(req)).mcpSession, resume: true }, res);
  }],
  ['POST', /^\/api\/conversations\/([\w-]+)\/resume$/, async (req, [cid], url, res) => {
    const c = db.chats.find(x => x.id === cid);
    if (!c) throw new HttpError(404, 'Conversa não encontrada.');
    if (isChatStreaming(cid)) throw new HttpError(409, 'Esta conversa já está respondendo.');
    const check = canResumeChatRun(c, { streaming: false });
    if (!check.ok) throw new HttpError(check.reason?.includes('já tem resposta') ? 409 : 400, check.reason);
    trimPartialRepliesAfterLastUser(c);
    const { text, fileIds } = check;
    beginChatRun(c, { runId: id(), userMessageId: c.messages[check.at]?.id });
    save();
    return streamChatResponse(req, c, { text, fileIds, mcpSession: (await body(req)).mcpSession, resume: true }, res);
  }],
  ['POST', /^\/api\/chats\/([\w-]+)\/cancel$/, (req, [cid]) => {
    db.chats.find(c => c.id === cid) || (() => { throw new HttpError(404, 'Conversa não encontrada.'); })();
    if (!cancelChatStream(cid)) throw new HttpError(404, 'Nenhuma resposta em andamento.');
    return { ok: true };
  }],
  ['DELETE', /^\/api\/chats\/([\w-]+)$/, (req, [cid]) => { if (isChatStreaming(cid)) throw new HttpError(409, 'Aguarde a resposta terminar.'); db.chats = db.chats.filter(c => c.id !== cid); save(); return {}; }],
  // Ditado em qualquer navegador (Firefox, Safari, celular): o áudio gravado vira texto no Whisper local.
  ['POST', /^\/api\/transcribe$/, async req => {
    const buf = await raw(req, 25 * 1024 * 1024);
    if (buf.length < 1000) throw new HttpError(400, 'Áudio vazio.');
    mkdirSync(dataUrl('tmp/'), { recursive: true });
    const rel = `tmp/voice-${id()}.webm`;
    await writeFile(dataUrl(rel), buf);
    try { return { text: await transcribeAudio(rel) }; }
    catch (e) { throw new HttpError(503, e.message); }
    finally { await unlink(dataUrl(rel)).catch(() => {}); }
  }],
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
    // ?view=1: abre na aba quando é seguro (PDF, imagem, texto — HTML/SVG viram texto); senão, baixa.
    const view = url.searchParams.get('view') === '1' ? inlineType(f.type) : null;
    const inline = view || (/^image\/(png|jpe?g|webp|gif)$/.test(f.type) ? f.type : null);
    // PDF com ?view=1 pode aparecer embutido no próprio Ripper (prévia na conversa), nunca em outro site.
    const embed = view === 'application/pdf' ? { 'x-frame-options': 'SAMEORIGIN', 'content-security-policy': "default-src 'none'; frame-ancestors 'self'; sandbox" } : {};
    res.writeHead(200, hdr(req, { ...embed, 'content-type': inline || 'application/octet-stream', 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'cache-control': 'private, max-age=3600' }));
    res.end(buf);
  }],
  // Abre no programa padrão desta máquina (Word, Excel…) ou mostra na pasta. Só pedido vindo desta
  // própria máquina e só arquivo registrado no Ripper (o caminho nunca vem do navegador).
  ['POST', /^\/api\/files\/([\w-]+)\/(open|reveal)$/, (req, [fid, mode]) => {
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    if (!local) throw new HttpError(403, 'Só dá para abrir arquivos na própria máquina do Ripper.');
    const f = db.files.find(x => x.id === fid); if (!f) throw new HttpError(404, 'Arquivo não encontrado.');
    const full = fileURLToPath(dataUrl(f.path));
    const [cmd, args] = process.platform === 'win32'
      ? ['explorer.exe', mode === 'reveal' ? [`/select,${full}`] : [full]]
      : process.platform === 'darwin' ? ['open', mode === 'reveal' ? ['-R', full] : [full]]
      : ['xdg-open', [mode === 'reveal' ? dirname(full) : full]];
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    return { ok: true };
  }],
  ['DELETE', /^\/api\/files\/([\w-]+)$/, async (req, [fid]) => {
    const f = db.files.find(x => x.id === fid); if (!f) return {};
    db.files = db.files.filter(x => x !== f); save();
    await unlink(dataUrl(f.path)).catch(() => {});
    return {};
  }],
  ['POST', /^\/api\/chat$/, async (req, _, url, res) => {
    const rawChat = await raw(req, MAX_JSON);
    let idem;
    try {
      idem = chatIdempotencyContext(req, TOKEN, rawChat);
    } catch (e) {
      if (e.code === 400) throw new HttpError(400, e.message);
      throw e;
    }
    if (idem?.decision.kind === 'replay') {
      replayIdempotentResponse(res, idem.decision.record, hdr(req, { 'idempotency-replayed': 'true' }));
      return undefined;
    }
    if (idem?.decision.kind === 'conflict') throw new HttpError(409, 'Idempotency-Key já usada com outro corpo de requisição.');
    if (idem?.decision.kind === 'in_progress') throw new HttpError(409, 'Requisição idempotente ainda em processamento; repita em instantes.');
    try {
      let b;
      if (!rawChat.length) b = {};
      else {
        try { b = JSON.parse(rawChat); } catch { throw new HttpError(400, 'JSON inválido.'); }
      }
      let c = db.chats.find(x => x.id === b.chatId);
      const project = (c?.projectId || b.projectId) ? projectOr404(c?.projectId || b.projectId) : null;
      // Participantes: conversa existente manda; nova conversa usa agentIds (grupo) ou agentId (individual).
      const agentIds = c ? (c.agentIds || [c.agentId]) : [...new Set(Array.isArray(b.agentIds) && b.agentIds.length ? b.agentIds : [b.agentId])];
      agentIds.forEach(agentOr404);
      if (project && !c && agentIds.some(a => !project.agentIds.includes(a))) throw new HttpError(400, 'Agente fora do projeto.');
      const agent = agentOr404(agentIds[0]);
      const rawParts = Array.isArray(b.parts) ? b.parts : null;
      const coalesced = rawParts?.length ? coalesceSendParts(rawParts.map(p => ({ text: p.text ?? p, fileIds: p.fileIds }))) : null;
      const text = String(coalesced?.text ?? b.text ?? '').trim().slice(0, 32000) || 'Veja o anexo.';
      const fileIdsRaw = coalesced?.fileIds?.length ? coalesced.fileIds : (b.fileIds || []);
      if (!text && !fileIdsRaw.length) throw new HttpError(400, 'Mensagem vazia.');
      if (b.model && b.model !== 'agent' && !(b.model in MODELS)) throw new HttpError(400, 'Modelo desconhecido.');
      if (b.effort && !EFFORTS.includes(b.effort)) throw new HttpError(400, 'Esforço desconhecido.');
      if (!c) {
        c = { id: id(), agentId: agent.id, title: 'Nova conversa', messages: [], createdAt: Date.now(), updatedAt: Date.now(),
          ...(project ? { projectId: project.id } : {}), ...(agentIds.length > 1 ? { agentIds } : {}) };
        db.chats.unshift(c);
      }
      if (isChatStreaming(c.id)) throw new HttpError(409, 'Esta conversa já está respondendo. Aguarde ou interrompa a resposta atual.');
      const quota = checkRunBudget(db, db.settings, { agentId: agent.id });
      if (quota.blocked) throw new HttpError(429, quota.userMessage);
      const fileIds = fileIdsRaw.filter(fid => db.files.some(f => f.id === fid && agentIds.some(a => canUseFile(f, { id: a }, c))));
      for (const fid of fileIds) { const f = db.files.find(x => x.id === fid); if (f && !f.chatId) f.chatId = c.id; }
      if (b.model && b.model !== 'auto' && b.model !== 'agent' && (!c.model || c.model === 'auto')) {
        const lastAuto = c.messages.findLast(m => m.role === 'assistant');
        const lastAsk = c.messages.findLast(m => m.role === 'user');
        // O Auto escolheu um modelo e você trocou: isso vira exemplo para a Julia nas próximas escolhas.
        if (lastAuto?.routedBy && lastAuto.routedBy !== 'manual' && lastAuto.model !== b.model && lastAsk?.content) {
          db.juliaCorrections = [...(db.juliaCorrections || []), { agentId: lastAuto.agentId, ask: lastAsk.content.slice(0, 160), from: lastAuto.model, to: b.model, at: Date.now() }].slice(-50);
        }
      }
      if (b.model) c.model = b.model === 'agent' ? undefined : b.model;
      if (b.effort) c.effort = b.effort;
      beginChatRun(c, { runId: id(), userMessageId: null });
      save();
      const idemCapture = idem ? captureResponseBody(res) : null;
      const credentialRefs = Array.isArray(b.credentialRefs) ? b.credentialRefs.filter(isVaultRef) : [];
      await streamChatResponse(req, c, {
        text, fileIds, mcpSession: b.mcpSession, resume: false, credentialRefs, voice: b.voice === true
      }, res);
      if (idem && idemCapture) idem.complete(idemCapture.snapshot());
    } catch (e) {
      if (idem && !res.headersSent) idem.release();
      throw e;
    }
    return undefined;
  }]
];

const server = createServer(async (req, res) => {
  attachRequestId(req, res);
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const metricRoute = normalizeMetricRoute(p);
  incrementHttpInFlight(1);
  let metricDone = false;
  const finishMetric = status => {
    if (metricDone) return;
    metricDone = true;
    recordHttpRequest(req.method, metricRoute, status);
    incrementHttpInFlight(-1);
  };
  res.on('finish', () => finishMetric(res.statusCode || 0));
  res.on('close', () => { if (!metricDone) finishMetric(res.headersSent ? (res.statusCode || 0) : 0); });
  await runWithRequestContext(req, p, async () => {
  const httpLog = shouldLogHttpRoute(p);
  const httpStarted = httpLog ? Date.now() : 0;
  if (httpLog) logger.info('http.request.start', { method: req.method });
  if (httpLog) {
    res.on('finish', () => {
      logger.info('http.request.end', { method: req.method, status: res.statusCode, ms: Date.now() - httpStarted });
    });
  }
  const bodyLimits = { maxBodyBytes: MAX_JSON, maxFileBytes: MAX_FILE };
  const clearHttpTimeout = attachHttpTimeout(req, res, req.method, p, HTTP_BUDGET, hdr(req, {}));
  try {
    if (isShuttingDown() && p.startsWith('/api/')) throw new HttpError(503, SHUTDOWN_MESSAGE);
    if (rejectOversizeBody(req, res, req.method, p, bodyLimits, hdr(req, {}))) return;
    if (TOKEN && url.searchParams.get('token') === TOKEN) {
      res.writeHead(302, { 'set-cookie': `ripper_token=${encodeURIComponent(TOKEN)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`, location: '/' });
      return res.end();
    }
    if (req.method === 'GET' && p === '/metrics') {
      if (!metricsAccessAllowed(req, TOKEN)) throw new HttpError(401, 'Não autorizado.');
      const metricsBody = formatPrometheusExposition();
      res.writeHead(200, hdr(req, { 'content-type': prometheusContentType(), 'cache-control': 'no-store' }));
      res.end(metricsBody);
      return;
    }
    if (req.method === 'GET' && p === '/openapi.json') {
      const doc = buildOpenApiDocument({ port: PORT, host: HOST, version: APP_PKG.version });
      doc.servers = [{ url: publicBaseUrl(req), description: 'Esta instância' }];
      return json(res, doc, 200, { 'cache-control': 'public, max-age=300' }, req);
    }
    if (req.method === 'GET' && p === '/docs') {
      res.writeHead(200, hdr(req, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' }));
      return res.end(OPENAPI_DOCS_HTML);
    }
    // WhatsApp por QR: a Evolution (rede interna) avisa aqui. Sem o token aleatório (URL + cabeçalho), recusa.
    const waWeb = req.method === 'POST' && /^\/api\/channels\/whatsapp-web\/([a-f0-9]{48})$/.exec(p);
    if (waWeb) {
      const expected = Buffer.from(evolutionSecrets().hookToken);
      const ok = [waWeb[1], String(req.headers['x-ripper-token'] || '')].every(t => { const b = Buffer.from(t); return b.length === expected.length && timingSafeEqual(b, expected); });
      if (!ok) throw new HttpError(401, 'Token inválido.');
      let ev; try { ev = JSON.parse((await body.raw(req)).toString('utf8')); } catch { throw new HttpError(400, 'JSON inválido.'); }
      if (ev?.event === 'connection.update' && ev.data?.state) {
        recordCorporateAudit(db.settings, { category: 'whatsapp', action: `whatsapp_web.${ev.data.state}`, at: Date.now() });
      }
      const w = db.settings.whatsappWeb || {};
      const readGroups = w.readAll && w.readGroups && isEnterpriseMode(db.settings);
      const handle = ev => {
        // grupo: só guardar para leitura (opt-in "Ler grupos"); nunca entra no fluxo de resposta
        const grp = parseEvolutionGroup(ev);
        if (grp) {
          if (readGroups) groupName(grp.groupJid).then(name => {
            recordWaMessage({ id: grp.id, phone: grp.key, fromMe: false, text: grp.text, name: name || 'Grupo', at: grp.at });
            fireWhatsappTriggers({ text: grp.text, isGroup: true, fromMe: grp.fromMe, where: `grupo ${name || 'sem nome'}` });
          }).catch(() => {});
          return;
        }
        const msg = parseEvolutionAny(ev);
        if (msg && isEnterpriseMode(db.settings)) fireWhatsappTriggers({ text: msg.text, isGroup: false, fromMe: msg.fromMe, where: `${msg.name || 'contato'} (+${msg.from})` });
        if (msg) handleWhatsappWebMessage(msg).catch(e => console.error('whatsapp-web', ...redactForLog(db.settings, e.message)));
      };
      // Áudio e imagem viram texto antes de tudo (só se o Ripper vai usar: contato atendido, leitura ou grupo lido).
      const media = evolutionMedia(ev);
      if (media) {
        const probe = withMediaText(ev, '.');
        const grp = parseEvolutionGroup(probe), one = !grp && parseEvolutionAny(probe);
        const used = grp ? readGroups : one && (w.readAll || contactMode(one.from, w) != null);
        if (used) mediaToText(ev, media).then(text => handle(withMediaText(ev, text))).catch(e => console.error('whatsapp-web media', ...redactForLog(db.settings, e.message)));
        return json(res, { ok: true }, 200, {}, req);
      }
      handle(ev);
      return json(res, { ok: true }, 200, {}, req);
    }
    // Canal WhatsApp (Meta chama sem login): GET = verificação do webhook, POST = mensagens (assinadas).
    if (p === '/api/channels/whatsapp/webhook') {
      const w = db.settings.whatsapp;
      if (!whatsappReady(w) || !isEnterpriseMode(db.settings)) throw new HttpError(404, 'Canal WhatsApp desligado.');
      if (req.method === 'GET') {
        const ok = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === w.verifyToken;
        if (!ok) throw new HttpError(403, 'Token de verificação não confere.');
        res.writeHead(200, hdr(req, { 'content-type': 'text/plain' }));
        return res.end(url.searchParams.get('hub.challenge') || '');
      }
      if (req.method === 'POST') {
        const raw = (await body.raw(req)).toString('utf8');
        if (!verifySignature(w.appSecret, raw, req.headers['x-hub-signature-256'])) throw new HttpError(401, 'Assinatura inválida.');
        let payload; try { payload = JSON.parse(raw); } catch { throw new HttpError(400, 'JSON inválido.'); }
        for (const m of parseWhatsappMessages(payload)) handleWhatsappMessage(m).catch(e => console.error('whatsapp', ...redactForLog(db.settings, e.message)));
        return json(res, { ok: true }, 200, {}, req); // a Meta reenvia se não receber 200 rápido
      }
    }
    const hook = req.method === 'POST' && /^\/api\/hooks\/([a-f0-9]{48})$/.exec(p);
    if (hook) {
      const r = db.routines.find(x => x.trigger === 'webhook' && x.hookToken === hook[1]);
      if (!r) throw new HttpError(404, 'Webhook desconhecido.');
      const raw = (await body.raw(req)).toString('utf8');
      if (!verifySignature(r.hookSecret, raw, req.headers['x-hub-signature-256'])) throw new HttpError(401, 'Assinatura inválida.');
      const meta = eventMeta(req.headers);
      if (meta.type === 'ping') return json(res, { ok: true, pong: true }, 200, {}, req);
      const started = runRoutine(r, { ...meta, body: summarizeEvent(raw) });
      return json(res, { ok: true, started }, started ? 202 : 429, {}, req);
    }
    if (req.method === 'GET' && (p === '/healthz' || p === '/readyz')) {
      if (p === '/healthz') return json(res, probePayload(), 200, {}, req);
      const uptimeSeconds = Math.floor((Date.now() - SERVER_STARTED_AT) / 1000);
      const notReady = (reason, code = 503) => json(res, {
        ok: false,
        reason,
        version: APP_PKG.version,
        uptimeSeconds
      }, code, {}, req);
      try {
        if (isShuttingDown()) return notReady('shutting_down');
        const ready = safeCheckStoreReady();
        if (!ready.ok) return notReady(ready.reason || 'store_unavailable');
        return json(res, probePayload(), 200, {}, req);
      } catch (e) {
        return notReady(e?.code || e?.message || 'store_unavailable');
      }
    }
    if (req.method === 'GET' && p === '/api/task-sync/google/oauth/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state') || '';
      const err = url.searchParams.get('error');
      const flow = findGoogleTasksOAuthFlowByState(state);
      if (!flow) {
        res.writeHead(400, hdr(req, { 'content-type': 'text/html; charset=utf-8' }));
        res.end('<!doctype html><meta charset=utf-8><title>Ripper · Google Tasks</title><p>Fluxo inválido ou expirado. Feche esta janela e tente de novo no Ripper.</p>');
        return;
      }
      if (err) {
        flow.status = 'error';
        flow.error = url.searchParams.get('error_description') || err;
        res.writeHead(400, hdr(req, { 'content-type': 'text/html; charset=utf-8' }));
        res.end(`<!doctype html><meta charset=utf-8><title>Ripper · Google Tasks</title><p>Login negado: ${flow.error}</p><script>setTimeout(()=>window.close(),1200)</script>`);
        return;
      }
      if (!code) {
        res.writeHead(400, hdr(req, { 'content-type': 'text/html; charset=utf-8' }));
        res.end('<!doctype html><meta charset=utf-8><title>Ripper · Google Tasks</title><p>Código OAuth ausente.</p>');
        return;
      }
      try {
        const tokens = await exchangeGoogleTasksCode(flow, code);
        db.settings = applyGoogleTokensToSettings(db.settings, tokens);
        save();
        flow.status = 'complete';
        res.writeHead(200, hdr(req, { 'content-type': 'text/html; charset=utf-8' }));
        res.end('<!doctype html><meta charset=utf-8><title>Ripper · Google Tasks</title><p>Google Tasks conectado. Você pode fechar esta janela.</p><script>setTimeout(()=>window.close(),800)</script>');
      } catch (e) {
        flow.status = 'error';
        flow.error = e.message;
        res.writeHead(500, hdr(req, { 'content-type': 'text/html; charset=utf-8' }));
        res.end('<!doctype html><meta charset=utf-8><title>Ripper · Google Tasks</title><p>Falha ao trocar o código por token. Veja o Ripper e tente novamente.</p>');
      }
      return;
    }
    if (req.method === 'GET' && p === '/api/mcp/oauth/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state') || '';
      const err = url.searchParams.get('error');
      const flow = findOAuthFlowByState(state);
      if (!flow) {
        res.writeHead(400, hdr(req, { 'content-type': 'text/html; charset=utf-8' }));
        res.end('<!doctype html><meta charset=utf-8><title>Ripper OAuth</title><p>Fluxo inválido ou expirado. Feche esta janela e tente de novo no Ripper.</p>');
        return;
      }
      if (err) {
        flow.status = 'error';
        flow.error = url.searchParams.get('error_description') || err;
        res.writeHead(400, hdr(req, { 'content-type': 'text/html; charset=utf-8' }));
        res.end(`<!doctype html><meta charset=utf-8><title>Ripper OAuth</title><p>Login negado: ${flow.error}</p><script>setTimeout(()=>window.close(),1200)</script>`);
        return;
      }
      if (!code) {
        res.writeHead(400, hdr(req, { 'content-type': 'text/html; charset=utf-8' }));
        res.end('<!doctype html><meta charset=utf-8><title>Ripper OAuth</title><p>Código OAuth ausente.</p>');
        return;
      }
      try {
        const tokens = await exchangeOAuthCode(flow, code);
        const idx = (db.settings.plugins || []).findIndex(p => p.name === flow.pluginName);
        if (idx >= 0) {
          const plugin = db.settings.plugins[idx];
          db.settings.plugins[idx] = persistOAuthTokensInVault(plugin, tokens, flow);
          save();
        }
        flow.status = 'complete';
        res.writeHead(200, hdr(req, { 'content-type': 'text/html; charset=utf-8' }));
        res.end('<!doctype html><meta charset=utf-8><title>Ripper OAuth</title><p>Login concluído. Você pode fechar esta janela.</p><script>setTimeout(()=>window.close(),800)</script>');
      } catch (e) {
        flow.status = 'error';
        flow.error = e.message;
        res.writeHead(500, hdr(req, { 'content-type': 'text/html; charset=utf-8' }));
        res.end('<!doctype html><meta charset=utf-8><title>Ripper OAuth</title><p>Falha ao trocar o código por token. Veja o Ripper e tente novamente.</p>');
      }
      return;
    }
    if (p.startsWith('/api/')) {
      if (handleApiCorsPreflight(req, res, CORS_ALLOWLIST)) return;
      if (!authed(req)) throw new HttpError(401, 'Não autorizado. Abra o Ripper com ?token=<RIPPER_TOKEN>.');
      const originErr = mutatingOriginError(req, CORS_ALLOWLIST);
      if (originErr) throw new HttpError(403, originErr);
      const rl = checkRateLimit({ req, settings: db.settings, ripperToken: TOKEN, method: req.method, path: p });
      if (!rl.ok) {
        json(res, { error: rl.message }, 429, { 'retry-after': String(rl.retryAfterSec) }, req);
        return;
      }
      for (const [method, re, fn] of routes) {
        const m = req.method === method && re.exec(p);
        if (!m) continue;
        const out = await fn(req, m.slice(1), url, res);
        if (out !== undefined && !res.headersSent) json(res, out, 200, {}, req);
        return;
      }
      throw new HttpError(404, 'Rota não encontrada.');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método não permitido.');
    return await serveStatic(req, res, p === '/' ? '/index.html' : p);
  } catch (e) {
    const code = e instanceof HttpError ? e.code : 500;
    if (code === 500) console.error(`[${req.requestId}]`, ...redactForLog(db.settings, e?.stack || e?.message || String(e)));
    if (!res.headersSent) {
      const payload = { error: code === 500 ? 'Erro interno. Veja o log do servidor.' : redactSecretsInText(e.message) };
      if (e.details?.length) payload.details = e.details;
      json(res, payload, code, {}, req);
    } else res.end();
  } finally {
    clearHttpTimeout();
  }
  });
});

let activeHttpConnections = 0;
server.on('connection', socket => {
  activeHttpConnections++;
  socket.on('close', () => {
    activeHttpConnections--;
  });
});

server.listen(PORT, HOST, () => console.log(`Ripper em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
// Julia instalada = Julia no ar; sem pesos em julia/Julia-1, segue nas regras de reserva.
if (!process.env.RIPPER_TEST_PROVIDER) autoStartJulia(db.settings).catch(e => console.warn('[julia]', e.message));

registerGracefulShutdown(server, {
  logger,
  onBeginShutdown: () => {
    clearInterval(routineTimer);
    shutdownStdioSupervisors().catch(() => {});
    closeSpares();
  },
  getActiveConnections: () => activeHttpConnections,
  flush,
  closeStores: () => {
    closeUsageEventsStore();
    closeJuliaEventsStore();
    closePersistCoordStore();
    closeIdempotencyStore();
  }
});

// Rotinas: o agente dono acorda (por horário ou evento), executa e só deixa conversa se houver novidade.
/** Rotinas com gatilho "mensagem no WhatsApp" que casam com esta mensagem. */
function fireWhatsappTriggers({ text, isGroup, fromMe, where }) {
  for (const r of db.routines) {
    if (whatsappTriggerMatches(r, { text, isGroup, fromMe })) runRoutine(r, { source: 'WhatsApp', type: where, body: String(text).slice(0, 4000) });
  }
}

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
  }).catch(e => { r.lastStatus = 'failed'; r.lastError = e.message; save(); console.error('rotina', r.name, ...redactForLog(db.settings, e.message)); })
    .finally(() => releaseRoutineClaim(r.id));
  return true;
}

const routineTimer = setInterval(() => {
  try {
    const now = new Date();
    for (const r of db.routines) if (routineDue(r, now)) runRoutine(r);
  } catch (e) {
    console.error('routine.tick_failed', e?.code || e?.message || String(e));
  }
}, 30_000);
if (typeof routineTimer.unref === 'function') routineTimer.unref();

setInterval(() => {
  const out = maybeRunScheduledBackup(db);
  if (out?.error) raiseSystemAlert({ key: 'backup', title: 'O backup automático falhou', body: `${out.error} Seus dados de hoje ainda não têm cópia.`, href: '/settings/backup', hrefLabel: 'Ver backup' });
  else if (out?.created) { resolveSystemAlert('backup'); save(); }
}, 60_000);

// Guardião do GitHub: a cada N min (5 por padrão) pergunta ao GitHub o que mudou; cada novidade vira um evento da rotina.
let githubPolling = false;
setInterval(async () => {
  const g = db.settings.github;
  const r = db.routines.find(x => x.trigger === 'github' && x.agentId === g?.agentId);
  if (githubPolling || !githubReady(g) || !r || Date.now() - (g.lastCheck || 0) < (g.everyMinutes || 5) * 60_000) return;
  githubPolling = true;
  const now = Date.now();
  try {
    const events = [];
    for (const repo of g.repos) events.push(...await repoChanges(g, repo, g.since || now, g.me));
    db.settings.github = { ...db.settings.github, since: now, lastCheck: now, lastError: null };
    // ponytail: uma rodada da rotina por evento, em sequência; agrupar se vier muita coisa de uma vez
    for (const ev of events.slice(0, 10)) {
      while (r.lastStatus === 'running') await new Promise(res => setTimeout(res, 5000));
      runRoutine(r, { source: 'GitHub', type: `${ev.kind} ${ev.repo}#${ev.number}`, body: describeChange(ev) });
    }
  } catch (err) {
    db.settings.github = { ...db.settings.github, lastCheck: now, lastError: err.message };
    console.error('github.poll', ...redactForLog(db.settings, err.message));
  } finally { githubPolling = false; save(); }
}, 60_000).unref?.();

// Gatilho "chegou e-mail": a cada 2 min olha só os e-mails novos — e só se alguma rotina usa esse gatilho.
let emailPolling = false;
setInterval(async () => {
  const e = db.settings.email;
  if (emailPolling || !emailReady(e) || !db.routines.some(r => r.trigger === 'email')) return;
  emailPolling = true;
  try {
    const { lastUid, items } = await newEmailsSince(e, db.emailLastUid || 0);
    db.emailLastUid = lastUid; save();
    for (const m of items) for (const r of db.routines) {
      if (emailTriggerMatches(r, m)) runRoutine(r, { source: 'E-mail', type: m.from, body: `De: ${m.from}
Assunto: ${m.subject}
uid ${m.uid} (leia com email_read se precisar do conteúdo)` });
    }
  } catch (err) { console.error('email.poll', ...redactForLog(db.settings, err.message)); }
  finally { emailPolling = false; }
}, 120_000).unref?.();

// Resumo diário ("Pulse"): uma vez por dia, a partir da hora escolhida, na Caixa. Sem tokens.
function currentPulse() {
  return buildPulse(db, { external: listExternal({ since: Date.now() - 24 * 3600_000, limit: 5000 }), inboxCount: buildInbox(db).items.filter(i => i.kind !== 'system' || !i.quiet).length });
}
setInterval(() => {
  const day = pulseDue(db.settings, db.pulseLastDay);
  if (!day) return;
  db.pulseLastDay = day;
  resolveSystemAlert('pulse'); // o de ontem sai; fica só o mais recente
  const p = currentPulse();
  raiseSystemAlert({ key: 'pulse', title: p.title, body: p.body, href: '/agents', hrefLabel: 'Ver agentes', quiet: true });
}, 60_000).unref?.();

process.on('unhandledRejection', e => console.error('unhandledRejection', ...redactForLog(db?.settings, e?.message || String(e))));
if (!existsSync(DIST)) console.warn('Aviso: frontend não compilado. Rode `npm run build`.');
