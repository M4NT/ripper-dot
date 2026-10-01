import { AsyncLocalStorage } from 'node:async_hooks';
import {
  redactSecretsInText,
  redactJsonPayload,
  redactHeaders,
  isSensitiveName
} from './redact.mjs';

const requestStore = new AsyncLocalStorage();

let jsonMode =
  process.env.RIPPER_LOG_JSON === '1' ||
  process.env.RIPPER_LOG_JSON === 'true';

const SENSITIVE_META = /^(authorization|cookie|set-cookie|x-api-key|api[-_]?key|token|secret|password|passwd|credential|hooksecret|sealed|vault)$/i;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

function envJsonMode() {
  return process.env.RIPPER_LOG_JSON === '1' || process.env.RIPPER_LOG_JSON === 'true';
}

/** Atualiza modo JSON a partir de settings (env liga por padrão até configure). */
export function configureLogger({ settings } = {}) {
  if (envJsonMode()) {
    jsonMode = true;
    return;
  }
  if (settings?.logging && typeof settings.logging.json === 'boolean') {
    jsonMode = settings.logging.json;
  }
}

export function isJsonLogging() {
  return jsonMode;
}

function redactPiiInText(text) {
  if (text == null || text === '') return text;
  return redactSecretsInText(String(text).replace(EMAIL, '[email]'));
}

function sanitizeValue(value, depth = 0) {
  if (value == null || depth > 4) return value;
  if (typeof value === 'string') return redactPiiInText(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => sanitizeValue(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_META.test(k) || isSensitiveName(k)) {
      out[k] = '••••';
      continue;
    }
    if (k === 'headers' && v && typeof v === 'object') {
      out[k] = redactHeaders(v);
      continue;
    }
    out[k] = sanitizeValue(v, depth + 1);
  }
  return redactJsonPayload(out);
}

function buildEntry(level, msg, extra) {
  const ctx = requestStore.getStore();
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: redactPiiInText(msg)
  };
  if (ctx?.requestId) entry.requestId = ctx.requestId;
  if (ctx?.route) entry.route = ctx.route;
  if (extra && typeof extra === 'object' && Object.keys(extra).length) {
    Object.assign(entry, sanitizeValue(extra));
  }
  return entry;
}

function write(level, msg, extra) {
  const entry = buildEntry(level, msg, extra);
  if (jsonMode) {
    const line = JSON.stringify(entry);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    return;
  }
  const parts = [];
  if (entry.requestId) parts.push(`[${entry.requestId}]`);
  if (entry.route) parts.push(entry.route);
  parts.push(entry.msg);
  const tail = { ...entry };
  delete tail.ts;
  delete tail.level;
  delete tail.msg;
  delete tail.requestId;
  delete tail.route;
  const rest = Object.keys(tail).length ? ` ${JSON.stringify(sanitizeValue(tail))}` : '';
  const text = parts.filter(Boolean).join(' ') + rest;
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
}

export const logger = {
  info(msg, extra) {
    write('info', msg, extra);
  },
  warn(msg, extra) {
    write('warn', msg, extra);
  },
  error(msg, extra) {
    write('error', msg, extra);
  }
};

/**
 * Contexto de log por requisição HTTP. Use depois de `attachRequestId` (req.requestId).
 */
export function runWithRequestContext(req, route, fn) {
  const safeRoute = String(route || req.url || '').split('?')[0] || '/';
  return requestStore.run({ requestId: req.requestId, route: safeRoute }, fn);
}

export function getRequestLogContext() {
  return requestStore.getStore();
}

/** Rotas que geram log HTTP (evita estáticos e SSE ping). */
export function shouldLogHttpRoute(pathname) {
  return pathname.startsWith('/api/');
}
