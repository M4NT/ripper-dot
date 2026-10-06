// Relatório de uso por período (Admin Uso): agrega usage-events por dia, agente ou modelo.
// usage.sqlite guarda caracteres → tokens (~4 car./token) estimados. Custo: real (US$ cobrado no turno pago, cost_usd)
// quando existe, senão estimado pelo catálogo; costEstimated = true se algum evento da linha foi estimado.
import { rawTokenCost } from './julia-cascade.mjs';

export const USAGE_GROUPS = ['day', 'agent', 'model', 'client'];

/** Cliente de uma conversa: tag igual a client.tag (sem diferenciar maiúsculas) ou projectId em client.projectIds. */
export function resolveClient(clients, chat) {
  if (!chat || !clients?.length) return null;
  const tags = new Set((chat.tags || []).map(t => String(t).toLowerCase()));
  return clients.find(c => c.tag && tags.has(c.tag.toLowerCase()))
    || clients.find(c => chat.projectId && c.projectIds?.includes(chat.projectId)) || null;
}

/** Valida o corpo de cliente vindo da API. CNPJ (14) ou CPF (11) opcional, guardado só com dígitos. */
export function normalizeClient(b = {}) {
  const name = String(b.name || '').trim().slice(0, 120);
  if (!name) throw new Error('Informe o nome do cliente.');
  const document = String(b.document || '').replace(/\D/g, '');
  if (document && document.length !== 11 && document.length !== 14) throw new Error('CNPJ deve ter 14 dígitos (ou CPF 11).');
  const fee = Number(b.monthlyFeeBrl);
  return {
    name, document,
    tag: String(b.tag || '').trim().slice(0, 60),
    projectIds: Array.isArray(b.projectIds) ? b.projectIds.map(String).slice(0, 50) : [],
    monthlyFeeBrl: Number.isFinite(fee) && fee > 0 ? fee : 0
  };
}
const DAY = 86400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Valida from/to (YYYY-MM-DD, UTC, inclusivo) e group. → { since, until, group } ou lança Error com mensagem PT. */
export function parseUsageQuery({ from, to, group = 'day' } = {}) {
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) throw new Error('Informe from e to no formato AAAA-MM-DD.');
  const since = Date.parse(`${from}T00:00:00Z`), start = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(since) || !Number.isFinite(start)) throw new Error('Data inválida.');
  if (start < since) throw new Error('A data final é anterior à inicial.');
  if ((start - since) / DAY + 1 > 366) throw new Error('Período máximo: 366 dias.');
  if (!USAGE_GROUPS.includes(group)) throw new Error('group deve ser day, agent, model ou client.');
  return { since, until: start + DAY - 1, group };
}

const dayKey = at => new Date(at).toISOString().slice(0, 10);

/** Agrega eventos dentro de [since, until]. Dias sem uso aparecem zerados em group=day. */
export function aggregateUsage(events, { since, until, group }, catalog = null, { clients = [], chats = [] } = {}) {
  const chatById = new Map(chats.map(c => [c.id, c]));
  const known = new Set(clients.map(c => c.id));
  // clientId gravado no evento vale; senão (ou se o cliente foi excluído) resolve pela conversa; sem chatId → '' (Sem cliente).
  const clientOf = e => (known.has(e.clientId) && e.clientId) || resolveClient(clients, chatById.get(e.chatId))?.id || '';
  const keyOf = { day: e => dayKey(e.at), agent: e => e.agentId || '(sem agente)', model: e => e.model, client: clientOf }[group];
  const map = new Map();
  if (group === 'day') for (let t = since; t <= until; t += DAY) map.set(dayKey(t), null);
  for (const e of events) {
    if (e.at < since || e.at > until) continue;
    const key = keyOf(e);
    const r = map.get(key) || { key, requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, costEstimated: false };
    const tin = Math.ceil((e.charsIn || 0) / 4), tout = Math.ceil((e.charsOut || 0) / 4);
    r.requests += 1; r.tokensIn += tin; r.tokensOut += tout;
    if (e.costUsd > 0) r.costUsd += e.costUsd;
    else { r.costUsd += rawTokenCost(catalog?.models?.[e.model] || {}, tin, tout) || 0; r.costEstimated = true; }
    map.set(key, r);
  }
  const rows = [...map].map(([key, r]) => r || { key, requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, costEstimated: true });
  if (group !== 'day') rows.sort((a, b) => b.requests - a.requests);
  const totals = rows.reduce((t, r) => ({ requests: t.requests + r.requests, tokensIn: t.tokensIn + r.tokensIn, tokensOut: t.tokensOut + r.tokensOut, costUsd: t.costUsd + r.costUsd, costEstimated: t.costEstimated || r.costEstimated }),
    { requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, costEstimated: false });
  return { rows, totals };
}

const csvCell = v => { const s = v == null ? '' : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function usageCsv({ rows, totals }, group, label = k => k) {
  const head = [{ day: 'dia', agent: 'agente', model: 'modelo', client: 'cliente' }[group], 'respostas', 'tokens entrada (est.)', 'tokens saída (est.)', 'custo US$', 'custo é estimado'];
  const line = (k, r) => [k, r.requests, r.tokensIn, r.tokensOut, r.costUsd.toFixed(4), r.costEstimated ? 'sim' : 'não'];
  const body = [head, ...rows.map(r => line(label(r.key), r)), line('Total', totals)];
  return '﻿' + body.map(r => r.map(csvCell).join(';')).join('\r\n');
}

/** Mês corrente (UTC) até agora + previsão linear de fim de mês. */
export function monthForecast(events, now = Date.now(), catalog = null) {
  const d = new Date(now), y = d.getUTCFullYear(), mo = d.getUTCMonth();
  const since = Date.UTC(y, mo, 1), daysInMonth = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const { totals } = aggregateUsage(events, { since, until: now, group: 'model' }, catalog);
  const daysElapsed = Math.max(1, (now - since) / DAY); // piso de 1 dia: evita previsão explosiva nas primeiras horas do mês
  return {
    month: `${y}-${String(mo + 1).padStart(2, '0')}`, costUsd: totals.costUsd, costEstimated: totals.costEstimated,
    forecastUsd: totals.costUsd / daysElapsed * daysInMonth, daysElapsed: Math.min(daysElapsed, daysInMonth), daysInMonth
  };
}

export const DEFAULT_USD_BRL = 5.5;
let rateCache = null; // { day, rate }

/** Cotação US$→R$: valor fixo das configurações (billing.usdBrl) vence; senão AwesomeAPI 1x/dia; se falhar, o padrão. */
export async function usdBrlRate(settings, { fetchImpl = fetch, now = Date.now() } = {}) {
  const fixed = +settings?.billing?.usdBrl;
  if (fixed > 0) return { rate: fixed, source: 'manual' };
  const day = new Date(now).toISOString().slice(0, 10);
  if (rateCache?.day === day) return { rate: rateCache.rate, source: 'awesomeapi' };
  try {
    const r = await fetchImpl('https://economia.awesomeapi.com.br/json/last/USD-BRL', { signal: AbortSignal.timeout(3000) });
    const rate = +(await r.json())?.USDBRL?.bid;
    if (r.ok && rate > 0) { rateCache = { day, rate }; return { rate, source: 'awesomeapi' }; }
  } catch {}
  return { rate: DEFAULT_USD_BRL, source: 'padrão' };
}
export const _resetRateCache = () => { rateCache = null; };
