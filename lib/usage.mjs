import { MODELS } from './router.mjs';
import { claudeSubscriptionView } from './claude-subscription-usage.mjs';
import {
  appendUsageEvent,
  listUsageEventsSince,
  listAllUsageEvents,
  countUsageEvents,
  ensureUsageEventsStore
} from './usage-events.mjs';
import { juliaTelemetrySummary } from './julia-events.mjs';

const CHARS_PER_TOKEN = 4;
export const CONTEXT_TOKEN_LIMIT = 1_000_000;

/** Contadores simples por modelo (sem tokens reais dos provedores). */
export function ensureUsage(db) {
  if (!db.usage) db.usage = { byModel: {}, updatedAt: Date.now() };
  if (!db.usage.byModel) db.usage.byModel = {};
  if (!db.usage.providers) db.usage.providers = {};
  if (db.usage.events) delete db.usage.events;
  return db.usage;
}

export function recordUsage(db, model, { charsIn = 0, charsOut = 0, routedBy } = {}) {
  if (!model || !(model in MODELS)) return;
  const u = ensureUsage(db);
  const row = u.byModel[model] || { requests: 0, charsIn: 0, charsOut: 0 };
  row.requests += 1;
  row.charsIn += charsIn;
  row.charsOut += charsOut;
  u.byModel[model] = row;
  ensureUsageEventsStore();
  appendUsageEvent({ at: Date.now(), model, charsIn, charsOut, routedBy: routedBy || null });
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

function envNumOptional(key) {
  const raw = process.env[key];
  if (raw == null || String(raw).trim() === '') return null;
  const v = +raw;
  return Number.isFinite(v) && v > 0 ? v : null;
}

function charsInWindow(events, ms) {
  const since = Date.now() - ms;
  return events.filter(e => e.at >= since).reduce((n, e) => n + (e.charsIn || 0) + (e.charsOut || 0), 0);
}

function resetAtRolling5h(events) {
  const window = 5 * 3600_000;
  const oldest = events.filter(e => e.at >= Date.now() - window).sort((a, b) => a.at - b.at)[0];
  return oldest ? oldest.at + window : null;
}

function nextWeeklyReset() {
  const d = new Date();
  const day = d.getDay();
  const daysUntilSat = (6 - day + 7) % 7 || 7;
  const next = new Date(d);
  next.setDate(d.getDate() + (day === 6 && d.getHours() >= 14 ? 7 : daysUntilSat));
  next.setHours(14, 0, 0, 0);
  if (next <= d) next.setDate(next.getDate() + 7);
  return next.getTime();
}

function fmtCountdown(ms) {
  if (ms <= 0) return 'em breve';
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  if (h >= 24) {
    const days = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];
    const t = new Date(Date.now() + ms);
    return `Reinicia ${days[t.getDay()]}, ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  }
  if (h > 0) return `Reinicia em ${h} h ${m} min`;
  return `Reinicia em ${m} min`;
}

/** Interpreta erros de provedor (rate limit / cota) para persistência local. */
export function parseProviderLimitFromError(err) {
  const msg = String(err?.message || err || '');
  const lower = msg.toLowerCase();
  const rateLimit = /rate[_\s-]?limit|429|quota|too many requests|overloaded|capacity/i.test(msg);
  if (!rateLimit) return null;
  let resetAt = null;
  const retryMatch = msg.match(/retry[- ]?(?:after|in)[:\s]+(\d+)/i);
  if (retryMatch) resetAt = Date.now() + (+retryMatch[1] * 1000);
  const isoMatch = msg.match(/reset[s]?\s+(?:at\s+)?(\d{4}-\d{2}-\d{2}[^\s]+)/i);
  if (isoMatch) {
    const t = Date.parse(isoMatch[1]);
    if (Number.isFinite(t)) resetAt = t;
  }
  return {
    kind: 'rate_limit',
    message: msg.slice(0, 500),
    resetAt,
    resetLabel: resetAt ? fmtCountdown(resetAt - Date.now()) : null
  };
}

/** Guarda o último bloqueio/cota conhecido de um provedor (Anthropic, OpenAI/Codex, etc.). */
export function recordProviderSignal(db, provider, signal) {
  if (!provider || !signal) return;
  const u = ensureUsage(db);
  u.providers[provider] = { ...signal, provider, at: Date.now() };
  u.updatedAt = Date.now();
}

function rollingQuota(events, limitChars, windowMs) {
  if (!limitChars) return null;
  const usedChars = charsInWindow(events, windowMs);
  const pct = Math.min(100, Math.round((usedChars / limitChars) * 100));
  const resetAt = usedChars > 0
    ? (windowMs === 5 * 3600_000 ? resetAtRolling5h(events) : nextWeeklyReset())
    : null;
  return {
    configured: true,
    usedChars,
    limitChars,
    pct,
    resetAt,
    resetLabel: resetAt != null ? fmtCountdown(resetAt - Date.now()) : null
  };
}

/** Limites e uso honestos: só números medidos localmente ou configurados via env. */
function usageEventsForLimits() {
  const weekMs = 7 * 86400_000;
  return listUsageEventsSince(Date.now() - weekMs);
}

export function accountLimits(db, settings = {}) {
  const u = ensureUsage(db);
  const events = usageEventsForLimits();
  const totalRecordedEvents = countUsageEvents();
  const limit5h = envNumOptional('RIPPER_LIMIT_5H_CHARS');
  const limitWeek = envNumOptional('RIPPER_LIMIT_WEEK_CHARS');
  const used5h = charsInWindow(events, 5 * 3600_000);
  const usedWeek = charsInWindow(events, 7 * 86400_000);

  const cloudTotal = envNumOptional('RIPPER_CLOUD_CREDITS_USD');
  let cloudCredits = null;
  if (cloudTotal != null) {
    const usedRaw = db.usage?.cloudCreditsUsed ?? envNumOptional('RIPPER_CLOUD_CREDITS_USED');
    const cloudUsed = usedRaw != null ? Math.min(cloudTotal, usedRaw) : null;
    const cloudRemaining = cloudUsed != null ? Math.max(0, cloudTotal - cloudUsed) : null;
    cloudCredits = {
      configured: true,
      totalUsd: cloudTotal,
      usedUsd: cloudUsed,
      remainingUsd: cloudRemaining,
      pctRemaining: cloudRemaining != null ? Math.round((cloudRemaining / cloudTotal) * 100) : null,
      expiresAt: db.usage?.cloudCreditsExpiresAt || null
    };
  }

  const providerModels = Object.keys(MODELS).filter(k => k !== 'auto');
  const totalChars = Object.values(u.byModel).reduce((n, r) => n + r.charsIn + r.charsOut, 0);
  const byModel = Object.fromEntries(providerModels.map(k => {
    const row = u.byModel[k] || { requests: 0, charsIn: 0, charsOut: 0 };
    const share = row.charsIn + row.charsOut;
    return [k, {
      label: MODELS[k].label,
      ...row,
      sharePct: totalChars ? Math.round((share / totalChars) * 100) : null
    }];
  }));

  const juliaTelemetry = juliaTelemetrySummary();
  const usageRoutedByJulia = listAllUsageEvents()
    .filter(e => e.routedBy === 'julia-1' || e.routedBy === 'heuristic').length;

  const providers = Object.entries(u.providers || {})
    .filter(([id, row]) => id !== 'claude' || row.kind !== 'subscription')
    .map(([id, row]) => ({
      id,
      ...row,
      resetLabel: row.resetAt ? fmtCountdown(row.resetAt - Date.now()) : row.resetLabel || null
    }));

  const claudeSub = claudeSubscriptionView(db, settings);
  if (claudeSub?.available && claudeSub.windows) {
    const decorate = w => w && w.pct != null ? {
      ...w,
      resetLabel: w.resetAt ? fmtCountdown(w.resetAt - Date.now()) : null
    } : null;
    claudeSub.windows = {
      fiveHour: decorate(claudeSub.windows.fiveHour),
      sevenDay: decorate(claudeSub.windows.sevenDay),
      sevenDayOpus: decorate(claudeSub.windows.sevenDayOpus)
    };
  }

  const providerBillingNote = claudeSub.mode === 'api_key'
    ? 'Claude está em modo chave de API: uso Pro/Max do Claude.ai não aparece aqui. Erros 429/rate limit do provedor continuam sendo registrados.'
    : claudeSub.available
      ? 'Uso Pro/Max vem do endpoint OAuth do Claude Code (não documentado) ou do Agent SDK — pode mudar sem aviso. Não é a API Admin de faturamento (sk-ant-admin).'
      : 'Anthropic e OpenAI não expõem API pública de fatura para todas as instalações. O Ripper mostra uso local, erros de cota e — com login Claude Code — leitura Pro/Max quando disponível.';

  return {
    source: 'ripper_local',
    live: {
      usageEvents: totalRecordedEvents > 0,
      providerBilling: claudeSub.available === true,
      providerQuotaSignals: providers.length > 0 || claudeSub.available === true,
      cloudCredits: cloudCredits?.configured === true,
      claudeSubscription: claudeSub.available === true
    },
    plan: process.env.RIPPER_PLAN_NAME || null,
    localUsage: {
      chars5h: used5h,
      chars7d: usedWeek,
      totalRecordedEvents
    },
    ripperQuota: {
      rolling5h: rollingQuota(events, limit5h, 5 * 3600_000),
      weekly: rollingQuota(events, limitWeek, 7 * 86400_000)
    },
    cloudCredits,
    byModel,
    juliaRouting: juliaTelemetry
      ? { ...juliaTelemetry, usageRoutedByJulia: usageRoutedByJulia || undefined }
      : (usageRoutedByJulia > 0 ? { usageRoutedByJulia } : null),
    providers,
    claudeSubscription: claudeSub,
    notes: {
      providerBilling: providerBillingNote,
      ripperQuota: 'Barras de cota Ripper aparecem somente se RIPPER_LIMIT_5H_CHARS e/ou RIPPER_LIMIT_WEEK_CHARS estiverem definidos no servidor.',
      claudeOAuth: 'GET api.anthropic.com/api/oauth/usage (beta oauth-2025-04-20) é usado pelo Claude Code; o Ripper só lê ~/.claude/.credentials.json em modo leitura e cacheia por alguns minutos.'
    }
  };
}

export function checkSendQuota(db) {
  const lim = accountLimits(db);
  const r5 = lim.ripperQuota?.rolling5h;
  if (r5?.configured && r5.pct >= 100) {
    return {
      blocked: true,
      kind: 'rolling5h',
      userMessage: `Cota Ripper (janela de 5 h) esgotada. ${r5.resetLabel}.`,
      resetAt: r5.resetAt
    };
  }
  const wk = lim.ripperQuota?.weekly;
  if (wk?.configured && wk.pct >= 100) {
    return {
      blocked: true,
      kind: 'weekly',
      userMessage: `Cota Ripper semanal esgotada. ${wk.resetLabel}.`,
      resetAt: wk.resetAt
    };
  }
  return { blocked: false };
}

function estTokens(chars) {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Janela de contexto: só categorias com medição real (chars no chat, prompts, conectores, etc.).
 * `measures` vem do servidor com dados calculados para o chat/agente.
 */
export function contextBreakdown(db, _settings, { chatId, measures = {} } = {}) {
  const chat = chatId && db.chats.find(c => c.id === chatId);
  const messagesChars = chat?.messages?.reduce((n, m) => n + String(m.content || '').length, 0) || 0;

  const parts = [
    { id: 'messages', label: 'Mensagens nesta conversa', color: '#4f8ff7', chars: messagesChars }
  ];

  if (measures.systemChars > 0) {
    parts.push({ id: 'system_prompt', label: 'Prompt do sistema (agente atual)', color: '#6b7280', chars: measures.systemChars });
  }
  if (measures.skillsListChars > 0) {
    parts.push({ id: 'skills', label: 'Lista de habilidades no prompt', color: '#c9a227', chars: measures.skillsListChars });
  }
  if (measures.builtinSchemaChars > 0) {
    parts.push({
      id: 'builtin_tools',
      label: `Ferramentas Ripper (${measures.builtinToolCount || 0})`,
      color: '#e07a4a',
      chars: measures.builtinSchemaChars
    });
  }
  if (measures.pluginsChars > 0 || measures.mcpPluginCount > 0) {
    parts.push({
      id: 'connectors',
      label: `Conectores MCP (${measures.mcpPluginCount || 0})`,
      color: '#5cb85c',
      chars: measures.pluginsChars || 0
    });
  }
  if (measures.groupContextChars > 0) {
    parts.push({ id: 'group', label: 'Contexto de time (grupo)', color: '#9b59b6', chars: measures.groupContextChars });
  }

  const measuredChars = parts.reduce((n, p) => n + p.chars, 0);
  const limit = CONTEXT_TOKEN_LIMIT;
  const usedTokens = estTokens(measuredChars);
  const pct = measuredChars > 0 ? Math.min(100, Math.round((usedTokens / limit) * 100)) : null;

  const categories = parts.map(p => ({
    id: p.id,
    label: p.label,
    color: p.color,
    tokens: estTokens(p.chars),
    pct: measuredChars > 0 ? +((estTokens(p.chars) / limit) * 100).toFixed(1) : 0
  }));

  return {
    limitTokens: limit,
    usedTokens: measuredChars > 0 ? usedTokens : null,
    pct,
    hasData: measuredChars > 0,
    categories,
    compact: {
      messageCount: chat?.messages?.length || 0,
      canCompact: (chat?.messages?.length || 0) > 24
    },
    estimate: true,
    note: 'Estimativa local (~4 caracteres/token) sobre o que o Ripper mede nesta conversa; não é a contagem do provedor.'
  };
}

/** Compactação: trunca mensagens antigas do chat (ação real, limitada). */
export function compactChat(db, chatId, { keepLast = 24 } = {}) {
  const chat = db.chats.find(c => c.id === chatId);
  if (!chat?.messages?.length) return { ok: false, reason: 'no_chat' };
  const before = chat.messages.length;
  if (before <= keepLast) return { ok: true, removed: 0, kept: before };
  chat.messages = chat.messages.slice(-keepLast);
  return { ok: true, removed: before - keepLast, kept: keepLast };
}
