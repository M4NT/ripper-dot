// Resumo de hoje por agente (card do agente): respostas, tokens e custo estimados, tempo médio.
import { loadBenchmarkCatalog, rawTokenCost } from './julia-cascade.mjs';

/** events: usage-events desde a meia-noite; chats: db.chats. → { [agentId]: { turns, tokens, usd, avgMs } } */
export function agentDayStats(events, chats, since, catalog = safeCatalog()) {
  const out = {};
  const row = id => (out[id] ||= { turns: 0, tokens: 0, usd: 0, ms: 0, timed: 0 });
  for (const e of events) {
    if (!e.agentId) continue;
    const r = row(e.agentId);
    const tin = Math.ceil(e.charsIn / 4), tout = Math.ceil(e.charsOut / 4); // ~4 caracteres por token
    r.turns += 1; r.tokens += tin + tout;
    r.usd += rawTokenCost(catalog?.models?.[e.model] || {}, tin, tout) || 0;
  }
  for (const c of chats) for (const m of c.messages || []) {
    if (m.role !== 'assistant' || !m.agentId || !(m.at >= since) || m.timing?.totalMs == null) continue;
    const r = row(m.agentId); r.ms += m.timing.totalMs; r.timed += 1;
  }
  return Object.fromEntries(Object.entries(out).map(([id, r]) => [id, { turns: r.turns, tokens: r.tokens, usd: r.usd, avgMs: r.timed ? Math.round(r.ms / r.timed) : null }]));
}

function safeCatalog() { try { return loadBenchmarkCatalog(); } catch { return null; } }
