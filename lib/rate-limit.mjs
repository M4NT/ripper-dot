/**
 * Limite de taxa opt-in por token (RIPPER_TOKEN) e por IP — janela em memória no processo.
 * Vários processos Node no mesmo host não compartilham contadores (use proxy ou Redis se precisar).
 */

const DEFAULT = {
  enabled: false,
  chatPerMinute: 30,
  apiPerMinute: 20,
  windowMs: 60_000
};

/** Rotas pesadas (bucket api), além de backup/export e restore. */
export const API_RATE_LIMIT_ROUTES = [
  ['GET', /^\/api\/data\/backup$/],
  ['POST', /^\/api\/data\/restore$/],
  ['GET', /^\/api\/metering\/export$/],
  ['POST', /^\/api\/dev\/chaos\/fire$/]
];

function envBool(key, env = process.env) {
  const raw = env[key];
  if (raw == null || String(raw).trim() === '') return null;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

function envNum(key, env = process.env) {
  const raw = env[key];
  if (raw == null || String(raw).trim() === '') return null;
  const n = +raw;
  return Number.isFinite(n) ? n : null;
}

export function normalizeRateLimit(partial = {}, { env = process.env } = {}) {
  const base = { ...DEFAULT, ...partial };
  const enabledEnv = envBool('RIPPER_RATE_ENABLED', env);
  const chatEnv = envNum('RIPPER_RATE_CHAT_PER_MINUTE', env);
  const apiEnv = envNum('RIPPER_RATE_API_PER_MINUTE', env);
  const windowEnv = envNum('RIPPER_RATE_WINDOW_MS', env);
  return {
    enabled: enabledEnv != null ? enabledEnv : !!base.enabled,
    chatPerMinute: Math.max(1, Math.min(10_000, chatEnv ?? (+base.chatPerMinute || DEFAULT.chatPerMinute))),
    apiPerMinute: Math.max(1, Math.min(10_000, apiEnv ?? (+base.apiPerMinute || DEFAULT.apiPerMinute))),
    windowMs: Math.max(1000, Math.min(3_600_000, windowEnv ?? (+base.windowMs || DEFAULT.windowMs)))
  };
}

export function resolveRateLimitConfig(settings) {
  return normalizeRateLimit(settings?.rateLimit || {});
}

/** @returns {'chat'|'api'|null} */
export function rateLimitBucket(method, path) {
  if (method === 'POST' && path === '/api/chat') return 'chat';
  for (const [m, re] of API_RATE_LIMIT_ROUTES) {
    if (method === m && re.test(path)) return 'api';
  }
  return null;
}

export function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim().slice(0, 128) || 'unknown';
  const addr = req.socket?.remoteAddress || 'unknown';
  return String(addr).slice(0, 128);
}

let nowMs = () => Date.now();
const windows = new Map();

/** @param {() => number} fn */
export function _setRateLimitClock(fn) {
  nowMs = typeof fn === 'function' ? fn : () => Date.now();
}

export function _resetRateLimitForTests() {
  nowMs = () => Date.now();
  windows.clear();
}

function windowKey(bucket, dimension, id) {
  return `${bucket}:${dimension}:${id}`;
}

function hit(key, limit, windowMs) {
  const now = nowMs();
  let row = windows.get(key);
  if (!row || now - row.start >= windowMs) {
    row = { start: now, count: 0 };
    windows.set(key, row);
  }
  row.count += 1;
  const retryAfterSec = Math.max(1, Math.ceil((row.start + windowMs - now) / 1000));
  return { allowed: row.count <= limit, retryAfterSec };
}

/**
 * @returns {{ ok: true } | { ok: false, retryAfterSec: number, message: string }}
 */
export function checkRateLimit({ req, settings, ripperToken, method, path }) {
  const config = resolveRateLimitConfig(settings);
  if (!config.enabled) return { ok: true };
  const bucket = rateLimitBucket(method, path);
  if (!bucket) return { ok: true };
  const limit = bucket === 'chat' ? config.chatPerMinute : config.apiPerMinute;
  const ip = clientIp(req);
  const checks = [hit(windowKey(bucket, 'ip', ip), limit, config.windowMs)];
  if (ripperToken) {
    checks.push(hit(windowKey(bucket, 'token', ripperToken), limit, config.windowMs));
  }
  const failed = checks.find(c => !c.allowed);
  if (!failed) return { ok: true };
  return {
    ok: false,
    retryAfterSec: failed.retryAfterSec,
    message: 'Limite de taxa excedido. Aguarde antes de tentar de novo.'
  };
}

export const RATE_LIMIT_DOC =
  'Contadores ficam na memória deste processo Node; vários workers ou réplicas não compartilham o mesmo limite.';
