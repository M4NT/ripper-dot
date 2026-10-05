import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync, accessSync, constants } from 'node:fs';
import { migrateUsageEventsFromJson, ensureUsageEventsStore, _resetUsageEventsForTests } from './usage-events.mjs';
import { ensureJuliaEventsStore, _resetJuliaEventsForTests } from './julia-events.mjs';
import { ensureSemanticCacheStore, _resetSemanticCacheForTests } from './semantic-cache.mjs';
import { ensureAuditTrailStore, _resetAuditTrailForTests } from './audit-trail.mjs';
import { withPersistMutex, _resetPersistCoordForTests } from './persist-coord.mjs';
import { mergePersistedDb, ID_COLLECTIONS } from './db-merge.mjs';
import { syncUiEnterprise } from './enterprise.mjs';
import { normalizeFeatureFlags, DEFAULT_FLAGS } from './feature-flags.mjs';
import { DEFAULT_LOCALE, normalizeLocale } from './i18n.mjs';
import { repairChatRunsOnStartup } from './chat-run.mjs';
import { normalizeAccessControl, ensureOwnerAdmin } from './rbac.mjs';
import { normalizeBackupSettings } from './backup-settings.mjs';
import { sanitizeStyleFields } from './agent-style.mjs';
import { normalizeBrand, EMPTY_BRAND } from './brand.mjs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { normalizeModelPolicy } from './router.mjs';

// RIPPER_DATA aponta para outra pasta (ex.: um volume persistente em produção).
let _dir;
function dataDir() {
  if (!_dir) _dir = process.env.RIPPER_DATA ? pathToFileURL(resolve(process.env.RIPPER_DATA) + '/') : new URL('../data/', import.meta.url);
  return _dir;
}
/** Caminho relativo à pasta de dados → URL absoluta. Aceita o formato antigo './data/...'. */
export const dataUrl = p => new URL(p.replace(/^\.\/data\//, ''), dataDir());
const filePath = () => new URL('db.json', dataDir());

/** Readiness: pasta de dados legível/gravável e db em memória carregado. */
export function checkStoreReady() {
  if (!db) return { ok: false, reason: 'store_not_loaded' };
  try {
    const dirPath = fileURLToPath(dataDir());
    accessSync(dirPath, constants.R_OK | constants.W_OK);
    const fp = fileURLToPath(filePath());
    if (existsSync(fp)) readFileSync(fp, 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.code || e?.message || 'store_unavailable' };
  }
}

/** @internal Evita exceção síncrona em handlers HTTP ao checar readiness. */
export function safeCheckStoreReady() {
  try {
    return checkStoreReady();
  } catch (e) {
    return { ok: false, reason: e?.code || e?.message || 'store_unavailable' };
  }
}

export const TOOLS = ['web', 'computer', 'browser', 'memory', 'routines', 'files', 'plugins', 'social'];
export const AVATAR_TYPES = ['clover', 'flower', 'triangle', 'square', 'blob', 'ghost', 'circle', 'drop', 'star', 'droid', 'mech', 'alien', 'hexagon', 'cat', 'cloud', 'pill', 'pebble', 'puddle'];

const DEFAULT = {
  schemaVersion: 2,
  settings: {
    name: '',
    customInstructions: '',
    defaultModel: 'auto',
    memory: true,
    claude: { mode: 'subscription', apiKey: '', useConnectors: true },
    chatgpt: { useConnectedApps: true },
    openrouter: { apiKey: '', models: [] },
    computer: { mode: 'boat', boatApiKey: '', vmSize: 'default', idleStopMinutes: 10, allowLocalCommands: false },
    sandbox: { enabled: false, image: 'node:22-alpine', network: 'none', memory: '512m', cpus: '1', timeoutSeconds: 300 },
    julia: {
      url: 'http://127.0.0.1:8765',
      semanticCache: {
        enabled: false,
        minScore: 0.88,
        ttlMs: 7 * 24 * 60 * 60 * 1000,
        maxEntries: 400
      },
      cascade: { enabled: true }
    },
    providerRetry: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 60_000 },
    contextPruning: { enabled: false, maxMessages: 48, maxTokens: 32000, keepRecent: 14 },
    inputQueue: { enabled: true, windowMs: 2500 },
    tokenBudget: {
      enabled: false,
      periodHours: 24,
      globalMaxTokens: null,
      agents: {},
      loopDetection: { enabled: false, sameToolThreshold: 6, windowSeconds: 120 }
    },
    rateLimit: { enabled: false, chatPerMinute: 30, apiPerMinute: 20, windowMs: 60_000 },
    logging: { json: false },
    flags: { ...DEFAULT_FLAGS },
    lgpd: {
      enabled: false,
      redactBeforeLlm: true,
      redactInLogs: false,
      categories: { cpf: true, documents: true, financial: true, contact: true }
    },
    retention: {
      enabled: false,
      chatDays: 90,
      usageEventsDays: 90,
      auditDays: 180,
      artifactsDays: 90
    },
    chaos: { enabled: false, providerFailRate: 0, sseDelayMs: 0, mcpDisconnect: false },
    plugins: [],
    backup: { enabled: false, intervalHours: 24, keepCount: 5 },
    social: { webhooks: [] },
    ui: { mode: 'simple', locale: DEFAULT_LOCALE },
    enterprise: { enabled: false },
    taskSync: {
      google: { enabled: true, taskListId: '@default' }
    },
    defaults: { agentStyle: {} },
    models: { enabled: {}, maxEffort: {} },
    whatsappWeb: { enabled: false, paused: false, agentId: '', allowlist: [], readAll: false, readGroups: false, contactModes: {} },
    whatsapp: { enabled: false, agentId: '', phoneNumberId: '', verifyToken: '', accessToken: '', appSecret: '' },
    brand: { ...EMPTY_BRAND, links: { ...EMPTY_BRAND.links } }
  },
  auditLog: [],
  agents: [],
  chats: [],    // { id, agentId, title, messages: [{ id, role, content, model, files?, at }], createdAt, updatedAt }
  files: [],    // { id, agentId, chatId, name, type, size, path, createdAt }
  memories: [],
  routines: [],
  projects: [],
  artifacts: [], // { id, projectId, chatId, agentId, title, kind, content, version, createdAt, updatedAt }
  messages: [],  // mensagens entre agentes: { id, from, to, body, priority, status, hops, originChatId, threadChatId, createdAt, deliveredAt, protocol? }
  delegations: [], // manager-worker: { id, managerId, workerId, title, description, status, originChatId, events, progress?, result?, rejectReason?, createdAt, updatedAt }
  taskItems: [], // tarefas delegadas (inbox): { id, requesterId, assigneeId, inboxMessageId, originChatId, title, status, result?, archivedAt?, createdAt, updatedAt }
  approvals: [], // { id, agentId, chatId, kind, command, reason, status, createdAt, decidedAt }
  skills: [],    // { id, name, description, content, projectId, createdBy, createdAt, updatedAt }
  agentTemplates: [], // modelos salvos pelo usuário para criar agentes
  teamProposals: [], // meta-prompting: times propostos antes de virar agentes
  accessControl: { enabled: false, teams: [], assignments: [] },
  taskDelegations: [], // { id, title, status, external?, sync?, delegation?, agentId?, chatId?, ... }
  credentialVault: {} // vlt_* → { sealed, label?, purpose?, createdAt }
};

/** Snapshot de usage.byModel no último load/flush — base para mesclar contadores entre processos. */
let usageByModelBaseline = {};

let idBaseline = {}; // ids de cada coleção no último load/flush: apagar aqui não pode ser desfeito pelo merge
function captureUsageBaseline(from) {
  usageByModelBaseline = structuredClone(from?.usage?.byModel || {});
  idBaseline = Object.fromEntries(ID_COLLECTIONS.map(k => [k, new Set((from?.[k] || []).map(x => x?.id))]));
}

function readPersistedJson() {
  const FILE = filePath();
  return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : null;
}

function writePersistedJson(snapshot) {
  const tmp = new URL('db.json.tmp', dataDir());
  const out = structuredClone(snapshot);
  if (out.usage?.events) delete out.usage.events;
  writeFileSync(tmp, JSON.stringify(out));
  renameSync(tmp, filePath());
}

/** Mantém a mesma referência de `db` (server.mjs guarda o retorno de load()). */
function applyMergedToDb(target, merged) {
  for (const k of Object.keys(merged)) target[k] = merged[k];
}

/** Só para testes: libera cache em memória e permite outro RIPPER_DATA no mesmo processo. */
export function _resetStoreForTests() {
  db = undefined;
  _dir = undefined;
  usageByModelBaseline = {};
  clearTimeout(timer);
  timer = undefined;
  _resetUsageEventsForTests();
  _resetJuliaEventsForTests();
  _resetSemanticCacheForTests();
  _resetAuditTrailForTests();
  _resetPersistCoordForTests();
}

let db;
function normalizeLoadedDb(persisted) {
  const out = persisted ? { ...structuredClone(DEFAULT), ...persisted } : structuredClone(DEFAULT);
  out.schemaVersion = DEFAULT.schemaVersion;
  out.settings = { ...structuredClone(DEFAULT.settings), ...out.settings };
  out.settings.computer = { ...DEFAULT.settings.computer, ...out.settings.computer };
  out.settings.sandbox = { ...DEFAULT.settings.sandbox, ...out.settings.sandbox };
  out.settings.julia = { ...DEFAULT.settings.julia, ...out.settings.julia };
  out.settings.julia.semanticCache = {
    ...DEFAULT.settings.julia.semanticCache,
    ...(out.settings.julia.semanticCache || {})
  };
  out.settings.julia.cascade = { ...DEFAULT.settings.julia.cascade, ...out.settings.julia?.cascade };
  out.settings.inputQueue = { ...DEFAULT.settings.inputQueue, ...out.settings.inputQueue };
  out.settings.rateLimit = { ...DEFAULT.settings.rateLimit, ...out.settings.rateLimit };
  out.settings.ui = { ...DEFAULT.settings.ui, ...(out.settings.ui || {}) };
  out.settings.ui.locale = normalizeLocale(out.settings.ui.locale);
  out.settings.enterprise = { ...DEFAULT.settings.enterprise, ...(out.settings.enterprise || {}) };
  syncUiEnterprise(out.settings);
  out.settings.flags = normalizeFeatureFlags(out.settings);
  out.settings.backup = normalizeBackupSettings({ ...DEFAULT.settings.backup, ...out.settings.backup });
  out.settings.models = normalizeModelPolicy(out.settings.models || {});
  out.settings.defaults = { ...structuredClone(DEFAULT.settings.defaults), ...(out.settings.defaults || {}) };
  out.settings.defaults.agentStyle = sanitizeStyleFields(out.settings.defaults.agentStyle || {}, {});
  out.settings.retention = { ...DEFAULT.settings.retention, ...out.settings.retention };
  out.settings.social = { webhooks: [], ...out.settings.social };
  if (!Array.isArray(out.settings.social.webhooks)) out.settings.social.webhooks = [];
  out.settings.chaos = { ...DEFAULT.settings.chaos, ...out.settings.chaos };
  out.settings.brand = normalizeBrand({ ...DEFAULT.settings.brand, ...out.settings.brand, links: { ...DEFAULT.settings.brand.links, ...out.settings.brand?.links } });
  out.auditLog = Array.isArray(out.auditLog) ? out.auditLog : [];
  out.delegations = Array.isArray(out.delegations) ? out.delegations : [];
  out.agents = out.agents.map(migrateAgent);
  out.routines = out.routines.map(r => {
    const item = { lastStatus: r.lastRun ? 'unknown' : 'never', lastError: null, ...r };
    if (item.lastStatus === 'running') { item.lastStatus = 'failed'; item.lastError = 'Servidor interrompido durante a execução.'; }
    return item;
  });
  const seen = new Map();
  for (const a of out.agents) { const n = (seen.get(a.name) || 0) + 1; seen.set(a.name, n); if (n > 1) a.name = `${a.name} ${n}`; }
  if (!out.agents.length) out.agents.push(newAgent({ name: 'Assistente', description: 'Ajuda com qualquer tarefa do dia a dia.', category: 'Produtividade' }));
  out.accessControl = ensureOwnerAdmin(normalizeAccessControl(out.accessControl));
  return out;
}

export function load() {
  if (db) return db;
  const DIR = dataDir();
  const FILE = filePath();
  mkdirSync(DIR, { recursive: true });
  withPersistMutex(() => {
    const persisted = readPersistedJson();
    if (persisted && (persisted.schemaVersion || 1) < DEFAULT.schemaVersion) {
      copyFileSync(FILE, new URL('db.pre-v2.backup.json', DIR));
    }
    db = normalizeLoadedDb(persisted);
    captureUsageBaseline(db);
  });
  const repairedOrphanRuns = repairChatRunsOnStartup(db.chats);
  ensureUsageEventsStore();
  ensureJuliaEventsStore();
  ensureSemanticCacheStore();
  ensureAuditTrailStore();
  migrateUsageEventsFromJson(db);
  save();
  if (repairedOrphanRuns) flush();
  return db;
}

// Agentes do formato anterior ganham os campos novos e perdem os antigos.
const LEGACY_NAMES = new Set(['Mimosa', 'Estrelinha', 'Malhada', 'Pipoca', 'Bolota', 'Nuvem', 'Paçoca', 'Vaquinha']);
function migrateAgent(a) {
  const { cow, ...rest } = a;
  const out = { ...newAgent({}), ...rest };
  if (cow && LEGACY_NAMES.has(out.name)) out.name = 'Assistente';
  return out;
}

let timer;
let flushing = false;
let flushAgain = false;

export function save() { clearTimeout(timer); timer = setTimeout(flush, 150); }

/** Reabre SQLite auxiliar após restore de arquivos no disco. */
export function reopenSqliteStores() {
  _resetUsageEventsForTests();
  _resetJuliaEventsForTests();
  ensureUsageEventsStore();
  ensureJuliaEventsStore();
}

/** Recarrega db.json do disco na referência em memória (após restore completo). */
export function reloadFromDisk(target) {
  if (!target) return;
  withPersistMutex(() => {
    const persisted = readPersistedJson();
    const merged = normalizeLoadedDb(persisted);
    applyMergedToDb(target, merged);
    captureUsageBaseline(target);
  });
}

export function flush() {
  clearTimeout(timer);
  timer = undefined;
  if (!db) return;
  if (flushing) {
    flushAgain = true;
    return;
  }
  flushing = true;
  try {
    // Grava num temporário e renomeia; mutex + merge permitem vários processos no mesmo RIPPER_DATA.
    withPersistMutex(() => {
      const disk = readPersistedJson();
      const merged = mergePersistedDb(DEFAULT, disk, db, usageByModelBaseline, idBaseline);
      writePersistedJson(merged);
      applyMergedToDb(db, merged);
      captureUsageBaseline(db);
    });
  } catch (e) {
    // Volume inacessível ou lock SQLite: não derrubar o processo (readiness continua respondendo 503).
    console.error('store.flush_failed', e?.code || e?.message || String(e));
  } finally {
    flushing = false;
    if (flushAgain) {
      flushAgain = false;
      flush();
    }
  }
}
process.on('exit', () => {
  try { flush(); } catch (e) {
    console.error('store.flush_exit_failed', e?.code || e?.message || String(e));
  }
});
export const id = () => randomUUID();

export function newAgent(p = {}) {
  const type = AVATAR_TYPES.includes(p.avatar?.type) ? p.avatar.type : AVATAR_TYPES[Math.floor(Math.random() * 9)];
  return {
    id: id(),
    name: p.name || 'Novo agente',
    description: p.description || '',
    category: p.category || 'Outro',
    status: 'online',
    instructions: p.instructions || '',
    tone: p.tone || 'direto',
    model: p.model || 'auto',
    effort: p.effort || 'auto',
    tools: Array.isArray(p.tools) ? p.tools.filter(t => TOOLS.includes(t)) : ['web', 'memory', 'routines', 'files'],
    avatar: { type, color: p.avatar?.color || null, face: p.avatar?.face === 'mouth' ? 'mouth' : 'eyes' },
    templateId: p.templateId || null,
    autonomyLevel: ['read_only', 'semi_autonomous', 'fully_autonomous'].includes(p.autonomyLevel) ? p.autonomyLevel : 'semi_autonomous',
    callPeers: Array.isArray(p.callPeers) ? p.callPeers.filter(x => typeof x === 'string').slice(0, 100) : null,
    vmId: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

// Só campos conhecidos passam da API para o banco.
export function patchAgent(a, b) {
  for (const k of ['name', 'description', 'category', 'instructions', 'tone', 'model']) if (typeof b[k] === 'string') a[k] = b[k].slice(0, k === 'instructions' ? 8000 : 200);
  if (b.style && typeof b.style === 'object') {
    a.style = sanitizeStyleFields(b.style, a.style || {});
    if (a.style.tone) a.tone = a.style.tone;
  } else if (typeof b.tone === 'string' && a.style && typeof a.style === 'object') {
    a.style = sanitizeStyleFields({ tone: b.tone }, a.style);
  }
  if (b.status === 'online' || b.status === 'paused') a.status = b.status;
  if (['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(b.effort)) a.effort = b.effort;
  if (Array.isArray(b.tools)) a.tools = b.tools.filter(t => TOOLS.includes(t));
  if (['read_only', 'semi_autonomous', 'fully_autonomous'].includes(b.autonomyLevel)) a.autonomyLevel = b.autonomyLevel;
  if (b.callPeers === null) a.callPeers = null;
  else if (Array.isArray(b.callPeers)) a.callPeers = [...new Set(b.callPeers.filter(x => typeof x === 'string'))].slice(0, 100);
  if (b.avatar) a.avatar = {
    type: AVATAR_TYPES.includes(b.avatar.type) ? b.avatar.type : a.avatar.type,
    color: typeof b.avatar.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(b.avatar.color) ? b.avatar.color : b.avatar.color === null ? null : a.avatar.color,
    face: b.avatar.face === 'mouth' ? 'mouth' : b.avatar.face === 'eyes' ? 'eyes' : a.avatar.face
  };
  if (b.teamBinding && typeof b.teamBinding === 'object') {
    a.teamBinding = {
      proposalId: typeof b.teamBinding.proposalId === 'string' ? b.teamBinding.proposalId.slice(0, 80) : undefined,
      roleId: typeof b.teamBinding.roleId === 'string' ? b.teamBinding.roleId.slice(0, 48) : undefined,
      managerKey: typeof b.teamBinding.managerKey === 'string' ? b.teamBinding.managerKey.slice(0, 48) : undefined,
      managerId: typeof b.teamBinding.managerId === 'string' ? b.teamBinding.managerId.slice(0, 80) : undefined,
      permissions: b.teamBinding.permissions && typeof b.teamBinding.permissions === 'object'
        ? structuredClone(b.teamBinding.permissions)
        : undefined
    };
  }
  a.updatedAt = Date.now();
  return a;
}
