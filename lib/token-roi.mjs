/**
 * Token ROI — telemetria real da economia Julia (sem US$, créditos ou % de economia inventados).
 * Fontes: usage.sqlite (eventos), julia.sqlite (julia_decisions, cascade_decisions,
 * julia_cascade_decisions e semantic_cache_hits se existirem).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { dataUrl } from './store.mjs';
import { listAllUsageEvents } from './usage-events.mjs';
import { juliaTelemetrySummary } from './julia-events.mjs';

export const TOKEN_ROI_CONTRACT_VERSION = 1;
const CHARS_PER_TOKEN = 4;
const CASCADE_RECENT_LIMIT = 25;

const ROI_NOTE = 'Sem estimativa de economia em US$ ou percentual de economia — apenas contagens e caracteres medidos nesta instalação.';

let _juliaDb;
let _juliaDirKey;

function juliaSqlitePath() {
  return fileURLToPath(dataUrl('julia.sqlite'));
}

function juliaDirKey() {
  return fileURLToPath(dataUrl(''));
}

function openJuliaDbReadonly() {
  const key = juliaDirKey();
  if (_juliaDb && _juliaDirKey === key) return _juliaDb;
  if (_juliaDb) {
    try { _juliaDb.close(); } catch {}
  }
  const path = juliaSqlitePath();
  if (!existsSync(path)) return null;
  mkdirSync(fileURLToPath(dataUrl('')), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000;');
  _juliaDb = db;
  _juliaDirKey = key;
  return _juliaDb;
}

/** Só para testes. */
export function _resetTokenRoiForTests() {
  if (_juliaDb) {
    try { _juliaDb.close(); } catch {}
  }
  _juliaDb = undefined;
  _juliaDirKey = undefined;
}

function tableExists(db, name) {
  const row = db.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(name);
  return Boolean(row?.ok);
}

function tableColumns(db, name) {
  return db.prepare(`PRAGMA table_info(${name})`).all().map(c => c.name);
}

function hasCols(columns, required) {
  return required.every(c => columns.includes(c));
}

function estTokensFromChars(chars) {
  if (chars == null || chars <= 0) return null;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function summarizeUsageEvents() {
  const events = listAllUsageEvents();
  if (!events.length) return null;

  let charsIn = 0;
  let charsOut = 0;
  let routedByJulia = 0;
  let routedByHeuristic = 0;

  for (const e of events) {
    charsIn += e.charsIn || 0;
    charsOut += e.charsOut || 0;
    if (e.routedBy === 'julia-1') routedByJulia++;
    else if (e.routedBy === 'heuristic') routedByHeuristic++;
  }

  const totalChars = charsIn + charsOut;
  return {
    events: events.length,
    charsIn,
    charsOut,
    totalChars,
    estTokens: estTokensFromChars(totalChars),
    routedByJulia,
    routedByHeuristic
  };
}

/**
 * Agrega cascade_decisions quando a tabela existe (escrita por runtime Julia futuro).
 * Colunas opcionais: decision, ok, reason, saved_chars, tier_from, tier_to.
 */
function summarizeCascadeDecisions(db) {
  if (!tableExists(db, 'cascade_decisions')) {
    return { present: false };
  }
  const cols = tableColumns(db, 'cascade_decisions');
  if (!cols.includes('at')) {
    return { present: true, emptyLabel: 'sem dados', note: 'Tabela cascade_decisions sem coluna at.' };
  }

  const { count } = db.prepare('SELECT COUNT(*) AS count FROM cascade_decisions').get();
  if (!count) {
    return { present: true, emptyLabel: 'sem dados', total: 0 };
  }

  const byDecision = {};
  const byReason = {};
  let savedCharsSum = null;
  let savedCharsEvents = 0;

  if (cols.includes('decision')) {
    for (const row of db.prepare(
      'SELECT decision, COUNT(*) AS n FROM cascade_decisions GROUP BY decision'
    ).all()) {
      const key = row.decision || 'unknown';
      byDecision[key] = row.n;
    }
  }

  if (cols.includes('reason')) {
    for (const row of db.prepare(
      'SELECT reason, COUNT(*) AS n FROM cascade_decisions WHERE reason IS NOT NULL GROUP BY reason'
    ).all()) {
      byReason[row.reason || 'unknown'] = row.n;
    }
  }

  if (cols.includes('saved_chars')) {
    const agg = db.prepare(
      'SELECT COALESCE(SUM(saved_chars), 0) AS sum, COUNT(*) AS n FROM cascade_decisions WHERE saved_chars IS NOT NULL AND saved_chars > 0'
    ).get();
    if (agg.n > 0) {
      savedCharsSum = agg.sum;
      savedCharsEvents = agg.n;
    }
  }

  let okCount = null;
  let failCount = null;
  if (cols.includes('ok')) {
    okCount = db.prepare('SELECT COUNT(*) AS n FROM cascade_decisions WHERE ok = 1').get().n;
    failCount = count - okCount;
  }

  const selectCols = ['at'];
  for (const c of ['decision', 'ok', 'reason', 'saved_chars', 'tier_from', 'tier_to']) {
    if (cols.includes(c)) selectCols.push(c);
  }
  const orderBy = cols.includes('id') ? 'at DESC, id DESC' : 'at DESC';
  const recent = db.prepare(
    `SELECT ${selectCols.join(', ')} FROM cascade_decisions ORDER BY ${orderBy} LIMIT ?`
  ).all(CASCADE_RECENT_LIMIT).map(row => ({
    at: row.at,
    decision: row.decision ?? null,
    ok: row.ok != null ? row.ok === 1 : null,
    reason: row.reason ?? null,
    savedChars: row.saved_chars ?? null,
    tierFrom: row.tier_from ?? null,
    tierTo: row.tier_to ?? null
  }));

  const out = {
    present: true,
    total: count,
    recent
  };
  if (Object.keys(byDecision).length) out.byDecision = byDecision;
  if (Object.keys(byReason).length) out.byReason = byReason;
  if (okCount != null) {
    out.ok = okCount;
    out.failures = failCount;
  }
  if (savedCharsSum != null) {
    out.savedChars = { sum: savedCharsSum, eventsWithMeasurement: savedCharsEvents };
    out.estTokensSaved = estTokensFromChars(savedCharsSum);
  }
  return out;
}

/**
 * Agrega semantic_cache_hits quando a tabela existe.
 * Colunas esperadas: at, hit (0/1), saved_chars opcional, purpose opcional.
 */
function summarizeSemanticCache(db) {
  if (!tableExists(db, 'semantic_cache_hits')) {
    return { present: false };
  }
  const cols = tableColumns(db, 'semantic_cache_hits');
  if (!hasCols(cols, ['at', 'hit'])) {
    return { present: true, emptyLabel: 'sem dados', note: 'Tabela semantic_cache_hits incompleta (requer at, hit).' };
  }

  const { count } = db.prepare('SELECT COUNT(*) AS count FROM semantic_cache_hits').get();
  if (!count) {
    return { present: true, emptyLabel: 'sem dados', total: 0, hits: 0, misses: 0 };
  }

  const hits = db.prepare('SELECT COUNT(*) AS n FROM semantic_cache_hits WHERE hit = 1').get().n;
  const misses = count - hits;

  const out = {
    present: true,
    total: count,
    hits,
    misses
  };

  if (cols.includes('saved_chars')) {
    const agg = db.prepare(
      'SELECT COALESCE(SUM(saved_chars), 0) AS sum, COUNT(*) AS n FROM semantic_cache_hits WHERE hit = 1 AND saved_chars IS NOT NULL AND saved_chars > 0'
    ).get();
    if (agg.n > 0) {
      out.savedChars = { sum: agg.sum, eventsWithMeasurement: agg.n };
      out.estTokensSaved = estTokensFromChars(agg.sum);
    }
  }

  if (cols.includes('purpose')) {
    const byPurpose = {};
    for (const row of db.prepare(
      'SELECT purpose, COUNT(*) AS n FROM semantic_cache_hits WHERE hit = 1 GROUP BY purpose'
    ).all()) {
      byPurpose[row.purpose || 'unknown'] = row.n;
    }
    if (Object.keys(byPurpose).length) out.hitsByPurpose = byPurpose;
  }

  return out;
}

/** Decisões CPS (PR 56) — sem expor US$ na UI; só contagens e modelo/categoria. */
function summarizeJuliaCpsCascadeDecisions(db) {
  if (!tableExists(db, 'julia_cascade_decisions')) {
    return { present: false };
  }
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM julia_cascade_decisions').get();
  if (!count) {
    return { present: false };
  }

  const byReason = {};
  for (const row of db.prepare(
    'SELECT reason, COUNT(*) AS n FROM julia_cascade_decisions WHERE reason IS NOT NULL GROUP BY reason'
  ).all()) {
    byReason[row.reason || 'unknown'] = row.n;
  }

  const recent = db.prepare(
    `SELECT at, model_id, task_category, reason
     FROM julia_cascade_decisions
     ORDER BY at DESC, id DESC
     LIMIT ?`
  ).all(CASCADE_RECENT_LIMIT).map(row => ({
    at: row.at,
    decision: row.model_id
      ? `${row.model_id}${row.task_category ? ` · ${row.task_category}` : ''}`
      : (row.task_category || null),
    reason: row.reason ?? null,
    savedChars: null
  }));

  const out = {
    present: true,
    total: count,
    recent,
    source: 'julia_cascade_decisions'
  };
  if (Object.keys(byReason).length) out.byReason = byReason;
  return out;
}

function juliaDecisionsSlice() {
  const summary = juliaTelemetrySummary();
  if (!summary) return null;
  const out = { ...summary };
  delete out.usdAvoidedEst;
  delete out.savingsPct;
  return out;
}

/** Contrato para GET /api/usage/token-roi e painel na UI de uso. */
export function buildTokenRoiContract() {
  const usageEvents = summarizeUsageEvents();
  const juliaDecisions = juliaDecisionsSlice();

  let cascade = { present: false };
  let semanticCache = { present: false };
  const juliaDb = openJuliaDbReadonly();
  if (juliaDb) {
    cascade = summarizeCascadeDecisions(juliaDb);
    if (!cascade.present || !cascade.total) {
      const cps = summarizeJuliaCpsCascadeDecisions(juliaDb);
      if (cps.present) cascade = cps;
    }
    semanticCache = summarizeSemanticCache(juliaDb);
  }

  const hasUsage = Boolean(usageEvents?.events);
  const hasJulia = Boolean(juliaDecisions?.decisions);
  const hasCascade = cascade.present && cascade.total > 0;
  const hasCache = semanticCache.present && (semanticCache.total > 0 || semanticCache.hits > 0);
  const available = hasUsage || hasJulia || hasCascade || hasCache;

  const contract = {
    contractVersion: TOKEN_ROI_CONTRACT_VERSION,
    available,
    emptyLabel: available ? null : 'sem dados',
    note: ROI_NOTE,
    usageEvents,
    juliaDecisions,
    cascade,
    semanticCache
  };

  for (const key of ['usdAvoided', 'usdSaved', 'creditsSaved', 'savingsPct', 'roiPct', 'moneySavedUsd']) {
    if (key in contract) delete contract[key];
  }

  return contract;
}
