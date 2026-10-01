/**
 * Mutex entre processos Node no mesmo RIPPER_DATA (SQLite BEGIN IMMEDIATE).
 * Usado para leitura/gravação atômica de db.json sem depender de flock no SO.
 */
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const BUSY_MS = 15_000;

let _dataDir;
function dataDir() {
  if (!_dataDir) {
    _dataDir = process.env.RIPPER_DATA
      ? pathToFileURL(resolve(process.env.RIPPER_DATA) + '/')
      : new URL('../data/', import.meta.url);
  }
  return _dataDir;
}

let _db;
let _dirKey;

function dirKey() {
  return fileURLToPath(dataDir());
}

function isSqliteBusy(err) {
  return err?.code === 'SQLITE_BUSY' || err?.errcode === 5
    || /database is locked/i.test(String(err?.message || err));
}

function spinWaitMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* aguarda lock SQLite entre processos */ }
}

function openCoord() {
  const key = dirKey();
  if (_db && _dirKey === key) return _db;
  if (_db) {
    try { _db.close(); } catch {}
  }
  const path = fileURLToPath(new URL('coord.sqlite', dataDir()));
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const db = new DatabaseSync(path);
      db.exec(`PRAGMA busy_timeout = ${BUSY_MS};`);
      db.exec(`
        CREATE TABLE IF NOT EXISTS persist_mutex (
          name TEXT PRIMARY KEY,
          since INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS routine_claim (
          routine_id TEXT PRIMARY KEY,
          until INTEGER NOT NULL
        );
      `);
      _db = db;
      _dirKey = key;
      return _db;
    } catch (err) {
      if (!isSqliteBusy(err) || attempt === 39) throw err;
      spinWaitMs(Math.min(25 * (attempt + 1), 150));
    }
  }
  return _db;
}

function closeCoordDb() {
  if (_db) {
    try { _db.close(); } catch {}
  }
  _db = undefined;
  _dirKey = undefined;
  _dataDir = undefined;
}

/** Fecha o SQLite de coordenação entre processos (shutdown gracioso). */
export function closePersistCoordStore() {
  closeCoordDb();
}

/** Só para testes: fecha o SQLite de coordenação e cache do diretório. */
export function _resetPersistCoordForTests() {
  closeCoordDb();
}

/**
 * Executa `fn` com trava exclusiva entre processos (bloqueia até busy_timeout).
 * @returns {ReturnType<fn>}
 */
/** Trava curta entre processos para não rodar a mesma rotina duas vezes ao mesmo tempo. */
export function tryClaimRoutine(routineId, ttlMs = 900_000) {
  if (!routineId) return false;
  return withPersistMutex(() => {
    const db = openCoord();
    const now = Date.now();
    db.prepare('DELETE FROM routine_claim WHERE until < ?').run(now);
    try {
      db.prepare('INSERT INTO routine_claim (routine_id, until) VALUES (?, ?)').run(routineId, now + ttlMs);
      return true;
    } catch (err) {
      if (/UNIQUE|constraint/i.test(String(err?.message || err))) return false;
      throw err;
    }
  });
}

export function releaseRoutineClaim(routineId) {
  if (!routineId) return;
  withPersistMutex(() => {
    const db = openCoord();
    db.prepare('DELETE FROM routine_claim WHERE routine_id = ?').run(routineId);
  });
}

export function withPersistMutex(fn) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const db = openCoord();
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch {}
        throw err;
      }
    } catch (err) {
      if (!isSqliteBusy(err) || attempt === 39) throw err;
      spinWaitMs(Math.min(25 * (attempt + 1), 150));
    }
  }
}
