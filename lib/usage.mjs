import { MODELS } from './router.mjs';

const CHARS_PER_TOKEN = 4;
export const CONTEXT_TOKEN_LIMIT = 1_000_000;

/** Contadores simples por modelo (sem tokens reais dos provedores). */
export function ensureUsage(db) {
  if (!db.usage) db.usage = { byModel: {}, events: [], updatedAt: Date.now() };
  if (!db.usage.byModel) db.usage.byModel = {};
  if (!db.usage.events) db.usage.events = [];
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
  u.events.push({ at: Date.now(), model, charsIn, charsOut, routedBy: routedBy || null });
  if (u.events.length > 800) u.events.splice(0, u.events.length - 800);
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

function envNum(key, fallback) {
  const v = +process.env[key];
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function charsInWindow(events, ms) {
  const since = Date.now() - ms;
  return events.filter(e => e.at >= since).reduce((n, e) => n + (e.charsIn || 0) + (e.charsOut || 0), 0);
}

function resetAtRolling5h(events) {
  const window = 5 * 3600_000;
  const oldest = events.filter(e => e.at >= Date.now() - window).sort((a, b) => a.at - b.at)[0];
  return oldest ? oldest.at + window : Date.now() + window;
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

/** Limites agregados da conta (local + env). Sem API de fatura dos provedores. */
export function accountLimits(db, settings = {}) {
  const u = ensureUsage(db);
  const events = u.events || [];
  const limit5h = envNum('RIPPER_LIMIT_5H_CHARS', 400_000);
  const limitWeek = envNum('RIPPER_LIMIT_WEEK_CHARS', 2_000_000);
  const used5h = charsInWindow(events, 5 * 3600_000);
  const usedWeek = charsInWindow(events, 7 * 86400_000);
  const pct5h = Math.min(100, Math.round((used5h / limit5h) * 100));
  const pctWeek = Math.min(100, Math.round((usedWeek / limitWeek) * 100));

  const cloudTotal = envNum('RIPPER_CLOUD_CREDITS_USD', 100);
  const cloudUsed = Math.min(cloudTotal, +(db.usage?.cloudCreditsUsed ?? process.env.RIPPER_CLOUD_CREDITS_USED ?? 1));
  const cloudRemaining = Math.max(0, cloudTotal - cloudUsed);

  const plan = process.env.RIPPER_PLAN_NAME || 'Pro';
  const providerModels = Object.keys(MODELS).filter(k => k !== 'auto');
  const byModelPct = Object.fromEntries(providerModels.map(k => {
    const row = u.byModel[k];
    const share = row ? (row.charsIn + row.charsOut) : 0;
    const total = Object.values(u.byModel).reduce((n, r) => n + r.charsIn + r.charsOut, 0) || 1;
    return [k, { label: MODELS[k].label, sharePct: Math.round((share / total) * 100), ...row }];
  }));

  const juliaEvents = events.filter(e => e.routedBy === 'julia-1' || e.routedBy === 'heuristic');
  const juliaChars = juliaEvents.reduce((n, e) => n + e.charsIn + e.charsOut, 0);
  const opusAvoided = Math.round(juliaChars * 0.35);
  const tokenEst = Math.round(opusAvoided / CHARS_PER_TOKEN);
  const usdEst = +(tokenEst * 0.000015).toFixed(2);

  return {
    source: 'local_aggregate',
    live: {
      usageEvents: true,
      providerBilling: false,
      cloudCredits: !!process.env.RIPPER_CLOUD_CREDITS_USD
    },
    plan,
    rolling5h: {
      usedChars: used5h,
      limitChars: limit5h,
      pct: pct5h,
      resetAt: resetAtRolling5h(events),
      resetLabel: fmtCountdown(resetAtRolling5h(events) - Date.now())
    },
    weekly: {
      usedChars: usedWeek,
      limitChars: limitWeek,
      pct: pctWeek,
      resetAt: nextWeeklyReset(),
      resetLabel: fmtCountdown(nextWeeklyReset() - Date.now())
    },
    cloudCredits: {
      totalUsd: cloudTotal,
      remainingUsd: cloudRemaining,
      pctRemaining: Math.round((cloudRemaining / cloudTotal) * 100),
      expiresAt: db.usage?.cloudCreditsExpiresAt || null
    },
    byModel: byModelPct,
    juliaSavings: {
      estimate: true,
      routedRequests: juliaEvents.length,
      tokensAvoidedEst: tokenEst,
      usdAvoidedEst: usdEst,
      juliaOnline: settings.julia?.url ? true : null,
      note: 'Estimativa com base em rotas Julia/heurística vs. modelo frontier; não é fatura real.'
    }
  };
}

export function checkSendQuota(db) {
  const lim = accountLimits(db);
  if (lim.rolling5h.pct >= 100) {
    return {
      blocked: true,
      kind: 'rolling5h',
      userMessage: `Cota esgotada (limite de 5 horas). ${lim.rolling5h.resetLabel}.`,
      resetAt: lim.rolling5h.resetAt
    };
  }
  if (lim.weekly.pct >= 100) {
    return {
      blocked: true,
      kind: 'weekly',
      userMessage: `Cota semanal esgotada. ${lim.weekly.resetLabel}.`,
      resetAt: lim.weekly.resetAt
    };
  }
  return { blocked: false };
}

function estTokens(chars) {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** Detalhe da janela de contexto (estimativa por categorias). */
export function contextBreakdown(db, settings, { chatId, mcpToolCount = 0, skillCount = 0 } = {}) {
  const chat = chatId && db.chats.find(c => c.id === chatId);
  const messagesChars = chat?.messages?.reduce((n, m) => n + String(m.content || '').length, 0) || 0;
  const systemTools = 17_500;
  const mcpTools = Math.max(11_700, mcpToolCount * 420);
  const skills = Math.max(10_000, skillCount * 900);
  const systemPrompt = 4_000;
  const mcpInstructions = 472;
  const customAgents = Math.min(320, (db.agents?.length || 0) * 40);
  const autocompactBuffer = 33_000;
  const used = messagesChars + systemTools + mcpTools + skills + systemPrompt + mcpInstructions + customAgents + autocompactBuffer;
  const limit = CONTEXT_TOKEN_LIMIT;
  const usedTokens = estTokens(used);
  const pct = Math.min(100, Math.round((usedTokens / limit) * 100));
  const free = Math.max(0, limit - usedTokens);
  const untilCompact = Math.max(0, autocompactBuffer - estTokens(messagesChars % autocompactBuffer));

  const categories = [
    { id: 'messages', label: 'Mensagens', color: '#4f8ff7', tokens: estTokens(messagesChars), pct: +((estTokens(messagesChars) / limit) * 100).toFixed(1) },
    { id: 'system_tools', label: 'Ferramentas do sistema', color: '#e07a4a', tokens: estTokens(systemTools), pct: +((estTokens(systemTools) / limit) * 100).toFixed(1) },
    { id: 'mcp_tools', label: 'Ferramentas MCP', color: '#5cb85c', tokens: estTokens(mcpTools), pct: +((estTokens(mcpTools) / limit) * 100).toFixed(1) },
    { id: 'skills', label: 'Habilidades', color: '#c9a227', tokens: estTokens(skills), pct: +((estTokens(skills) / limit) * 100).toFixed(1) },
    { id: 'system_prompt', label: 'Prompt do sistema', color: '#6b7280', tokens: estTokens(systemPrompt), pct: +((estTokens(systemPrompt) / limit) * 100).toFixed(1) },
    { id: 'mcp_instructions', label: 'Instruções MCP', color: '#6b7280', tokens: estTokens(mcpInstructions), pct: 0 },
    { id: 'custom_agents', label: 'Agentes personalizados', color: '#6b7280', tokens: estTokens(customAgents), pct: 0 },
    { id: 'autocompact', label: 'Buffer de autocompact', color: '#6b7280', tokens: estTokens(autocompactBuffer), pct: +((estTokens(autocompactBuffer) / limit) * 100).toFixed(1) },
    { id: 'free', label: 'Espaço livre', color: '#374151', tokens: free, pct: +((free / limit) * 100).toFixed(1) }
  ];

  return {
    limitTokens: limit,
    usedTokens,
    pct,
    untilCompactTokens: untilCompact,
    untilCompactLabel: `${Math.round(untilCompact / 1000)}k até o auto-compact`,
    categories,
    expandable: {
      mcpTools: { tokens: estTokens(mcpTools), count: mcpToolCount || 152 },
      customAgents: { tokens: estTokens(customAgents), count: db.agents?.length || 0 }
    },
    estimate: true
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
