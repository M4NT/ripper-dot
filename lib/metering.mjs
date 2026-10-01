/**
 * Medição operacional: agregados factuais de usage.sqlite (sem $ inventado).
 */
import { MODELS } from './router.mjs';
import {
  USAGE_EVENTS_MAX,
  countUsageEvents,
  listAllUsageEvents,
  listUsageEventsSince
} from './usage-events.mjs';
import { claudeSubscriptionView } from './claude-subscription-usage.mjs';

export const METERING_CONTRACT_VERSION = 1;

function dayKeyUtc(at) {
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function aggregateRows(events, keyFn) {
  const map = new Map();
  for (const e of events) {
    const key = keyFn(e);
    const row = map.get(key) || { key, events: 0, charsIn: 0, charsOut: 0 };
    row.events += 1;
    row.charsIn += e.charsIn || 0;
    row.charsOut += e.charsOut || 0;
    map.set(key, row);
  }
  return [...map.values()].map(r => ({
    ...r,
    charsTotal: r.charsIn + r.charsOut
  }));
}

function providerUsageSnapshot(db, settings) {
  const claude = claudeSubscriptionView(db, settings);
  if (!claude?.available || !claude.windows) {
    return {
      available: false,
      claudeSubscription: claude?.hint || claude?.error
        ? { mode: claude.mode, hint: claude.hint ?? null, error: claude.error ?? null }
        : null,
      emptyLabel: 'sem dados'
    };
  }
  return {
    available: true,
    claudeSubscription: {
      mode: claude.mode,
      source: claude.source ?? null,
      subscriptionType: claude.subscriptionType ?? null,
      fetchedAt: claude.fetchedAt ?? null,
      windows: claude.windows,
      fragile: claude.fragile === true
    },
    emptyLabel: null
  };
}

/**
 * @param {{ since?: number, until?: number }} opts — janela em ms (inclusiva em `at`)
 */
export function buildMeteringReport(db, settings = {}, opts = {}) {
  const now = Date.now();
  const since = opts.since ?? now - 30 * 86400_000;
  const until = opts.until ?? now;
  const allCount = countUsageEvents();
  const events = listUsageEventsSince(since).filter(e => e.at <= until);

  const totals = events.length
    ? events.reduce(
      (t, e) => {
        t.events += 1;
        t.charsIn += e.charsIn || 0;
        t.charsOut += e.charsOut || 0;
        return t;
      },
      { events: 0, charsIn: 0, charsOut: 0 }
    )
    : null;
  if (totals) totals.charsTotal = totals.charsIn + totals.charsOut;

  const byDay = aggregateRows(events, e => dayKeyUtc(e.at))
    .map(r => ({ day: r.key, events: r.events, charsIn: r.charsIn, charsOut: r.charsOut, charsTotal: r.charsTotal }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const byModel = aggregateRows(events, e => e.model)
    .map(r => ({
      model: r.key,
      label: MODELS[r.key]?.label || r.key,
      events: r.events,
      charsIn: r.charsIn,
      charsOut: r.charsOut,
      charsTotal: r.charsTotal
    }))
    .sort((a, b) => b.charsTotal - a.charsTotal);

  const byAgent = aggregateRows(events, e => e.routedBy || null)
    .map(r => ({
      routedBy: r.key,
      label: r.key == null ? 'sem roteador' : r.key,
      events: r.events,
      charsIn: r.charsIn,
      charsOut: r.charsOut,
      charsTotal: r.charsTotal
    }))
    .sort((a, b) => b.charsTotal - a.charsTotal);

  const hasData = events.length > 0;

  return {
    contractVersion: METERING_CONTRACT_VERSION,
    generatedAt: now,
    window: { since, until },
    retention: { maxEvents: USAGE_EVENTS_MAX, storedEvents: allCount },
    hasData,
    emptyLabel: hasData ? null : 'sem dados',
    totals,
    tokens: null,
    byDay,
    byModel,
    byAgent,
    providerUsage: providerUsageSnapshot(db, settings),
    notes: {
      tokens: 'Contagens de tokens do provedor não são gravadas em usage.sqlite; só caracteres medidos localmente.',
      byAgent: 'Dimensão "agente" reflete routedBy (Julia/heurística) quando o Ripper Auto escolhe o modelo.',
      billing: 'Sem valores em dólar ou créditos simulados — ver Token ROI separadamente.'
    }
  };
}

/** Eventos brutos na janela (para CSV). */
export function listMeteringEvents(opts = {}) {
  const now = Date.now();
  const since = opts.since ?? now - 30 * 86400_000;
  const until = opts.until ?? now;
  return listAllUsageEvents().filter(e => e.at >= since && e.at <= until);
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function usageEventsToCsv(events) {
  const header = 'at_iso,at_ms,model,chars_in,chars_out,routed_by';
  const lines = events.map(e => [
    new Date(e.at).toISOString(),
    e.at,
    e.model,
    e.charsIn ?? 0,
    e.charsOut ?? 0,
    e.routedBy ?? ''
  ].map(csvEscape).join(','));
  return [header, ...lines].join('\n') + (lines.length ? '\n' : '');
}
