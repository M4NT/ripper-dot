/**
 * Trilha de auditoria corporativa WORM (append-only) em SQLite.
 * Sem UPDATE/DELETE na tabela — triggers SQLite reforçam imutabilidade.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { dataUrl } from './store.mjs';

export const AUDIT_TRAIL_CATEGORIES = [
  'approval',
  'agent',
  'settings',
  'data',
  'security',
  'whatsapp',
  'billing',
  'external' // ação que sai do Ripper (mensagem, post, link público): sempre gravada (lib/external-actions.mjs)
];

let _db;
let _dirKey;

function sqlitePath() {
  return fileURLToPath(dataUrl('audit-trail.sqlite'));
}

function dirKey() {
  return fileURLToPath(dataUrl(''));
}

function spinWaitMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* aguarda lock SQLite entre processos */ }
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_trail (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      at INTEGER NOT NULL,
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      agent_id TEXT,
      chat_id TEXT,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_trail_at ON audit_trail(at);
    CREATE INDEX IF NOT EXISTS idx_audit_trail_category ON audit_trail(category);
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS audit_trail_no_update
    BEFORE UPDATE ON audit_trail
    BEGIN
      SELECT RAISE(ABORT, 'audit_trail is immutable');
    END;
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS audit_trail_no_delete
    BEFORE DELETE ON audit_trail
    BEGIN
      SELECT RAISE(ABORT, 'audit_trail is immutable');
    END;
  `);
}

function openDb() {
  const key = dirKey();
  if (_db && _dirKey === key) return _db;
  if (_db) {
    try { _db.close(); } catch {}
  }
  mkdirSync(fileURLToPath(dataUrl('')), { recursive: true });
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const db = new DatabaseSync(sqlitePath());
      db.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
      `);
      initSchema(db);
      _db = db;
      _dirKey = key;
      return _db;
    } catch (err) {
      const busy = err?.code === 'SQLITE_BUSY' || err?.errcode === 5
        || /database is locked/i.test(String(err?.message || err))
        // Windows: dois processos abrindo o mesmo banco novo em WAL dão IOERR transitório.
        || /disk I.O error/i.test(String(err?.message || err));
      if (!busy || attempt === 39) throw err;
      spinWaitMs(Math.min(25 * (attempt + 1), 150));
    }
  }
  return _db;
}

function runWithSqliteBusyRetry(fn, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (err) {
      const busy = err?.code === 'SQLITE_BUSY' || /database is locked/i.test(String(err?.message || err));
      if (!busy || i === attempts - 1) throw err;
    }
  }
}

function rowToEntry(r) {
  let detail = {};
  try {
    detail = JSON.parse(r.payload || '{}');
  } catch {
    detail = { _parseError: true };
  }
  return {
    id: r.id,
    at: r.at,
    category: r.category,
    action: r.action,
    agentId: r.agent_id || undefined,
    chatId: r.chat_id || undefined,
    ...detail
  };
}

const insertStmt = () => openDb().prepare(
  `INSERT INTO audit_trail (id, at, category, action, agent_id, chat_id, payload)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

/**
 * @param {object} entry
 * @param {string} entry.category
 * @param {string} entry.action
 * @param {string} [entry.agentId]
 * @param {string} [entry.chatId]
 * @param {object} [entry.detail] — campos extras (sem segredos)
 */
export function appendAuditTrail(entry) {
  const category = AUDIT_TRAIL_CATEGORIES.includes(entry.category) ? entry.category : 'security';
  const action = String(entry.action || 'unknown').slice(0, 120);
  const at = entry.at ?? Date.now();
  const id = entry.id || randomUUID();
  const { category: _c, action: _a, agentId, chatId, at: _at, id: _id, ...rest } = entry;
  const payload = JSON.stringify(rest.detail != null ? rest.detail : rest);
  runWithSqliteBusyRetry(() => {
    insertStmt().run(
      id,
      at,
      category,
      action,
      agentId || null,
      chatId || null,
      payload.slice(0, 16_000)
    );
  });
  return { id, at, category, action, agentId, chatId };
}

export function listAuditTrail({ limit = 50, since = 0, category, max = 500 } = {}) {
  const n = Math.max(1, Math.min(max, limit));
  const rows = openDb().prepare(
    `SELECT id, at, category, action, agent_id, chat_id, payload
     FROM audit_trail
     WHERE at >= ? AND (? IS NULL OR category = ?)
     ORDER BY at DESC, seq DESC
     LIMIT ?`
  ).all(since || 0, category ?? null, category ?? null, n);
  return rows.map(rowToEntry);
}

export function countAuditTrail() {
  return openDb().prepare('SELECT COUNT(*) AS count FROM audit_trail').get().count;
}

export function ensureAuditTrailStore() {
  if (!existsSync(sqlitePath())) openDb();
  else openDb();
}

/** Só para testes: fecha SQLite e permite outro RIPPER_DATA no mesmo processo. */
export function _resetAuditTrailForTests() {
  if (_db) {
    try { _db.close(); } catch {}
  }
  _db = undefined;
  _dirKey = undefined;
}

/** Só para testes: tentativa direta de mutação (deve falhar com triggers WORM). */
export function _testMutateAuditTrail(op) {
  const db = openDb();
  if (op === 'update') {
    db.prepare('UPDATE audit_trail SET action = ? WHERE seq = 1').run('mutated');
  } else if (op === 'delete') {
    db.prepare('DELETE FROM audit_trail WHERE seq = 1').run();
  } else {
    throw new Error('op inválida');
  }
}
