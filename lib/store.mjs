import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync } from 'node:fs';
import { migrateUsageEventsFromJson, ensureUsageEventsStore, _resetUsageEventsForTests } from './usage-events.mjs';
import { ensureJuliaEventsStore, _resetJuliaEventsForTests } from './julia-events.mjs';
import { withPersistMutex, _resetPersistCoordForTests } from './persist-coord.mjs';
import { mergePersistedDb } from './db-merge.mjs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// RIPPER_DATA aponta para outra pasta (ex.: um volume persistente em produção).
let _dir;
function dataDir() {
  if (!_dir) _dir = process.env.RIPPER_DATA ? pathToFileURL(resolve(process.env.RIPPER_DATA) + '/') : new URL('../data/', import.meta.url);
  return _dir;
}
/** Caminho relativo à pasta de dados → URL absoluta. Aceita o formato antigo './data/...'. */
export const dataUrl = p => new URL(p.replace(/^\.\/data\//, ''), dataDir());
const filePath = () => new URL('db.json', dataDir());

export const TOOLS = ['web', 'computer', 'browser', 'memory', 'routines', 'files', 'plugins'];
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
    computer: { mode: 'boat', boatApiKey: '', vmSize: 'default', idleStopMinutes: 10, allowLocalCommands: false },
    julia: { url: 'http://127.0.0.1:8765' },
    providerRetry: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 60_000 },
    plugins: []
  },
  auditLog: [],
  agents: [],
  chats: [],    // { id, agentId, title, messages: [{ id, role, content, model, files?, at }], createdAt, updatedAt }
  files: [],    // { id, agentId, chatId, name, type, size, path, createdAt }
  memories: [],
  routines: [],
  projects: [],
  artifacts: [], // { id, projectId, chatId, agentId, title, kind, content, version, createdAt, updatedAt }
  messages: [],  // mensagens entre agentes: { id, from, to, body, priority, status, hops, originChatId, threadChatId, createdAt, deliveredAt }
  approvals: [], // { id, agentId, chatId, kind, command, reason, status, createdAt, decidedAt }
  skills: [],    // { id, name, description, content, projectId, createdBy, createdAt, updatedAt }
  agentTemplates: [] // modelos salvos pelo usuário para criar agentes
};

/** Snapshot de usage.byModel no último load/flush — base para mesclar contadores entre processos. */
let usageByModelBaseline = {};

function captureUsageBaseline(from) {
  usageByModelBaseline = structuredClone(from?.usage?.byModel || {});
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
  _resetPersistCoordForTests();
}

let db;
function normalizeLoadedDb(persisted) {
  const out = persisted ? { ...structuredClone(DEFAULT), ...persisted } : structuredClone(DEFAULT);
  out.schemaVersion = DEFAULT.schemaVersion;
  out.settings = { ...structuredClone(DEFAULT.settings), ...out.settings };
  out.settings.computer = { ...DEFAULT.settings.computer, ...out.settings.computer };
  out.auditLog = Array.isArray(out.auditLog) ? out.auditLog : [];
  out.agents = out.agents.map(migrateAgent);
  out.routines = out.routines.map(r => {
    const item = { lastStatus: r.lastRun ? 'unknown' : 'never', lastError: null, ...r };
    if (item.lastStatus === 'running') { item.lastStatus = 'failed'; item.lastError = 'Servidor interrompido durante a execução.'; }
    return item;
  });
  const seen = new Map();
  for (const a of out.agents) { const n = (seen.get(a.name) || 0) + 1; seen.set(a.name, n); if (n > 1) a.name = `${a.name} ${n}`; }
  if (!out.agents.length) out.agents.push(newAgent({ name: 'Assistente', description: 'Ajuda com qualquer tarefa do dia a dia.', category: 'Produtividade' }));
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
  ensureUsageEventsStore();
  ensureJuliaEventsStore();
  migrateUsageEventsFromJson(db);
  save();
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
      const merged = mergePersistedDb(DEFAULT, disk, db, usageByModelBaseline);
      writePersistedJson(merged);
      applyMergedToDb(db, merged);
      captureUsageBaseline(db);
    });
  } finally {
    flushing = false;
    if (flushAgain) {
      flushAgain = false;
      flush();
    }
  }
}
process.on('exit', flush);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit());
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
    vmId: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

// Só campos conhecidos passam da API para o banco.
export function patchAgent(a, b) {
  for (const k of ['name', 'description', 'category', 'instructions', 'tone', 'model']) if (typeof b[k] === 'string') a[k] = b[k].slice(0, k === 'instructions' ? 8000 : 200);
  if (b.status === 'online' || b.status === 'paused') a.status = b.status;
  if (['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(b.effort)) a.effort = b.effort;
  if (Array.isArray(b.tools)) a.tools = b.tools.filter(t => TOOLS.includes(t));
  if (b.avatar) a.avatar = {
    type: AVATAR_TYPES.includes(b.avatar.type) ? b.avatar.type : a.avatar.type,
    color: typeof b.avatar.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(b.avatar.color) ? b.avatar.color : b.avatar.color === null ? null : a.avatar.color,
    face: b.avatar.face === 'mouth' ? 'mouth' : b.avatar.face === 'eyes' ? 'eyes' : a.avatar.face
  };
  a.updatedAt = Date.now();
  return a;
}
