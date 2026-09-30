import { MODELS } from './router.mjs';

/** Contadores simples por modelo (sem tokens reais dos provedores). */
export function ensureUsage(db) {
  if (!db.usage) db.usage = { byModel: {}, updatedAt: Date.now() };
  if (!db.usage.byModel) db.usage.byModel = {};
  return db.usage;
}

export function recordUsage(db, model, { charsIn = 0, charsOut = 0 } = {}) {
  if (!model || !(model in MODELS)) return;
  const u = ensureUsage(db);
  const row = u.byModel[model] || { requests: 0, charsIn: 0, charsOut: 0 };
  row.requests += 1;
  row.charsIn += charsIn;
  row.charsOut += charsOut;
  u.byModel[model] = row;
  u.updatedAt = Date.now();
}

export function usageSummary(db) {
  const u = ensureUsage(db);
  return {
    updatedAt: u.updatedAt,
    byModel: Object.fromEntries(
      Object.entries(u.byModel).map(([k, v]) => [k, { ...v, label: MODELS[k]?.label || k }])
    )
  };
}
