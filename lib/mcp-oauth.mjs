/** OAuth interativo para conectores MCP HTTP (RFC 8414 + metadados do recurso protegido). */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const RIPPER_PUBLISHED_CLIENT_ID = process.env.RIPPER_OAUTH_CLIENT_ID || 'https://ripper.local/oauth/client';
export const OAUTH_FLOW_TTL_MS = 15 * 60_000;
export const OAUTH_CALLBACK_SCRIPT_PATH = '/oauth-callback.js';

const flowStore = new Map();

/** Testes locais (IdP falso em 127.0.0.1). Em produção fica desligado. */
export function oauthAllowPrivate() {
  return process.env.RIPPER_OAUTH_ALLOW_PRIVATE === '1';
}

/** Host literal privado, loopback, link-local ou metadados de nuvem. */
export function isPrivateOrInternalHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.+$/, '').replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host === 'metadata.google.internal') return true;
  if (host === '::1' || host === '0.0.0.0' || host === '::') return true;
  const v4mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const ip = v4mapped ? v4mapped[1] : host;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.some(n => n > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
  }
  if (host.includes(':')) {
    if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
  }
  return false;
}

export function isSafeOutboundUrl(raw, { allowPrivate = oauthAllowPrivate() } = {}) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return false; }
  if (u.protocol !== 'https:' && !(allowPrivate && u.protocol === 'http:')) return false;
  if (u.username || u.password) return false;
  if (!allowPrivate && isPrivateOrInternalHost(u.hostname)) return false;
  return true;
}

export function assertSafeOutboundUrl(raw, opts) {
  if (!isSafeOutboundUrl(raw, opts)) throw new Error('URL OAuth bloqueada (HTTPS público exigido).');
  return String(raw);
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

async function fetchJson(url, { fetch: f = fetch, timeout = 8000 } = {}) {
  if (!isSafeOutboundUrl(url)) return null;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await f(url, { headers: { accept: 'application/json' }, signal: ac.signal });
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
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
export async function discoverMcpOAuth(resourceUrl, { fetch: f = fetch, probeHeaders } = {}) {
  const resource = String(resourceUrl).trim();
  if (!isSafeOutboundUrl(resource)) return { found: false };
  let resourceMeta = null;
  const wwwHints = parseWwwAuthenticate(probeHeaders?.get?.('www-authenticate'));
  if (wwwHints.resourceMetadata) {
    resourceMeta = await fetchJson(wwwHints.resourceMetadata, { fetch: f });
  }
  if (!resourceMeta) {
    const u = new URL(resource);
    const candidates = [
      `${u.origin}/.well-known/oauth-protected-resource`,
      `${u.origin}/.well-known/oauth-protected-resource${u.pathname.replace(/\/$/, '')}`
    ];
    for (const url of candidates) {
      resourceMeta = await fetchJson(url, { fetch: f });
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
    authorizationServer = await fetchJson(url, { fetch: f });
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

async function dynamicClientRegister(asMeta, redirectUri, { fetch: f = fetch } = {}) {
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
  const r = await f(ep, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body)
  });
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
  fetch: f = fetch,
  sessionKey = ''
}) {
  const as = discovery?.authorizationServer;
  if (!as?.authorization_endpoint || !as?.token_endpoint) {
    throw new Error('Metadados OAuth incompletos. Configure o cliente manualmente ou verifique o servidor.');
  }
  assertSafeOutboundUrl(as.authorization_endpoint);
  assertSafeOutboundUrl(as.token_endpoint);
  let { clientId, clientSecret, dcr } = resolveClient(plugin, discovery);
  if (dcr && !clientId) {
    const reg = await dynamicClientRegister(as, redirectUri, { fetch: f });
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
    sessionKey: sessionKey ? String(sessionKey) : '',
    createdAt: Date.now(),
    status: 'pending',
    error: null
  });
  return { flowId, authorizeUrl, state };
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

export function findOAuthFlowByState(state, { sessionKey } = {}) {
  pruneFlows();
  if (!state) return null;
  for (const f of flowStore.values()) {
    if (!flowStillPending(f)) continue;
    if (!safeEq(f.state, state)) continue;
    if (f.sessionKey) {
      const got = sessionKey || '';
      if (!got || !safeEq(f.sessionKey, got)) continue;
    }
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

async function postTokenForm(url, body, f) {
  const r = await f(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body
  });
  const j = await r.json().catch(() => ({}));
  return { r, j };
}

export async function exchangeOAuthCode(flow, code, { fetch: f = fetch } = {}) {
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
    return postTokenForm(flow.tokenEndpoint, b, f);
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

export async function refreshPluginOAuthToken(plugin, { fetch: f = fetch } = {}) {
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
    return postTokenForm(plugin.auth.tokenEndpoint, b, f);
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
export async function mcpHttpAuthHeaders(plugin, { fetch: f = fetch, refresh = true, vault } = {}) {
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
