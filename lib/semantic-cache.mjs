/**
 * Cache semântico local (SQLite em RIPPER_DATA). Evita chamadas ao LLM quando há hit
 * de alta confiança. Telemetria de hits em semantic_cache_hits (ROI / PR 60) — sem US$.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { dataUrl } from './store.mjs';
import { cacheComparableText, cosineSimilarity, embedText, DEFAULT_EMBED_DIM } from './semantic-embed.mjs';

export const SEMANTIC_CACHE_DEFAULTS = {
  enabled: false,
  minScore: 0.88,
  ttlMs: 7 * 24 * 60 * 60 * 1000,
  maxEntries: 400,
  embedDim: DEFAULT_EMBED_DIM
};

let _db;
let _dirKey;

function sqlitePath() {
  return fileURLToPath(dataUrl('semantic-cache.sqlite'));
}

function dirKey() {
  return fileURLToPath(dataUrl(''));
}

function spinWaitMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* lock SQLite entre processos */ }
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
        PRAGMA synchronous = NORMAL;
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS semantic_cache_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id TEXT NOT NULL,
          model TEXT NOT NULL,
          question TEXT NOT NULL,
          context_hash TEXT NOT NULL,
          embedding TEXT NOT NULL,
          answer TEXT NOT NULL,
          effort TEXT,
          created_at INTEGER NOT NULL,
          last_hit_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_semantic_cache_created ON semantic_cache_entries(created_at);
        CREATE INDEX IF NOT EXISTS idx_semantic_cache_agent_model ON semantic_cache_entries(agent_id, model);
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

export function _resetSemanticCacheForTests() {
  if (_db) {
    try { _db.close(); } catch {}
  }
  _db = undefined;
  _dirKey = undefined;
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

export function ensureSemanticCacheStore() {
  if (!existsSync(sqlitePath())) openDb();
  else openDb();
}

/** @param {object} settings — db.settings */
export function resolveSemanticCacheConfig(settings) {
  const raw = settings?.julia?.semanticCache || {};
  return {
    enabled: raw.enabled === true,
    minScore: Math.min(0.999, Math.max(0.5, +raw.minScore || SEMANTIC_CACHE_DEFAULTS.minScore)),
    ttlMs: Math.max(60_000, Math.min(90 * 24 * 60 * 60 * 1000, +raw.ttlMs || SEMANTIC_CACHE_DEFAULTS.ttlMs)),
    maxEntries: Math.max(10, Math.min(5000, Math.round(+raw.maxEntries || SEMANTIC_CACHE_DEFAULTS.maxEntries))),
    embedDim: Math.max(64, Math.min(512, Math.round(+raw.embedDim || SEMANTIC_CACHE_DEFAULTS.embedDim)))
  };
}

function contextHash(context) {
  const c = String(context || '').slice(-2000);
  if (!c) return '';
  return createHashShort(c);
}

function createHashShort(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function pruneEntries(maxEntries) {
  const db = openDb();
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM semantic_cache_entries').get();
  const excess = count - maxEntries;
  if (excess <= 0) return;
  db.prepare(
    `DELETE FROM semantic_cache_entries WHERE id IN (
      SELECT id FROM semantic_cache_entries ORDER BY created_at ASC, id ASC LIMIT ?
    )`
  ).run(excess);
}

function pruneExpired(ttlMs) {
  const cutoff = Date.now() - ttlMs;
  openDb().prepare('DELETE FROM semantic_cache_entries WHERE created_at < ?').run(cutoff);
}

function logRoi(ev) {
  import('./julia-events.mjs')
    .then(m => m.appendSemanticCacheHit(ev))
    .catch(e => console.warn('[semantic-cache] roi:', e?.message || e));
}

/**
 * @returns {{ hit: false } | { hit: true, score: number, answer: string, entryId: number }}
 */
export function lookupSemanticCache({ agentId, model, question, context = '', config }) {
  if (!config?.enabled) return { hit: false, reason: 'disabled' };
  ensureSemanticCacheStore();
  pruneExpired(config.ttlMs);
  const comparable = cacheComparableText(question, context);
  const queryVec = embedText(comparable, config.embedDim);
  const ctxH = contextHash(context);
  const since = Date.now() - config.ttlMs;
  const rows = openDb().prepare(
    `SELECT id, embedding, answer, context_hash FROM semantic_cache_entries
     WHERE agent_id = ? AND model = ? AND created_at >= ?`
  ).all(agentId, model, since);

  let best = null;
  let bestScore = 0;
  for (const row of rows) {
    if (row.context_hash !== ctxH) continue;
    let vec;
    try {
      vec = JSON.parse(row.embedding);
    } catch {
      continue;
    }
    const score = cosineSimilarity(queryVec, vec);
    if (score >= config.minScore && score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  if (!best) {
    logRoi({ hit: false, purpose: 'chat' });
    return { hit: false };
  }
  runWithSqliteBusyRetry(() => {
    openDb().prepare('UPDATE semantic_cache_entries SET last_hit_at = ? WHERE id = ?').run(Date.now(), best.id);
  });
  logRoi({ hit: true, savedChars: best.answer?.length || 0, purpose: 'chat' });
  return { hit: true, score: bestScore, answer: best.answer, entryId: best.id };
}

export function storeSemanticCacheEntry({
  agentId,
  model,
  question,
  context = '',
  answer,
  effort,
  config
}) {
  if (!config?.enabled || !answer) return;
  ensureSemanticCacheStore();
  const comparable = cacheComparableText(question, context);
  const embedding = JSON.stringify(embedText(comparable, config.embedDim));
  const ctxH = contextHash(context);
  const now = Date.now();
  runWithSqliteBusyRetry(() => {
    openDb().prepare(
      `INSERT INTO semantic_cache_entries
       (agent_id, model, question, context_hash, embedding, answer, effort, created_at, last_hit_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    ).run(
      agentId,
      model,
      String(question).slice(0, 4000),
      ctxH,
      embedding,
      String(answer).slice(0, 200_000),
      effort || null,
      now
    );
    pruneExpired(config.ttlMs);
    pruneEntries(config.maxEntries);
  });
}

export function countSemanticCacheEntries() {
  ensureSemanticCacheStore();
  return openDb().prepare('SELECT COUNT(*) AS count FROM semantic_cache_entries').get().count;
}

export function clearSemanticCache() {
  runWithSqliteBusyRetry(() => {
    openDb().prepare('DELETE FROM semantic_cache_entries').run();
  });
}
