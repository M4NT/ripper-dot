import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync, copyFileSync } from 'node:fs';
import { migrateUsageEventsFromJson, ensureUsageEventsStore, _resetUsageEventsForTests } from './usage-events.mjs';
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
    plugins: []
  },
  agents: [],
  chats: [],    // { id, agentId, title, messages: [{ id, role, content, model, files?, at }], createdAt, updatedAt }
  files: [],    // { id, agentId, chatId, name, type, size, path, createdAt }
  memories: [],
  routines: [],
  projects: [],
  artifacts: [], // { id, projectId, chatId, agentId, title, kind, content, version, createdAt, updatedAt }
  messages: [],  // mensagens entre agentes: { id, from, to, body, priority, status, hops, originChatId, threadChatId, createdAt, deliveredAt }
  approvals: [], // { id, agentId, chatId, kind, command, reason, status, createdAt, decidedAt }
  skills: []     // { id, name, description, content, projectId, createdBy, createdAt, updatedAt }  // { id, name, description, instructions, agentIds, createdAt }
};

// Um só processo por pasta de dados: dois servidores gravando o mesmo db.json perdem dados.
const lockPath = () => new URL('.lock', dataDir());
function lock() {
  const LOCK = lockPath();
  try { writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); }
  catch {
    const pid = +readFileSync(LOCK, 'utf8');
    let alive = false;
    try { process.kill(pid, 0); alive = pid !== process.pid; } catch {}
    if (alive) { console.error(`Outro Ripper (PID ${pid}) já usa esta pasta de dados. Pare-o antes de iniciar outro.`); process.exit(1); }
    writeFileSync(LOCK, String(process.pid));
  }
  process.on('exit', () => { try { if (readFileSync(LOCK, 'utf8') === String(process.pid)) unlinkSync(lockPath()); } catch {} });
}

/** Só para testes: libera cache em memória e permite outro RIPPER_DATA no mesmo processo. */
export function _resetStoreForTests() {
  db = undefined;
  _dir = undefined;
  clearTimeout(timer);
  timer = undefined;
  _resetUsageEventsForTests();
}

let db;
export function load() {
  if (db) return db;
  const DIR = dataDir();
  const FILE = filePath();
  mkdirSync(DIR, { recursive: true });
  lock();
  const persisted = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : null;
  if (persisted && (persisted.schemaVersion || 1) < DEFAULT.schemaVersion) {
    copyFileSync(FILE, new URL('db.pre-v2.backup.json', DIR));
  }
  db = persisted ? { ...structuredClone(DEFAULT), ...persisted } : structuredClone(DEFAULT);
  db.schemaVersion = DEFAULT.schemaVersion;
  db.settings = { ...structuredClone(DEFAULT.settings), ...db.settings };
  db.settings.computer = { ...DEFAULT.settings.computer, ...db.settings.computer };
  db.agents = db.agents.map(migrateAgent);
  db.routines = db.routines.map(r => {
    const item = { lastStatus: r.lastRun ? 'unknown' : 'never', lastError: null, ...r };
    if (item.lastStatus === 'running') { item.lastStatus = 'failed'; item.lastError = 'Servidor interrompido durante a execução.'; }
    return item;
  });
  const seen = new Map();
  for (const a of db.agents) { const n = (seen.get(a.name) || 0) + 1; seen.set(a.name, n); if (n > 1) a.name = `${a.name} ${n}`; }
  if (!db.agents.length) db.agents.push(newAgent({ name: 'Assistente', description: 'Ajuda com qualquer tarefa do dia a dia.', category: 'Produtividade' }));
  ensureUsageEventsStore();
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
export function save() { clearTimeout(timer); timer = setTimeout(flush, 150); }
export function flush() {
  clearTimeout(timer);
  if (!db) return;
  // Grava num temporário e renomeia: um crash no meio nunca corrompe o banco.
  const FILE = filePath();
  const tmp = new URL('db.json.tmp', dataDir());
  const snapshot = structuredClone(db);
  if (snapshot.usage?.events) delete snapshot.usage.events;
  writeFileSync(tmp, JSON.stringify(snapshot));
  renameSync(tmp, FILE);
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
    createdAt: Date.now()
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
  return a;
}
