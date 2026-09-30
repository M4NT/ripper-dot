import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

function touchUsageProviders(db) {
  if (!db.usage) db.usage = { byModel: {}, events: [], updatedAt: Date.now(), providers: {} };
  if (!db.usage.providers) db.usage.providers = {};
  return db.usage;
}

const OAUTH_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_BETA = 'oauth-2025-04-20';
const OAUTH_CACHE_MS = 3 * 60_000;
const FETCH_TIMEOUT_MS = 12_000;

/** @type {{ at: number, data: object } | null} */
let oauthCache = null;

export function clearClaudeOAuthUsageCache() {
  oauthCache = null;
}

/** Ripper usa assinatura quando não força API key nas settings nem no env. */
export function claudeAuthMode(settings = {}, env = process.env) {
  const forcedApi = env.ANTHROPIC_API_KEY && String(env.ANTHROPIC_API_KEY).trim();
  if (forcedApi) return 'api_key';
  if (settings?.claude?.mode === 'api' && settings?.claude?.apiKey?.trim()) return 'api_key';
  return 'subscription';
}

function parseIsoReset(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function windowFromPctReset(utilization, resetsAt) {
  const pct = utilization == null || utilization === '' ? null : Math.round(Number(utilization));
  if (pct == null || !Number.isFinite(pct)) return null;
  return { pct: Math.min(100, Math.max(0, pct)), resetAt: parseIsoReset(resetsAt) };
}

/** Headers Anthropic em sessões OAuth (utilização 0–1). */
export function parseAnthropicRateLimitHeaders(headers) {
  if (!headers) return null;
  const get = name => {
    if (typeof headers.get === 'function') return headers.get(name);
    const k = Object.keys(headers).find(h => h.toLowerCase() === name.toLowerCase());
    return k ? headers[k] : undefined;
  };
  const u5 = get('anthropic-ratelimit-unified-5h-utilization');
  const u7 = get('anthropic-ratelimit-unified-7d-utilization');
  if (u5 == null && u7 == null) return null;
  const toPct = v => {
    if (v == null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    const pct = n <= 1 ? Math.round(n * 100) : Math.round(n);
    return Math.min(100, Math.max(0, pct));
  };
  const reset5 = get('anthropic-ratelimit-unified-5h-reset');
  const reset7 = get('anthropic-ratelimit-unified-7d-reset');
  const parseReset = raw => {
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
    return parseIsoReset(raw);
  };
  const fiveHour = u5 != null ? { pct: toPct(u5), resetAt: parseReset(reset5) } : null;
  const sevenDay = u7 != null ? { pct: toPct(u7), resetAt: parseReset(reset7) } : null;
  const status = get('anthropic-ratelimit-unified-status');
  return {
    fiveHour: fiveHour?.pct != null ? fiveHour : null,
    sevenDay: sevenDay?.pct != null ? sevenDay : null,
    status: status || null
  };
}

/** GET /api/oauth/usage (não documentado; usado pelo Claude Code). */
export function normalizeOAuthUsageBody(body) {
  if (!body || typeof body !== 'object') return null;
  const fiveHour = body.five_hour ? windowFromPctReset(body.five_hour.utilization, body.five_hour.resets_at) : null;
  const sevenDay = body.seven_day ? windowFromPctReset(body.seven_day.utilization, body.seven_day.resets_at) : null;
  const sevenDayOpus = body.seven_day_opus
    ? windowFromPctReset(body.seven_day_opus.utilization, body.seven_day_opus.resets_at)
    : null;
  let extraUsage = null;
  if (body.extra_usage && typeof body.extra_usage === 'object') {
    const eu = body.extra_usage;
    extraUsage = {
      enabled: !!eu.is_enabled,
      usedCreditsCents: eu.used_credits != null ? Number(eu.used_credits) : null,
      monthlyLimitCents: eu.monthly_limit != null ? Number(eu.monthly_limit) : null,
      currency: eu.currency || 'USD'
    };
  }
  if (!fiveHour && !sevenDay && !sevenDayOpus && !extraUsage) return null;
  return { fiveHour, sevenDay, sevenDayOpus, extraUsage };
}

/** Resposta do control get_usage do Agent SDK (experimental). */
export function normalizeSdkGetUsageResponse(body) {
  if (!body?.rate_limits_available || !body.rate_limits) return null;
  const rl = body.rate_limits;
  const fiveHour = rl.five_hour ? windowFromPctReset(rl.five_hour.utilization, rl.five_hour.resets_at) : null;
  const sevenDay = rl.seven_day ? windowFromPctReset(rl.seven_day.utilization, rl.seven_day.resets_at) : null;
  const sevenDayOpus = rl.seven_day_opus
    ? windowFromPctReset(rl.seven_day_opus.utilization, rl.seven_day_opus.resets_at)
    : null;
  let extraUsage = null;
  if (rl.extra_usage) {
    const eu = rl.extra_usage;
    extraUsage = {
      enabled: !!eu.is_enabled,
      usedCreditsCents: eu.used_credits != null ? Number(eu.used_credits) : null,
      monthlyLimitCents: eu.monthly_limit != null ? Number(eu.monthly_limit) : null,
      currency: eu.currency || 'USD'
    };
  }
  if (!fiveHour && !sevenDay && !sevenDayOpus && !extraUsage) return null;
  return {
    fiveHour,
    sevenDay,
    sevenDayOpus,
    extraUsage,
    subscriptionType: body.subscription_type || null
  };
}

/** Linhas limits[] em usage_report (SDK). */
export function normalizeSdkUsageReportLimits(rateLimits) {
  if (!rateLimits?.limits?.length) return null;
  const byKind = {};
  for (const row of rateLimits.limits) {
    if (row.percent == null || !Number.isFinite(row.percent)) continue;
    byKind[row.kind] = {
      pct: Math.min(100, Math.max(0, Math.round(row.percent))),
      resetAt: parseIsoReset(row.resets_at)
    };
  }
  const fiveHour = byKind.session || byKind.five_hour || null;
  const sevenDay = byKind.weekly_all || byKind.seven_day || null;
  const sevenDayOpus = byKind.weekly_scoped || byKind.seven_day_opus || null;
  let extraUsage = null;
  if (rateLimits.extra_usage) {
    const eu = rateLimits.extra_usage;
    extraUsage = {
      enabled: !!eu.is_enabled,
      usedCreditsCents: eu.used_credits != null ? Number(eu.used_credits) : null,
      monthlyLimitCents: eu.monthly_limit != null ? Number(eu.monthly_limit) : null,
      currency: eu.currency || 'USD'
    };
  }
  if (!fiveHour && !sevenDay && !sevenDayOpus && !extraUsage) return null;
  return { fiveHour, sevenDay, sevenDayOpus, extraUsage };
}

export function mergeSubscriptionWindows(...parts) {
  const out = { fiveHour: null, sevenDay: null, sevenDayOpus: null, extraUsage: null, subscriptionType: null };
  for (const p of parts) {
    if (!p) continue;
    if (p.fiveHour?.pct != null) out.fiveHour = p.fiveHour;
    if (p.sevenDay?.pct != null) out.sevenDay = p.sevenDay;
    if (p.sevenDayOpus?.pct != null) out.sevenDayOpus = p.sevenDayOpus;
    if (p.extraUsage) out.extraUsage = p.extraUsage;
    if (p.subscriptionType) out.subscriptionType = p.subscriptionType;
  }
  const has = out.fiveHour || out.sevenDay || out.sevenDayOpus || out.extraUsage;
  return has ? out : null;
}

/** Lê access token OAuth (somente leitura; não grava credenciais). */
export async function readClaudeOAuthAccessToken({ env = process.env, home = homedir() } = {}) {
  const fromEnv = env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (fromEnv) return { accessToken: fromEnv, source: 'env' };
  const path = join(home, '.claude', '.credentials.json');
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw Object.assign(new Error('Não foi possível ler ~/.claude/.credentials.json'), { code: 'credentials_unreadable' });
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Arquivo de credenciais Claude inválido'), { code: 'credentials_parse' });
  }
  const token = json?.claudeAiOauth?.accessToken?.trim();
  if (!token) return null;
  return {
    accessToken: token,
    source: 'credentials_file',
    subscriptionType: json.claudeAiOauth.subscriptionType || null
  };
}

export async function fetchClaudeOAuthUsage(accessToken, { fetchImpl = globalThis.fetch } = {}) {
  if (!fetchImpl) throw new Error('fetch indisponível');
  const res = await fetchImpl(OAUTH_USAGE_URL, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
      'content-type': 'application/json',
      'anthropic-beta': OAUTH_BETA
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, error: 'oauth_unauthorized' };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: `oauth_http_${res.status}` };
  }
  const body = await res.json();
  const normalized = normalizeOAuthUsageBody(body);
  const headerSnap = parseAnthropicRateLimitHeaders(res.headers);
  const windows = mergeSubscriptionWindows(normalized, headerSnap);
  return { ok: true, windows, raw: body };
}

export function recordClaudeSubscriptionSnapshot(db, { source, windows, subscriptionType, error, status } = {}) {
  const u = touchUsageProviders(db);
  const prev = u.providers?.claude && u.providers.claude.kind === 'subscription' ? u.providers.claude : {};
  const row = {
    kind: 'subscription',
    provider: 'claude',
    at: Date.now(),
    authMode: 'subscription',
    source: source || prev.source || null,
    subscriptionType: subscriptionType || prev.subscriptionType || null,
    windows: windows || prev.windows || null,
    error: error || null,
    status: status || null
  };
  if (!row.windows && !row.error) return;
  u.providers.claude = row;
  u.updatedAt = Date.now();
}

export function claudeSubscriptionView(db, settings, env = process.env) {
  const mode = claudeAuthMode(settings, env);
  if (mode === 'api_key') {
    return {
      mode: 'api_key',
      available: false,
      hint: 'Modo chave de API: cotas Pro/Max do Claude.ai não se aplicam. Use login do Claude Code (Configurações → Claude) para ver barras de assinatura.'
    };
  }
  const row = touchUsageProviders(db).providers?.claude;
  if (row?.kind === 'subscription' && row.windows) {
    return {
      mode: 'subscription',
      available: true,
      source: row.source,
      subscriptionType: row.subscriptionType,
      windows: row.windows,
      fetchedAt: row.at,
      fragile: row.source === 'oauth_endpoint' || row.source === 'sdk_experimental'
    };
  }
  if (row?.kind === 'subscription' && row.error) {
    return {
      mode: 'subscription',
      available: false,
      error: row.error,
      hint: row.error === 'oauth_unauthorized'
        ? 'Token OAuth inválido ou expirado. Rode `claude login` nesta máquina.'
        : 'Não foi possível ler uso Pro/Max agora.'
    };
  }
  return {
    mode: 'subscription',
    available: false,
    hint: 'Sem leitura de cota Pro/Max ainda. Confirme `claude login` e envie uma mensagem com Claude.'
  };
}

/**
 * Atualiza snapshot Pro/Max (OAuth + cache). Não escreve credenciais.
 * @returns {Promise<{ refreshed: boolean, reason?: string }>}
 */
export async function refreshClaudeSubscriptionUsage(db, settings, opts = {}) {
  const mode = claudeAuthMode(settings, opts.env);
  if (mode === 'api_key') return { refreshed: false, reason: 'api_key_mode' };

  const now = Date.now();
  if (!opts.force && oauthCache && now - oauthCache.at < OAUTH_CACHE_MS) {
    if (oauthCache.windows) {
      recordClaudeSubscriptionSnapshot(db, { source: 'oauth_endpoint', windows: oauthCache.windows, subscriptionType: oauthCache.subscriptionType });
      return { refreshed: true, reason: 'cache' };
    }
    if (oauthCache.error) return { refreshed: false, reason: oauthCache.error };
  }

  let cred;
  try {
    cred = opts.readToken
      ? await opts.readToken()
      : await readClaudeOAuthAccessToken({ env: opts.env, home: opts.home });
  } catch (e) {
    recordClaudeSubscriptionSnapshot(db, { source: 'oauth_endpoint', error: e.code || 'credentials_error' });
    return { refreshed: false, reason: e.code || 'credentials_error' };
  }
  if (!cred) {
    recordClaudeSubscriptionSnapshot(db, { source: 'oauth_endpoint', error: 'not_logged_in' });
    oauthCache = { at: now, error: 'not_logged_in' };
    return { refreshed: false, reason: 'not_logged_in' };
  }

  try {
    const result = await fetchClaudeOAuthUsage(cred.accessToken, { fetchImpl: opts.fetchImpl });
    if (!result.ok) {
      oauthCache = { at: now, error: result.error };
      recordClaudeSubscriptionSnapshot(db, { source: 'oauth_endpoint', error: result.error });
      return { refreshed: false, reason: result.error };
    }
    oauthCache = {
      at: now,
      windows: result.windows,
      subscriptionType: cred.subscriptionType || null
    };
    recordClaudeSubscriptionSnapshot(db, {
      source: 'oauth_endpoint',
      windows: result.windows,
      subscriptionType: cred.subscriptionType || null
    });
    return { refreshed: true, reason: 'oauth_endpoint' };
  } catch (e) {
    const reason = e.name === 'TimeoutError' ? 'oauth_timeout' : 'oauth_fetch_failed';
    oauthCache = { at: now, error: reason };
    recordClaudeSubscriptionSnapshot(db, { source: 'oauth_endpoint', error: reason });
    return { refreshed: false, reason };
  }
}

/** Após uma rodada Claude: SDK experimental, usage_report ou headers. */
export async function captureClaudeUsageFromQuery(query, db, settings) {
  if (claudeAuthMode(settings) !== 'subscription' || !query) return;
  let windows = null;
  let subscriptionType = null;
  let source = null;

  const usageFn = query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
  if (typeof usageFn === 'function') {
    try {
      const sdk = await usageFn.call(query, { skipBehaviors: true });
      const norm = normalizeSdkGetUsageResponse(sdk);
      if (norm) {
        windows = mergeSubscriptionWindows(windows, norm);
        subscriptionType = norm.subscriptionType || subscriptionType;
        source = 'sdk_experimental';
      }
    } catch {
      /* SDK experimental pode falhar em versões antigas */
    }
  }

  if (windows) {
    recordClaudeSubscriptionSnapshot(db, { source, windows, subscriptionType });
  }
}

export function applyClaudeUsageReport(db, usageReport) {
  if (!usageReport?.rate_limits) return;
  const norm = normalizeSdkUsageReportLimits(usageReport.rate_limits);
  if (!norm) return;
  recordClaudeSubscriptionSnapshot(db, { source: 'sdk_usage_report', windows: norm });
}

export function applyClaudeRateLimitHeaders(db, headers) {
  const norm = parseAnthropicRateLimitHeaders(headers);
  if (!norm) return;
  const { status, ...windows } = norm;
  const merged = mergeSubscriptionWindows(windows);
  if (!merged) return;
  recordClaudeSubscriptionSnapshot(db, { source: 'response_headers', windows: merged, status });
}
