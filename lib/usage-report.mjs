// Relatório de uso por período (Admin Uso): agrega usage-events por dia, agente ou modelo.
// usage.sqlite só guarda caracteres → tokens (~4 car./token) e custo são sempre estimados (costEstimated: true).
import { rawTokenCost } from './julia-cascade.mjs';

export const USAGE_GROUPS = ['day', 'agent', 'model'];
const DAY = 86400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Valida from/to (YYYY-MM-DD, UTC, inclusivo) e group. → { since, until, group } ou lança Error com mensagem PT. */
export function parseUsageQuery({ from, to, group = 'day' } = {}) {
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) throw new Error('Informe from e to no formato AAAA-MM-DD.');
  const since = Date.parse(`${from}T00:00:00Z`), start = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(since) || !Number.isFinite(start)) throw new Error('Data inválida.');
  if (start < since) throw new Error('A data final é anterior à inicial.');
  if ((start - since) / DAY + 1 > 366) throw new Error('Período máximo: 366 dias.');
  if (!USAGE_GROUPS.includes(group)) throw new Error('group deve ser day, agent ou model.');
  return { since, until: start + DAY - 1, group };
}

const dayKey = at => new Date(at).toISOString().slice(0, 10);

/** Agrega eventos dentro de [since, until]. Dias sem uso aparecem zerados em group=day. */
export function aggregateUsage(events, { since, until, group }, catalog = null) {
  const keyOf = { day: e => dayKey(e.at), agent: e => e.agentId || '(sem agente)', model: e => e.model }[group];
  const map = new Map();
  if (group === 'day') for (let t = since; t <= until; t += DAY) map.set(dayKey(t), null);
  for (const e of events) {
    if (e.at < since || e.at > until) continue;
    const key = keyOf(e);
    const r = map.get(key) || { key, requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, costEstimated: true };
    const tin = Math.ceil((e.charsIn || 0) / 4), tout = Math.ceil((e.charsOut || 0) / 4);
    r.requests += 1; r.tokensIn += tin; r.tokensOut += tout;
    r.costUsd += rawTokenCost(catalog?.models?.[e.model] || {}, tin, tout) || 0;
    map.set(key, r);
  }
  const rows = [...map].map(([key, r]) => r || { key, requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, costEstimated: true });
  if (group !== 'day') rows.sort((a, b) => b.requests - a.requests);
  const totals = rows.reduce((t, r) => ({ requests: t.requests + r.requests, tokensIn: t.tokensIn + r.tokensIn, tokensOut: t.tokensOut + r.tokensOut, costUsd: t.costUsd + r.costUsd, costEstimated: true }),
    { requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, costEstimated: true });
  return { rows, totals };
}

const csvCell = v => { const s = v == null ? '' : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function usageCsv({ rows, totals }, group, label = k => k) {
  const head = [{ day: 'dia', agent: 'agente', model: 'modelo' }[group], 'respostas', 'tokens entrada (est.)', 'tokens saída (est.)', 'custo US$ (est.)'];
  const line = (k, r) => [k, r.requests, r.tokensIn, r.tokensOut, r.costUsd.toFixed(4)];
  const body = [head, ...rows.map(r => line(label(r.key), r)), line('Total', totals)];
  return '﻿' + body.map(r => r.map(csvCell).join(';')).join('\r\n');
}
