/**
 * Eventos de uso (alta frequência) em SQLite ao lado de db.json.
 * Política: mantém no máximo USAGE_EVENTS_MAX linhas (equivalente ao ring de ~800 no JSON).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { dataUrl } from './store.mjs';

export const USAGE_EVENTS_MAX = 800;

let _db;
let _dirKey;

function sqlitePath() {
  return fileURLToPath(dataUrl('usage.sqlite'));
}

function dirKey() {
  return fileURLToPath(dataUrl(''));
}

function spinWaitMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* aguarda lock SQLite entre processos */ }
}

function openDb() {
  const key = dirKey();
  if (_db && _dirKey === key) return _db;
  if (_db) {
    try { _db.close(); } catch {}
  }
  const path = sqlitePath();
  mkdirSync(fileURLToPath(dataUrl('')), { recursive: true });
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const db = new DatabaseSync(path);
      // WAL + sync moderado: leitores não bloqueiam escritores; crash raro perde só o último fsync.
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 5000;
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS usage_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at INTEGER NOT NULL,
          model TEXT NOT NULL,
          chars_in INTEGER NOT NULL DEFAULT 0,
          chars_out INTEGER NOT NULL DEFAULT 0,
          routed_by TEXT,
          agent_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_usage_events_at ON usage_events(at);
      `);
      ensureUsageEventsColumns(db);
      _db = db;
      _dirKey = key;
      return _db;
    } catch (err) {
      const busy = err?.code === 'SQLITE_BUSY' || err?.errcode === 5
        || /database is locked/i.test(String(err?.message || err));
      if (!busy || attempt === 39) throw err;
      spinWaitMs(Math.min(25 * (attempt + 1), 150));
    }
  }
  return _db;
}

function ensureUsageEventsColumns(db) {
  const cols = db.prepare('PRAGMA table_info(usage_events)').all();
  if (!cols.some(c => c.name === 'agent_id')) {
    db.exec('ALTER TABLE usage_events ADD COLUMN agent_id TEXT');
  }
}

function rowToEvent(r) {
  return {
    at: r.at,
    model: r.model,
    charsIn: r.chars_in,
    charsOut: r.chars_out,
    routedBy: r.routed_by,
    agentId: r.agent_id || null
  };
}

function closeDbHandle() {
  if (_db) {
    try { _db.close(); } catch {}
  }
  _db = undefined;
  _dirKey = undefined;
}

/** Fecha o SQLite de eventos de uso (shutdown gracioso). */
export function closeUsageEventsStore() {
  closeDbHandle();
}

/** Só para testes: fecha o SQLite e permite outro RIPPER_DATA no mesmo processo. */
export function _resetUsageEventsForTests() {
  closeDbHandle();
}

const insertStmt = () => openDb().prepare(
  'INSERT INTO usage_events (at, model, chars_in, chars_out, routed_by, agent_id) VALUES (?, ?, ?, ?, ?, ?)'
);

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

export function appendUsageEvent({ at, model, charsIn = 0, charsOut = 0, routedBy = null, agentId = null }) {
  runWithSqliteBusyRetry(() => {
    insertStmt().run(at, model, charsIn, charsOut, routedBy, agentId || null);
    pruneUsageEvents();
  });
}

function pruneUsageEvents() {
  const db = openDb();
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM usage_events').get();
  const excess = count - USAGE_EVENTS_MAX;
  if (excess <= 0) return;
  db.prepare(
    `DELETE FROM usage_events WHERE id IN (
      SELECT id FROM usage_events ORDER BY at ASC, id ASC LIMIT ?
    )`
  ).run(excess);
}

/** Eventos com `at >= since` (ms), ordenados por tempo. */
export function listUsageEventsSince(since) {
  const rows = openDb().prepare(
    'SELECT at, model, chars_in, chars_out, routed_by, agent_id FROM usage_events WHERE at >= ? ORDER BY at ASC, id ASC'
  ).all(since);
  return rows.map(rowToEvent);
}

/** Todos os eventos retidos (no máximo USAGE_EVENTS_MAX). */
export function listAllUsageEvents() {
  const rows = openDb().prepare(
    'SELECT at, model, chars_in, chars_out, routed_by, agent_id FROM usage_events ORDER BY at ASC, id ASC'
  ).all();
  return rows.map(rowToEvent);
}

export function countUsageEvents() {
  return openDb().prepare('SELECT COUNT(*) AS count FROM usage_events').get().count;
}

/** Remove todos os eventos de uso (opt-in; servidor parado recomendado). */
export function clearAllUsageEvents() {
  runWithSqliteBusyRetry(() => {
    openDb().prepare('DELETE FROM usage_events').run();
  });
}

/** Só para testes: confirma pragmas de persistência aplicados na abertura. */
export function getUsageEventsSqlitePragmas() {
  const db = openDb();
  const busy = db.prepare('PRAGMA busy_timeout').get();
  return {
    journalMode: db.prepare('PRAGMA journal_mode').get().journal_mode,
    synchronous: db.prepare('PRAGMA synchronous').get().synchronous,
    busyTimeout: busy.timeout ?? busy.busy_timeout
  };
}

/** Importa eventos legados de db.json e remove o array do objeto usage em memória. */
export function migrateUsageEventsFromJson(db) {
  openDb();
  const legacy = db?.usage?.events;
  if (!Array.isArray(legacy) || legacy.length === 0) {
    if (db?.usage) delete db.usage.events;
    return { imported: 0 };
  }
  const existing = countUsageEvents();
  if (existing > 0) {
    delete db.usage.events;
    return { imported: 0, skipped: legacy.length, reason: 'sqlite_already_has_events' };
  }
  const ins = insertStmt();
  const tx = openDb().prepare('BEGIN');
  tx.run();
  try {
    for (const e of legacy) {
      if (!e || typeof e.at !== 'number' || !e.model) continue;
      ins.run(
        e.at,
        e.model,
        e.charsIn ?? 0,
        e.charsOut ?? 0,
        e.routedBy ?? null,
        e.agentId ?? null
      );
    }
    openDb().prepare('COMMIT').run();
  } catch (err) {
    openDb().prepare('ROLLBACK').run();
    throw err;
  }
  pruneUsageEvents();
  delete db.usage.events;
  return { imported: legacy.length };
}

/** Garante que o arquivo existe (ex.: após load do store). */
export function ensureUsageEventsStore() {
  if (!existsSync(sqlitePath())) openDb();
  else openDb();
}
