/** OAuth interativo para conectores MCP HTTP (RFC 8414 + metadados do recurso protegido). */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const RIPPER_PUBLISHED_CLIENT_ID = process.env.RIPPER_OAUTH_CLIENT_ID || 'https://ripper.local/oauth/client';

const flowStore = new Map();

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
      resource: resourceMeta?.resource || resource,
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
  if (meta?.client_id_metadata_document_supported && RIPPER_PUBLISHED_CLIENT_ID) {
    return { clientId: RIPPER_PUBLISHED_CLIENT_ID, clientSecret: '' };
  }
  return { clientId: RIPPER_PUBLISHED_CLIENT_ID, clientSecret: '' };
}

async function dynamicClientRegister(asMeta, redirectUri, { fetch: f = fetch } = {}) {
  const ep = asMeta.registration_endpoint;
  if (!ep) throw new Error('Servidor não oferece registro dinâmico de cliente (DCR).');
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
  fetch: f = fetch
}) {
  const as = discovery?.authorizationServer;
  if (!as?.authorization_endpoint || !as?.token_endpoint) {
    throw new Error('Metadados OAuth incompletos. Configure o cliente manualmente ou verifique o servidor.');
  }
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

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: pkce.method
  });
  if (scope) params.set('scope', scope);
  if (discovery.resource && as.authorization_endpoint.includes('resource')) {
    params.set('resource', discovery.resource);
  }

  const authUrl = new URL(as.authorization_endpoint);
  for (const [k, v] of params) authUrl.searchParams.set(k, v);
  const authorizeUrl = authUrl.href;

  flowStore.set(flowId, {
    flowId,
    state,
    codeVerifier: pkce.verifier,
    pluginName: plugin.name,
    redirectUri,
    tokenEndpoint: as.token_endpoint,
    clientId,
    clientSecret,
    createdAt: Date.now(),
    status: 'pending',
    error: null
  });
  pruneFlows();
  return { flowId, authorizeUrl, state };
}

function pruneFlows() {
  const cutoff = Date.now() - 15 * 60_000;
  for (const [id, f] of flowStore) {
    if (f.createdAt < cutoff) flowStore.delete(id);
  }
}

export function getOAuthFlow(flowId) {
  return flowStore.get(flowId) || null;
}

export function findOAuthFlowByState(state) {
  for (const f of flowStore.values()) {
    if (f.status === 'pending' && safeEq(f.state, state)) return f;
  }
  return null;
}

function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function exchangeOAuthCode(flow, code, { fetch: f = fetch } = {}) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: flow.redirectUri,
    client_id: flow.clientId,
    code_verifier: flow.codeVerifier
  });
  if (flow.clientSecret) body.set('client_secret', flow.clientSecret);

  const r = await f(flow.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body
  });
  const j = await r.json().catch(() => ({}));
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

export async function refreshPluginOAuthToken(plugin, { fetch: f = fetch } = {}) {
  const tok = plugin.auth?.oauth;
  if (!tok?.refreshToken || !plugin.auth?.tokenEndpoint) {
    return { ok: false, error: 'Refresh token ou endpoint OAuth ausente.' };
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tok.refreshToken,
    client_id: plugin.auth.clientId || RIPPER_PUBLISHED_CLIENT_ID
  });
  if (plugin.auth.clientSecret) body.set('client_secret', plugin.auth.clientSecret);
  const r = await f(plugin.auth.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body
  });
  const j = await r.json().catch(() => ({}));
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
