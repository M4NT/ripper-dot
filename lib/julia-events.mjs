/**
 * Telemetria de decisões Julia-1 (alta frequência) em SQLite ao lado de usage.sqlite.
 * Contrato: contagens e latência medidas — sem US$ inventado.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { dataUrl } from './store.mjs';

export const JULIA_EVENTS_MAX = 800;

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
      `);
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

/** Só para testes: fecha SQLite e permite outro RIPPER_DATA no mesmo processo. */
export function _resetJuliaEventsForTests() {
  if (_db) {
    try { _db.close(); } catch {}
  }
  _db = undefined;
  _dirKey = undefined;
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
