/**
 * Telemetria de decisões Julia-1 (alta frequência) em SQLite ao lado de usage.sqlite.
 * Contrato: contagens e latência medidas — sem US$ inventado.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { dataUrl } from './store.mjs';

export const JULIA_EVENTS_MAX = 800;
export const SEMANTIC_CACHE_HITS_MAX = 800;

/** Propósitos conhecidos (tag gravada em cada evento). */
export const JULIA_PURPOSES = ['route', 'speaker', 'risk', 'notify', 'unknown'];

let _db;
let _dirKey;

function sqlitePath() {
  return fileURLToPath(dataUrl('julia.sqlite'));
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
  mkdirSync(fileURLToPath(dataUrl('')), { recursive: true });
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const db = new DatabaseSync(sqlitePath());
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 5000;
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS julia_decisions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at INTEGER NOT NULL,
          purpose TEXT NOT NULL DEFAULT 'unknown',
          latency_ms INTEGER NOT NULL,
          option_count INTEGER NOT NULL,
          ok INTEGER NOT NULL,
          reason TEXT,
          score REAL,
          avoided_prompt_chars INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_julia_decisions_at ON julia_decisions(at);
        CREATE TABLE IF NOT EXISTS julia_cascade_decisions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at INTEGER NOT NULL,
          task_category TEXT NOT NULL,
          model_id TEXT,
          provider TEXT,
          raw_cost REAL,
          effective_cost REAL,
          success_rate REAL,
          candidates INTEGER NOT NULL DEFAULT 0,
          reason TEXT,
          routed_by TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_julia_cascade_at ON julia_cascade_decisions(at);
      `);
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

function closeDbHandle() {
  if (_db) {
    try { _db.close(); } catch {}
  }
  _db = undefined;
  _dirKey = undefined;
}

/** Fecha o SQLite de telemetria Julia (shutdown gracioso). */
export function closeJuliaEventsStore() {
  closeDbHandle();
}

/** Só para testes: fecha SQLite e permite outro RIPPER_DATA no mesmo processo. */
export function _resetJuliaEventsForTests() {
  closeDbHandle();
}

const insertStmt = () => openDb().prepare(
  `INSERT INTO julia_decisions
   (at, purpose, latency_ms, option_count, ok, reason, score, avoided_prompt_chars)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
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

/**
 * @param {object} ev
 * @param {number} ev.at
 * @param {string} [ev.purpose]
 * @param {number} ev.latencyMs
 * @param {number} ev.optionCount
 * @param {boolean} ev.ok
 * @param {string|null} [ev.reason]
 * @param {number|null} [ev.score]
 * @param {number|null} [ev.avoidedPromptChars] — só quando o call site mediu o prompt de triagem
 */
export function appendJuliaDecision(ev) {
  const purpose = JULIA_PURPOSES.includes(ev.purpose) ? ev.purpose : 'unknown';
  runWithSqliteBusyRetry(() => {
    insertStmt().run(
      ev.at ?? Date.now(),
      purpose,
      Math.max(0, Math.round(ev.latencyMs ?? 0)),
      ev.optionCount ?? 0,
      ev.ok ? 1 : 0,
      ev.ok ? null : (ev.reason ?? 'unknown'),
      ev.ok && ev.score != null ? ev.score : null,
      ev.avoidedPromptChars != null ? Math.max(0, Math.round(ev.avoidedPromptChars)) : null
    );
    pruneJuliaDecisions();
  });
}

function pruneJuliaDecisions() {
  const db = openDb();
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM julia_decisions').get();
  const excess = count - JULIA_EVENTS_MAX;
  if (excess <= 0) return;
  db.prepare(
    `DELETE FROM julia_decisions WHERE id IN (
      SELECT id FROM julia_decisions ORDER BY at ASC, id ASC LIMIT ?
    )`
  ).run(excess);
}

export function countJuliaDecisions() {
  return openDb().prepare('SELECT COUNT(*) AS count FROM julia_decisions').get().count;
}

/** Remove todas as decisões Julia gravadas (opt-in; servidor parado recomendado). */
export function clearAllJuliaDecisions() {
  runWithSqliteBusyRetry(() => {
    openDb().prepare('DELETE FROM julia_decisions').run();
  });
}

function ensureSemanticCacheHitsTable() {
  openDb().exec(`
    CREATE TABLE IF NOT EXISTS semantic_cache_hits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      hit INTEGER NOT NULL,
      saved_chars INTEGER,
      purpose TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_semantic_cache_hits_at ON semantic_cache_hits(at);
  `);
}

/**
 * Telemetria de lookup do cache semântico (ROI / token-roi) — sem US$.
 * @param {{ hit: boolean, savedChars?: number|null, purpose?: string }} ev
 */
export function appendSemanticCacheHit(ev) {
  const purpose = String(ev.purpose || 'chat').slice(0, 40);
  runWithSqliteBusyRetry(() => {
    ensureSemanticCacheHitsTable();
    openDb().prepare(
      'INSERT INTO semantic_cache_hits (at, hit, saved_chars, purpose) VALUES (?, ?, ?, ?)'
    ).run(
      Date.now(),
      ev.hit ? 1 : 0,
      ev.hit && ev.savedChars != null ? Math.max(0, Math.round(ev.savedChars)) : null,
      purpose
    );
    pruneSemanticCacheHits();
  });
}

function pruneSemanticCacheHits() {
  const db = openDb();
  const row = db.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'semantic_cache_hits'"
  ).get();
  if (!row?.ok) return;
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM semantic_cache_hits').get();
  const excess = count - SEMANTIC_CACHE_HITS_MAX;
  if (excess <= 0) return;
  db.prepare(
    `DELETE FROM semantic_cache_hits WHERE id IN (
      SELECT id FROM semantic_cache_hits ORDER BY at ASC, id ASC LIMIT ?
    )`
  ).run(excess);
}

export function countSemanticCacheHits() {
  const db = openDb();
  const row = db.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'semantic_cache_hits'"
  ).get();
  if (!row?.ok) return 0;
  return db.prepare('SELECT COUNT(*) AS count FROM semantic_cache_hits').get().count;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/** Agregados para UI /api/usage/limits — sem campos de dinheiro. */
export function juliaTelemetrySummary() {
  const rows = openDb().prepare(
    'SELECT purpose, latency_ms, ok, reason, avoided_prompt_chars FROM julia_decisions'
  ).all();
  if (!rows.length) return null;

  const fallbacksByReason = {};
  const byPurpose = {};
  const latencies = [];
  let answered = 0;
  let fallbacks = 0;
  let avoidedPromptCharsSum = 0;
  let avoidedPromptCharsEvents = 0;

  for (const r of rows) {
    if (r.ok) answered++;
    else {
      fallbacks++;
      const reason = r.reason || 'unknown';
      fallbacksByReason[reason] = (fallbacksByReason[reason] || 0) + 1;
    }
    latencies.push(r.latency_ms);
    const p = r.purpose || 'unknown';
    if (!byPurpose[p]) byPurpose[p] = { decisions: 0, answered: 0, fallbacks: 0 };
    byPurpose[p].decisions++;
    if (r.ok) byPurpose[p].answered++;
    else byPurpose[p].fallbacks++;
    if (r.avoided_prompt_chars != null) {
      avoidedPromptCharsSum += r.avoided_prompt_chars;
      avoidedPromptCharsEvents++;
    }
  }

  latencies.sort((a, b) => a - b);
  const latencyMs = latencies.length
    ? { p50: percentile(latencies, 50), p95: percentile(latencies, 95), samples: latencies.length }
    : null;

  const out = {
    decisions: rows.length,
    answered,
    fallbacks,
    fallbacksByReason,
    byPurpose,
    latencyMs
  };
  if (avoidedPromptCharsEvents > 0) {
    out.avoidedPromptChars = {
      sum: avoidedPromptCharsSum,
      eventsWithMeasurement: avoidedPromptCharsEvents
    };
  }
  return out;
}

export function ensureJuliaEventsStore() {
  if (!existsSync(sqlitePath())) openDb();
  else openDb();
}

const cascadeInsertStmt = () => openDb().prepare(
  `INSERT INTO julia_cascade_decisions
   (at, task_category, model_id, provider, raw_cost, effective_cost, success_rate, candidates, reason, routed_by)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

/**
 * Decisões CPS do cascading (PR 56) — estimativas de catálogo, não billing.
 */
export function appendCascadeDecision(ev) {
  runWithSqliteBusyRetry(() => {
    cascadeInsertStmt().run(
      ev.at ?? Date.now(),
      ev.taskCategory ?? 'unknown',
      ev.modelId ?? null,
      ev.provider ?? null,
      ev.rawCost ?? null,
      ev.effectiveCost ?? null,
      ev.successRate ?? null,
      Math.max(0, Math.round(ev.candidates ?? 0)),
      ev.reason ?? null,
      ev.routedBy ?? null
    );
  });
}

export function countCascadeDecisions() {
  return openDb().prepare('SELECT COUNT(*) AS count FROM julia_cascade_decisions').get().count;
}
