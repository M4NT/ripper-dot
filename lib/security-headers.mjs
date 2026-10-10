/**
 * Cabeçalhos HTTP de segurança e CORS configurável (`RIPPER_CORS_ORIGIN`).
 *
 * Referrer-Policy: `no-referrer` — não envia URL de origem a terceiros (adequado para UI local).
 * CSP: política mínima para o SPA (self + fontes Google usadas no build); frame-ancestors bloqueia embed.
 */

const DEFAULT_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self'; frame-src 'self' http://127.0.0.1:* http://localhost:*; frame-ancestors 'none'; base-uri 'none'";

/** @param {string | undefined} raw */
export function parseCorsAllowlist(raw = process.env.RIPPER_CORS_ORIGIN) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return new Set();
  return new Set(
    value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  );
}

export function securityHeaderFields() {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'content-security-policy': DEFAULT_CSP
  };
}

/**
 * @typedef {'none' | 'same-host' | 'allowlisted' | 'denied'} CorsKind
 */

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {Set<string>} allowlist
 * @returns {{ kind: CorsKind, origin?: string }}
 */
export function classifyRequestOrigin(req, allowlist) {
  const origin = req.headers.origin;
  if (!origin) return { kind: 'none' };
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return { kind: 'denied' };
  }
  const host = req.headers.host;
  if (host && parsed.host === host) return { kind: 'same-host', origin };
  if (allowlist.size > 0 && allowlist.has(origin)) return { kind: 'allowlisted', origin };
  if (allowlist.size === 0) return { kind: 'denied', origin };
  return { kind: 'denied', origin };
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {Set<string>} allowlist
 */
export function corsHeaderFields(req, allowlist) {
  const c = classifyRequestOrigin(req, allowlist);
  if (c.kind !== 'allowlisted' || !c.origin) return {};
  return {
    'access-control-allow-origin': c.origin,
    'access-control-allow-credentials': 'true',
    vary: 'Origin'
  };
}

function mergeVary(existing, add) {
  if (!add) return existing;
  const parts = new Set(
    String(existing || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  );
  for (const v of add.split(',').map(s => s.trim()).filter(Boolean)) parts.add(v);
  return parts.size ? [...parts].join(', ') : undefined;
}

/**
 * @param {import('node:http').IncomingMessage | null | undefined} req
 * @param {Set<string>} allowlist
 * @param {Record<string, string | number | undefined>} [extra]
 */
export function mergeResponseHeaders(req, allowlist, extra = {}) {
  const base = { ...securityHeaderFields(), ...(req ? corsHeaderFields(req, allowlist) : {}) };
  const out = { ...base, ...extra };
  const mergedVary = mergeVary(base.vary, extra.vary);
  if (mergedVary) out.vary = mergedVary;
  else if (!mergedVary && out.vary === undefined) delete out.vary;
  return out;
}

/**
 * Responde OPTIONS em rotas /api quando a origem está na allowlist.
 * @returns {boolean} true se a requisição foi encerrada aqui
 */
export function handleApiCorsPreflight(req, res, allowlist) {
  if (req.method !== 'OPTIONS') return false;
  const c = classifyRequestOrigin(req, allowlist);
  if (c.kind === 'allowlisted' && c.origin) {
    res.writeHead(
      204,
      mergeResponseHeaders(req, allowlist, {
        'access-control-allow-methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-max-age': '86400'
      })
    );
    res.end();
    return true;
  }
  res.writeHead(
    403,
    mergeResponseHeaders(req, allowlist, { 'content-type': 'application/json; charset=utf-8' })
  );
  res.end(JSON.stringify({ error: 'Origem não permitida.' }));
  return true;
}

/**
 * Bloqueia mutações cross-site quando a origem não é same-host nem allowlist.
 * @param {import('node:http').IncomingMessage} req
 * @param {Set<string>} allowlist
 * @returns {string | null} mensagem de erro ou null se permitido
 */
export function mutatingOriginError(req, allowlist) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return null;
  const origin = req.headers.origin;
  // Sem Origin: navegador moderno ainda manda Sec-Fetch-Site; pedido de outro site é recusado.
  if (!origin) return req.headers['sec-fetch-site'] === 'cross-site' ? 'Origem não permitida.' : null;
  const c = classifyRequestOrigin(req, allowlist);
  if (c.kind === 'same-host' || c.kind === 'allowlisted' || c.kind === 'none') return null;
  return 'Origem não permitida.';
}
