/** OAuth interativo para conectores MCP HTTP (RFC 8414 + metadados do recurso protegido). */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as dns } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, isIPv4, isIPv6 } from 'node:net';

export const RIPPER_PUBLISHED_CLIENT_ID = process.env.RIPPER_OAUTH_CLIENT_ID || 'https://ripper.local/oauth/client';
export const OAUTH_FLOW_TTL_MS = 15 * 60_000;
export const OAUTH_CALLBACK_SCRIPT_PATH = '/oauth-callback.js';
export const OAUTH_COOKIE_NAME = 'ripper_mcp_oauth';
export const OAUTH_CALLBACK_PATH = '/api/mcp/oauth/callback';
export const OAUTH_FETCH_MAX_BODY = 256 * 1024;

const flowStore = new Map();
const MAX_OAUTH_REDIRECTS = 5;

const PRIVATE_V4 = new BlockList();
PRIVATE_V4.addSubnet('0.0.0.0', 8, 'ipv4');
PRIVATE_V4.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE_V4.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE_V4.addSubnet('169.254.0.0', 16, 'ipv4');
PRIVATE_V4.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE_V4.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE_V4.addSubnet('100.64.0.0', 10, 'ipv4');
PRIVATE_V4.addSubnet('198.18.0.0', 15, 'ipv4');
PRIVATE_V4.addSubnet('224.0.0.0', 4, 'ipv4');
PRIVATE_V4.addSubnet('240.0.0.0', 4, 'ipv4');

const PRIVATE_V6 = new BlockList();
PRIVATE_V6.addAddress('::1', 'ipv6');
PRIVATE_V6.addAddress('::', 'ipv6');
PRIVATE_V6.addSubnet('fe80::', 10, 'ipv6');
PRIVATE_V6.addSubnet('fc00::', 7, 'ipv6');
PRIVATE_V6.addSubnet('2002::', 16, 'ipv6');
PRIVATE_V6.addSubnet('64:ff9b::', 96, 'ipv6');

/** Testes locais (IdP falso em 127.0.0.1). Em produção fica desligado. */
export function oauthAllowPrivate() {
  return process.env.RIPPER_OAUTH_ALLOW_PRIVATE === '1';
}

/** ::ffff:7f00:1 e ::ffff:127.0.0.1 → 127.0.0.1 */
export function unwrapIpv4Mapped(ip) {
  const s = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  const dotted = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1];
  const hex = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const a = parseInt(hex[1], 16);
  const b = parseInt(hex[2], 16);
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
}

export function isBlockedIp(ip) {
  const raw = String(ip || '').replace(/^\[|\]$/g, '');
  const mapped = unwrapIpv4Mapped(raw);
  if (mapped || isIPv4(raw)) return PRIVATE_V4.check(mapped || raw, 'ipv4');
  if (isIPv6(raw)) return PRIVATE_V6.check(raw, 'ipv6');
  return true;
}

export function isBlockedHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.+$/, '').replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host === 'metadata.google.internal') return true;
  if (isIP(host)) return isBlockedIp(host);
  return false;
}

/** Host literal privado, loopback, link-local ou metadados de nuvem. */
export function isPrivateOrInternalHost(hostname) {
  return isBlockedHostname(hostname) || isBlockedIp(hostname);
}

export function isSafeOutboundUrl(raw, { allowPrivate = oauthAllowPrivate() } = {}) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return false; }
  if (u.protocol !== 'https:' && !(allowPrivate && u.protocol === 'http:')) return false;
  if (u.username || u.password) return false;
  if (!allowPrivate && isBlockedHostname(u.hostname)) return false;
  return true;
}

export function assertSafeOutboundUrl(raw, opts) {
  if (!isSafeOutboundUrl(raw, opts)) throw new Error('URL OAuth bloqueada (HTTPS público exigido).');
  return String(raw);
}

export async function resolvePublicAddresses(hostname, { lookupFn, allowPrivate = oauthAllowPrivate() } = {}) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '');
  if (!host) throw new Error('URL OAuth bloqueada (HTTPS público exigido).');
  let records;
  if (isIP(host)) {
    records = [{ address: host, family: isIPv6(host) ? 6 : 4 }];
  } else {
    if (!allowPrivate && isBlockedHostname(host)) throw new Error('URL OAuth bloqueada (HTTPS público exigido).');
    const fn = lookupFn || ((name, opts) => dns.lookup(name, opts));
    const found = await fn(host, { all: true, verbatim: true });
    records = Array.isArray(found) ? found : found ? [found] : [];
    if (!records.length) throw new Error('DNS sem endereço.');
  }
  return validatedAddresses(records, allowPrivate);
}

export function validatedAddresses(records, allowPrivate = oauthAllowPrivate()) {
  const list = (records || []).map(r => ({
    address: r.address,
    family: Number(r.family) === 6 ? 6 : 4
  }));
  if (!list.length) throw new Error('URL OAuth bloqueada (HTTPS público exigido).');
  if (!allowPrivate && list.some(r => isBlockedIp(r.address))) {
    throw new Error('URL OAuth bloqueada (HTTPS público exigido).');
  }
  return list;
}

function pinnedLookup(ips) {
  return (_host, opts, cb) => {
    if (opts?.all) return cb(null, ips);
    cb(null, ips[0].address, ips[0].family);
  };
}

function pinnedRequest(u, ips, init = {}) {
  const lib = u.protocol === 'https:' ? https : http;
  const method = init.method || 'GET';
  const headers = { ...(init.headers || {}) };
  const maxBody = Number(init.maxBody) > 0 ? Number(init.maxBody) : OAUTH_FETCH_MAX_BODY;
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = err => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      method,
      headers,
      timeout: init.timeout || 8000,
      signal: init.signal,
      agent: false,
      autoSelectFamily: false,
      lookup: pinnedLookup(ips)
    }, res => {
      const chunks = [];
      let n = 0;
      const abortOversize = () => {
        res.destroy();
        req.destroy();
        fail(new Error('Resposta OAuth grande demais.'));
      };
      res.on('data', c => {
        n += c.length;
        if (n > maxBody) {
          abortOversize();
          return;
        }
        chunks.push(c);
      });
      res.on('error', fail);
      res.on('end', () => {
        if (settled) return;
        settled = true;
        const buf = Buffer.concat(chunks);
        const hdrs = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v == null) continue;
          if (Array.isArray(v)) for (const x of v) hdrs.append(k, x);
          else hdrs.set(k, v);
        }
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers: hdrs,
          json: async () => JSON.parse(buf.toString() || 'null'),
          text: async () => buf.toString(),
          arrayBuffer: async () => buf
        });
      });
    });
    req.on('error', fail);
    req.on('timeout', () => {
      req.destroy();
      fail(new Error('timeout'));
    });
    if (init.body != null) req.write(typeof init.body === 'string' || Buffer.isBuffer(init.body) ? init.body : String(init.body));
    req.end();
  });
}

export function sameHttpOrigin(a, b) {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.protocol === y.protocol && x.host === y.host;
  } catch {
    return false;
  }
}

async function followSafeRedirect(res, fromUrl, init, ctx) {
  const status = Number(res.status) || (res.ok ? 200 : 0);
  if (status < 300 || status >= 400) return res;
  const loc = res.headers?.get?.('location');
  if (!loc) return res;
  if (typeof res.arrayBuffer === 'function') await res.arrayBuffer().catch(() => {});
  const nextHref = new URL(loc, fromUrl).href;
  const method = String(init.method || 'GET').toUpperCase();
  const keepsBody = status === 307 || status === 308;
  const hasSecrets = init.body != null && method !== 'GET' && method !== 'HEAD';
  if (keepsBody && hasSecrets && !sameHttpOrigin(fromUrl, nextHref)) {
    throw new Error('Redirect OAuth cross-origin recusado.');
  }
  const nextInit = keepsBody && sameHttpOrigin(fromUrl, nextHref)
    ? init
    : { ...init, method: 'GET', body: undefined };
  return safeFetch(nextHref, nextInit, { ...ctx, _hops: (ctx._hops || 0) + 1 });
}

/** Fetch com DNS validado, IP fixado na conexão e redirect manual revalidado. */
export async function safeFetch(url, init = {}, ctx = {}) {
  const {
    fetch: customFetch,
    lookupFn,
    allowPrivate = oauthAllowPrivate(),
    _hops = 0
  } = ctx;
  if (_hops > MAX_OAUTH_REDIRECTS) throw new Error('Muitos redirecionamentos OAuth.');
  assertSafeOutboundUrl(url, { allowPrivate });
  const u = new URL(url);
  let ips;
  if (!customFetch || lookupFn) {
    ips = validatedAddresses(
      await resolvePublicAddresses(u.hostname, { lookupFn, allowPrivate }),
      allowPrivate
    );
  }
  const next = { ...init, redirect: 'manual' };
  const res = customFetch
    ? await customFetch(url, next)
    : await pinnedRequest(u, ips, next);
  return followSafeRedirect(res, url, init, { ...ctx, allowPrivate, lookupFn, fetch: customFetch, _hops });
}

/** RFC 8707: sem fragmento, host minúsculo, porta default omitida. */
export function canonicalizeResource(raw) {
  const u = new URL(String(raw || '').trim());
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('resource inválido.');
  u.hash = '';
  u.username = '';
  u.password = '';
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
  let href = u.href;
  if (u.pathname !== '/' && href.endsWith('/')) href = href.slice(0, -1);
  return href;
}

export function resourceMatchesMcpUrl(resource, mcpUrl) {
  let r;
  let m;
  try {
    r = new URL(canonicalizeResource(resource));
    m = new URL(canonicalizeResource(mcpUrl));
  } catch {
    return false;
  }
  if (r.protocol !== m.protocol || r.hostname !== m.hostname || r.port !== m.port) return false;
  const rp = r.pathname.replace(/\/$/, '') || '/';
  const mp = m.pathname.replace(/\/$/, '') || '/';
  return rp === mp || mp.startsWith(`${rp}/`) || rp.startsWith(`${mp}/`);
}

/** Resource do PRM só vale se for a mesma origem/prefixo da URL do MCP. */
export function resolveOAuthResource(discovered, mcpUrl) {
  const fallback = canonicalizeResource(mcpUrl);
  if (!discovered) return fallback;
  let canon;
  try { canon = canonicalizeResource(discovered); } catch { return fallback; }
  return resourceMatchesMcpUrl(canon, fallback) ? canon : fallback;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

export function generatePkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}

function parseWwwAuthenticate(header) {
  if (!header) return {};
  const out = {};
  const m = /resource_metadata\s*=\s*"([^"]+)"/i.exec(header);
  if (m) out.resourceMetadata = m[1];
  const scope = /scope\s*=\s*"([^"]+)"/i.exec(header);
  if (scope) out.scope = scope[1];
  return out;
}

async function fetchJson(url, { fetch: f, timeout = 8000, lookupFn } = {}) {
  try {
    const r = await safeFetch(url, {
      headers: { accept: 'application/json' },
      timeout
    }, { fetch: f, lookupFn });
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  } catch {
    return null;
  }
}

/** Caminhos RFC 8414 a partir da URL do recurso MCP. */
export function oauthAuthorizationServerMetadataUrls(resourceUrl) {
  const u = new URL(resourceUrl);
  const origin = u.origin;
  const path = u.pathname.replace(/\/$/, '');
  const urls = [];
  if (path && path !== '/') {
    urls.push(`${origin}/.well-known/oauth-authorization-server${path}`);
    urls.push(`${origin}${path}/.well-known/oauth-authorization-server`);
  }
  urls.push(`${origin}/.well-known/oauth-authorization-server`);
  return urls;
}

/**
 * Descobre metadados OAuth (401 + WWW-Authenticate, Link ou well-known).
 * @returns {Promise<{ found: boolean, provider?: string, authorizationServer?: object, resource?: string, scopes?: string }>}
 */
export async function discoverMcpOAuth(resourceUrl, { fetch: f, probeHeaders, lookupFn } = {}) {
  const resource = String(resourceUrl).trim();
  if (!isSafeOutboundUrl(resource)) return { found: false };
  let resourceMeta = null;
  const wwwHints = parseWwwAuthenticate(probeHeaders?.get?.('www-authenticate'));
  if (wwwHints.resourceMetadata) {
    resourceMeta = await fetchJson(wwwHints.resourceMetadata, { fetch: f, lookupFn });
  }
  if (!resourceMeta) {
    const u = new URL(resource);
    const candidates = [
      `${u.origin}/.well-known/oauth-protected-resource`,
      `${u.origin}/.well-known/oauth-protected-resource${u.pathname.replace(/\/$/, '')}`
    ];
    for (const url of candidates) {
      resourceMeta = await fetchJson(url, { fetch: f, lookupFn });
      if (resourceMeta?.authorization_servers?.length) break;
    }
  }

  const asUrls = [];
  if (resourceMeta?.authorization_servers?.length) {
    for (const iss of resourceMeta.authorization_servers) asUrls.push(String(iss).replace(/\/$/, '') + '/.well-known/oauth-authorization-server');
  }
  for (const url of oauthAuthorizationServerMetadataUrls(resource)) asUrls.push(url);

  let authorizationServer = null;
  for (const url of [...new Set(asUrls)]) {
    authorizationServer = await fetchJson(url, { fetch: f, lookupFn });
    if (authorizationServer?.authorization_endpoint && authorizationServer?.token_endpoint) break;
    authorizationServer = null;
  }

  if (authorizationServer) {
    return {
      found: true,
      provider: resourceMeta ? 'oauth_protected_resource' : 'oauth_authorization_server_metadata',
      authorizationServer,
      resource: resolveOAuthResource(resourceMeta?.resource, resource),
      scopes: wwwHints.scope || resourceMeta?.scopes_supported?.join(' ') || authorizationServer.scopes_supported?.join(' ')
    };
  }

  const www = probeHeaders?.get?.('www-authenticate') || '';
  const link = probeHeaders?.get?.('link') || '';
  if (/bearer/i.test(www) || /oauth/i.test(www) || /oauth/i.test(link)) {
    return { found: true, provider: 'oauth_header', authorizationServer: null };
  }
  return { found: false };
}

/** Texto vindo da URL (error_description) antes de entrar no HTML do callback. */
export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export function oauthRedirectUri(baseUrl) {
  const base = String(baseUrl || 'http://127.0.0.1:3000').replace(/\/$/, '');
  return `${base}/api/mcp/oauth/callback`;
}

function resolveClient(plugin, discovery) {
  const auth = plugin.auth || {};
  if (auth.oauthClient === 'custom' && auth.clientId) {
    return { clientId: auth.clientId, clientSecret: auth.clientSecret || '' };
  }
  if (auth.oauthClient === 'dcr') {
    return { clientId: '', clientSecret: '', dcr: true };
  }
  const meta = discovery?.authorizationServer;
  // Antes caía sempre no client id "https://ripper.local/…": o servidor de login tenta baixar esse
  // documento, não acha (não é público) e recusa. Registro dinâmico funciona sem nada público.
  if (meta?.registration_endpoint) return { clientId: '', clientSecret: '', dcr: true };
  if (meta?.client_id_metadata_document_supported && process.env.RIPPER_OAUTH_CLIENT_ID) {
    return { clientId: RIPPER_PUBLISHED_CLIENT_ID, clientSecret: '' };
  }
  throw new Error('Este servidor não aceita registro automático de cliente. Em Conectar aplicativos, use Adicionar por endereço e informe um Client ID.');
}

function createOAuthBinding() {
  const raw = b64url(randomBytes(18));
  const hash = createHash('sha256').update(raw).digest('base64url');
  return { raw, hash };
}

export function oauthCookieName(state) {
  const s = String(state || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  if (!s) throw new Error('state OAuth ausente.');
  return `${OAUTH_COOKIE_NAME}_${s}`;
}

export function oauthBindingCookie(raw, { state, clear = false, secure = false } = {}) {
  const max = clear ? 0 : Math.floor(OAUTH_FLOW_TTL_MS / 1000);
  const val = clear ? '' : encodeURIComponent(raw);
  return `${oauthCookieName(state)}=${val}; HttpOnly; SameSite=Lax; Path=${OAUTH_CALLBACK_PATH}; Max-Age=${max}${secure ? '; Secure' : ''}`;
}

export function readOAuthBindingCookie(req, state) {
  const name = oauthCookieName(state);
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(req?.headers?.cookie || '');
  return m ? decodeURIComponent(m[1]) : '';
}

async function dynamicClientRegister(asMeta, redirectUri, { fetch: f, lookupFn } = {}) {
  const ep = asMeta.registration_endpoint;
  if (!ep) throw new Error('Servidor não oferece registro dinâmico de cliente (DCR).');
  assertSafeOutboundUrl(ep);
  const body = {
    client_name: 'Ripper MCP Connector',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none'
  };
  const r = await safeFetch(ep, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body)
  }, { fetch: f, lookupFn });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || `DCR HTTP ${r.status}`);
  if (!j.client_id) throw new Error('Registro dinâmico não retornou client_id.');
  return { clientId: j.client_id, clientSecret: j.client_secret || '' };
}

/**
 * Inicia fluxo OAuth; retorna URL de autorização e flowId.
 */
export async function startMcpOAuthFlow({
  plugin,
  discovery,
  redirectUri,
  fetch: f,
  lookupFn
}) {
  const as = discovery?.authorizationServer;
  if (!as?.authorization_endpoint || !as?.token_endpoint) {
    throw new Error('Metadados OAuth incompletos. Configure o cliente manualmente ou verifique o servidor.');
  }
  assertSafeOutboundUrl(as.authorization_endpoint);
  assertSafeOutboundUrl(as.token_endpoint);
  let { clientId, clientSecret, dcr } = resolveClient(plugin, discovery);
  if (dcr && !clientId) {
    const reg = await dynamicClientRegister(as, redirectUri, { fetch: f, lookupFn });
    clientId = reg.clientId;
    clientSecret = reg.clientSecret;
  }
  if (!clientId) throw new Error('Client ID OAuth ausente.');

  const pkce = generatePkce();
  const state = b64url(randomBytes(18));
  const flowId = b64url(randomBytes(12));
  const scope = discovery.scopes || (as.scopes_supported || []).slice(0, 8).join(' ') || '';
  // RFC 8707: mesmo resource validado contra a URL do MCP, reutilizado no refresh.
  const resource = resolveOAuthResource(discovery.resource || '', plugin.url || '');

  const params = authorizationRequestParams({ clientId, redirectUri, state, pkce, scope, resource });

  const authUrl = new URL(as.authorization_endpoint);
  for (const [k, v] of params) authUrl.searchParams.set(k, v);
  const authorizeUrl = authUrl.href;

  const binding = createOAuthBinding();
  pruneFlows();
  flowStore.set(flowId, {
    flowId,
    state,
    codeVerifier: pkce.verifier,
    pluginName: plugin.name,
    redirectUri,
    tokenEndpoint: as.token_endpoint,
    clientId,
    clientSecret,
    resource,
    cookieHash: binding.hash,
    cookieUsed: false,
    createdAt: Date.now(),
    status: 'pending',
    error: null
  });
  return { flowId, authorizeUrl, state, cookieRaw: binding.raw };
}

function pruneFlows() {
  const cutoff = Date.now() - OAUTH_FLOW_TTL_MS;
  for (const [id, f] of flowStore) {
    if (f.createdAt < cutoff) flowStore.delete(id);
  }
}

function flowStillPending(f) {
  return f && f.status === 'pending' && (Date.now() - f.createdAt) < OAUTH_FLOW_TTL_MS;
}

export function getOAuthFlow(flowId) {
  pruneFlows();
  return flowStore.get(flowId) || null;
}

export function findOAuthFlowByState(state, { cookie } = {}) {
  pruneFlows();
  if (!state) return null;
  for (const f of flowStore.values()) {
    if (!flowStillPending(f)) continue;
    if (!safeEq(f.state, state)) continue;
    if (!f.cookieHash || f.cookieUsed) continue;
    if (!cookie) continue;
    const got = createHash('sha256').update(String(cookie)).digest('base64url');
    if (!safeEq(f.cookieHash, got)) continue;
    f.cookieUsed = true;
    return f;
  }
  return null;
}

function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Parâmetros do authorize (OAuth 2.1 + PKCE S256 + resource RFC 8707). */
export function authorizationRequestParams({ clientId, redirectUri, state, pkce, scope, resource }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: pkce.method || 'S256'
  });
  if (scope) params.set('scope', scope);
  if (resource) params.set('resource', resource);
  return params;
}

/**
 * Página do callback: script externo (CSP script-src 'self').
 * Só status no data-*; texto externo fica no <p> escapado. Sem token.
 */
export function oauthCallbackHtml({ status, message, origin }) {
  const st = status === 'complete' ? 'complete' : 'error';
  const target = origin && /^https?:\/\//i.test(origin) ? origin : '';
  const visible = escapeHtml(message || (st === 'complete' ? 'Login concluído. Você pode fechar esta janela.' : 'Login OAuth falhou.'));
  return `<!doctype html><meta charset=utf-8><title>Ripper</title><p>${visible}</p><script src="${OAUTH_CALLBACK_SCRIPT_PATH}" data-status="${st}" data-origin="${escapeHtml(target)}"></script>`;
}

/** JS próprio do popup: postMessage só com status e fecha a janela. */
export function oauthCallbackScript() {
  return `(function(){
  var el=document.currentScript;
  var status=el&&el.getAttribute('data-status')==='complete'?'complete':'error';
  var origin=(el&&el.getAttribute('data-origin'))||'';
  var msg={type:'ripper-mcp-oauth',status:status};
  var target=origin||location.origin;
  try{if(window.opener)window.opener.postMessage(msg,target);}catch(e){}
  setTimeout(function(){window.close();},800);
})();`;
}

function isInvalidTarget(j) {
  return j?.error === 'invalid_target' || /invalid_target/i.test(String(j?.error_description || ''));
}

async function postTokenForm(url, body, f, lookupFn) {
  const r = await safeFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body
  }, { fetch: f, lookupFn });
  const j = await r.json().catch(() => ({}));
  return { r, j };
}

export async function exchangeOAuthCode(flow, code, { fetch: f, lookupFn } = {}) {
  assertSafeOutboundUrl(flow.tokenEndpoint);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: flow.redirectUri,
    client_id: flow.clientId,
    code_verifier: flow.codeVerifier
  });
  if (flow.clientSecret) body.set('client_secret', flow.clientSecret);

  const tryOnce = withResource => {
    const b = new URLSearchParams(body);
    if (withResource && flow.resource) b.set('resource', flow.resource);
    return postTokenForm(flow.tokenEndpoint, b, f, lookupFn);
  };

  let { r, j } = await tryOnce(true);
  if (!r.ok && flow.resource && isInvalidTarget(j)) ({ r, j } = await tryOnce(false));
  if (!r.ok) {
    const msg = j.error_description || j.error || `Token HTTP ${r.status}`;
    flow.status = 'error';
    flow.error = msg;
    throw new Error(msg);
  }
  return normalizeTokenResponse(j);
}

export function normalizeTokenResponse(j) {
  const expiresIn = Number(j.expires_in) || 3600;
  return {
    accessToken: String(j.access_token || ''),
    refreshToken: j.refresh_token ? String(j.refresh_token) : '',
    tokenType: j.token_type || 'Bearer',
    scope: j.scope ? String(j.scope) : '',
    expiresAt: Date.now() + expiresIn * 1000
  };
}

function refreshResource(plugin) {
  const stored = plugin.auth?.resource;
  const url = plugin.url || '';
  if (stored && url && resourceMatchesMcpUrl(stored, url)) return canonicalizeResource(stored);
  if (url) {
    try { return canonicalizeResource(url); } catch { return ''; }
  }
  return '';
}

export async function refreshPluginOAuthToken(plugin, { fetch: f, lookupFn } = {}) {
  const tok = plugin.auth?.oauth;
  if (!tok?.refreshToken || !plugin.auth?.tokenEndpoint) {
    return { ok: false, error: 'Refresh token ou endpoint OAuth ausente.' };
  }
  try { assertSafeOutboundUrl(plugin.auth.tokenEndpoint); } catch (e) {
    return { ok: false, error: e.message };
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tok.refreshToken,
    client_id: plugin.auth.clientId || RIPPER_PUBLISHED_CLIENT_ID
  });
  if (plugin.auth.clientSecret) body.set('client_secret', plugin.auth.clientSecret);
  const resource = refreshResource(plugin);

  const tryOnce = withResource => {
    const b = new URLSearchParams(body);
    if (withResource && resource) b.set('resource', resource);
    return postTokenForm(plugin.auth.tokenEndpoint, b, f, lookupFn);
  };

  let { r, j } = await tryOnce(true);
  if (!r.ok && resource && isInvalidTarget(j)) ({ r, j } = await tryOnce(false));
  if (!r.ok) {
    const msg = j.error_description || j.error || `Refresh HTTP ${r.status}`;
    return { ok: false, error: msg };
  }
  return { ok: true, tokens: normalizeTokenResponse(j) };
}

/** Estado de autenticação exposto na API (sem segredos). */
export function pluginOAuthStatus(plugin) {
  const auth = plugin?.auth;
  if (!auth || auth.mode === 'none') return { state: 'none' };
  const oauth = auth.oauth;
  if (!oauth?.accessToken) {
    if (auth.mode === 'oauth_now') return { state: 'needs_auth', reason: 'Login OAuth necessário antes de usar ferramentas.' };
    return { state: 'lazy', reason: 'Login será solicitado quando o servidor exigir.' };
  }
  const exp = oauth.expiresAt;
  const now = Date.now();
  if (exp && exp <= now) {
    if (oauth.refreshToken) return { state: 'expired_refreshable', reason: 'Token expirado; use atualizar ou login novamente.', expiresAt: exp };
    return { state: 'expired', reason: 'Token expirado; faça login novamente.', expiresAt: exp };
  }
  if (exp && exp <= now + 5 * 60_000) return { state: 'expiring_soon', expiresAt: exp };
  return { state: 'ok', expiresAt: exp || undefined };
}

/** Cabeçalhos HTTP MCP (estáticos + Bearer OAuth + chave API). */
export async function mcpHttpAuthHeaders(plugin, { fetch: f, refresh = true, vault } = {}) {
  const { resolveCredentialValue } = await import('./credential-vault.mjs');
  const headers = {};
  for (const [k, v] of Object.entries(plugin.headers || {})) {
    headers[k] = vault?.dek ? await resolveCredentialValue(v, vault) : v;
  }
  const auth = plugin.auth;
  if (auth?.apiKey) {
    const headerName = auth.apiKeyHeader || 'authorization';
    if (!headers[headerName] && !headers[headerName.toLowerCase()]) {
      const key = vault?.dek ? await resolveCredentialValue(auth.apiKey, vault) : String(auth.apiKey);
      headers[headerName] = auth.apiKeyPrefix === 'raw' ? key : `Bearer ${key}`;
    }
  }
  if (!auth?.oauth?.accessToken) return headers;
  let oauth = auth.oauth;
  if (refresh && oauth.expiresAt && oauth.expiresAt < Date.now() + 60_000 && oauth.refreshToken) {
    const refreshed = await refreshPluginOAuthToken(plugin, { fetch: f });
    if (refreshed.ok && refreshed.tokens?.accessToken) oauth = refreshed.tokens;
  }
  if (oauth.accessToken) {
    const prefix = oauth.tokenType?.toLowerCase() === 'bearer' ? 'Bearer' : oauth.tokenType || 'Bearer';
    headers.authorization = headers.Authorization || `${prefix} ${oauth.accessToken}`;
  }
  return headers;
}

export function applyOAuthTokensToPlugin(plugin, tokens, flow) {
  const auth = { ...(plugin.auth || {}) };
  auth.oauth = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || auth.oauth?.refreshToken || '',
    tokenType: tokens.tokenType,
    scope: tokens.scope,
    expiresAt: tokens.expiresAt
  };
  if (flow?.clientId) auth.clientId = flow.clientId;
  if (flow?.clientSecret) auth.clientSecret = flow.clientSecret;
  if (flow?.tokenEndpoint) auth.tokenEndpoint = flow.tokenEndpoint;
  if (flow?.resource) auth.resource = flow.resource;
  return { ...plugin, auth };
}

export function redactPluginAuth(auth) {
  if (!auth || typeof auth !== 'object') return auth;
  const out = { ...auth };
  if (out.clientSecret) out.clientSecret = '••••';
  if (out.apiKey) out.apiKey = '••••';
  if (out.oauth) {
    out.oauth = {
      ...out.oauth,
      accessToken: out.oauth.accessToken ? '••••' : '',
      refreshToken: out.oauth.refreshToken ? '••••' : ''
    };
  }
  return out;
}

export function mergePluginAuth(prev, incoming) {
  if (!incoming || typeof incoming !== 'object') return prev;
  const auth = {
    mode: ['oauth_now', 'oauth_lazy', 'none'].includes(incoming.mode) ? incoming.mode : (prev?.mode || 'oauth_lazy'),
    oauthClient: ['published', 'dcr', 'custom'].includes(incoming.oauthClient) ? incoming.oauthClient : (prev?.oauthClient || 'published'),
    clientId: String(incoming.clientId ?? prev?.clientId ?? '').slice(0, 200),
    clientSecret: incoming.clientSecret === '••••' ? (prev?.clientSecret || '') : String(incoming.clientSecret ?? prev?.clientSecret ?? '').slice(0, 500),
    // clientSecret pode ser vlt_… (cofre cliente)
    apiKey: incoming.apiKey === '••••' ? (prev?.apiKey || '') : String(incoming.apiKey ?? prev?.apiKey ?? '').slice(0, 500),
    // apiKey pode ser referência vlt_… (cofre cliente)
    apiKeyHeader: String(incoming.apiKeyHeader ?? prev?.apiKeyHeader ?? '').slice(0, 80) || undefined,
    apiKeyPrefix: incoming.apiKeyPrefix === 'raw' ? 'raw' : (prev?.apiKeyPrefix === 'raw' ? 'raw' : undefined),
    tokenEndpoint: incoming.tokenEndpoint || prev?.tokenEndpoint || '',
    resource: String(incoming.resource ?? prev?.resource ?? '').slice(0, 500) || undefined,
    vaultRef: String(incoming.vaultRef ?? prev?.vaultRef ?? '').slice(0, 64) || undefined,
    headers: Array.isArray(incoming.headers)
      ? incoming.headers.slice(0, 4).map(h => ({ name: String(h.name || '').slice(0, 80), value: String(h.value || '').slice(0, 500) })).filter(h => h.name)
      : prev?.headers
  };
  if (incoming.oauth && typeof incoming.oauth === 'object') {
    auth.oauth = {
      accessToken: incoming.oauth.accessToken === '••••' ? (prev?.oauth?.accessToken || '') : String(incoming.oauth.accessToken || prev?.oauth?.accessToken || ''),
      refreshToken: incoming.oauth.refreshToken === '••••' ? (prev?.oauth?.refreshToken || '') : String(incoming.oauth.refreshToken || prev?.oauth?.refreshToken || ''),
      tokenType: incoming.oauth.tokenType || prev?.oauth?.tokenType || 'Bearer',
      scope: incoming.oauth.scope || prev?.oauth?.scope || '',
      expiresAt: Number(incoming.oauth.expiresAt || prev?.oauth?.expiresAt || 0) || undefined
    };
  } else if (prev?.oauth) auth.oauth = prev.oauth;
  return auth;
}

/** Para testes: limpa fluxos pendentes. */
export function _clearOAuthFlows() {
  flowStore.clear();
}
