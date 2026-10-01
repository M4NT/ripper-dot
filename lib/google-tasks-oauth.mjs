/** OAuth Google para Google Tasks (authorization code + PKCE, alinhado ao fluxo MCP do Ripper). */

import { randomBytes } from 'node:crypto';
import { generatePkce, normalizeTokenResponse } from './mcp-oauth.mjs';

export const GOOGLE_TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';
export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

const flowStore = new Map();

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

export function googleTasksRedirectUri(baseUrl) {
  const base = String(baseUrl || 'http://127.0.0.1:3000').replace(/\/$/, '');
  return `${base}/api/task-sync/google/oauth/callback`;
}

export function resolveGoogleTasksClientConfig(settings) {
  const g = settings?.taskSync?.google || {};
  return {
    clientId: process.env.GOOGLE_TASKS_CLIENT_ID || g.clientId || '',
    clientSecret: process.env.GOOGLE_TASKS_CLIENT_SECRET || g.clientSecret || '',
    taskListId: g.taskListId || '@default',
    enabled: g.enabled !== false
  };
}

export function mergeGoogleTasksAuth(prev, incoming) {
  if (!incoming || typeof incoming !== 'object') return prev;
  const oauth = incoming.oauth && typeof incoming.oauth === 'object'
    ? {
        accessToken: incoming.oauth.accessToken === '••••' ? (prev?.oauth?.accessToken || '') : String(incoming.oauth.accessToken || prev?.oauth?.accessToken || ''),
        refreshToken: incoming.oauth.refreshToken === '••••' ? (prev?.oauth?.refreshToken || '') : String(incoming.oauth.refreshToken || prev?.oauth?.refreshToken || ''),
        tokenType: incoming.oauth.tokenType || prev?.oauth?.tokenType || 'Bearer',
        scope: incoming.oauth.scope || prev?.oauth?.scope || GOOGLE_TASKS_SCOPE,
        expiresAt: Number(incoming.oauth.expiresAt || prev?.oauth?.expiresAt || 0) || undefined
      }
    : prev?.oauth;
  return {
    clientId: String(incoming.clientId ?? prev?.clientId ?? '').slice(0, 200),
    clientSecret: incoming.clientSecret === '••••' ? (prev?.clientSecret || '') : String(incoming.clientSecret ?? prev?.clientSecret ?? '').slice(0, 500),
    taskListId: String(incoming.taskListId ?? prev?.taskListId ?? '@default').slice(0, 120),
    enabled: incoming.enabled !== false,
    oauth
  };
}

export function googleTasksOAuthStatus(settings) {
  const cfg = resolveGoogleTasksClientConfig(settings);
  const oauth = settings?.taskSync?.google?.oauth;
  if (!cfg.clientId) {
    return { state: 'unconfigured', reason: 'Defina GOOGLE_TASKS_CLIENT_ID ou taskSync.google.clientId nas configurações.' };
  }
  if (!oauth?.accessToken) {
    return { state: 'needs_auth', reason: 'Conecte sua conta Google para sincronizar tarefas.' };
  }
  const exp = oauth.expiresAt;
  const now = Date.now();
  if (exp && exp <= now) {
    if (oauth.refreshToken) return { state: 'expired_refreshable', expiresAt: exp, reason: 'Token expirado; o Ripper tentará renovar na próxima sincronização.' };
    return { state: 'expired', expiresAt: exp, reason: 'Token expirado; faça login Google novamente.' };
  }
  if (exp && exp <= now + 5 * 60_000) return { state: 'expiring_soon', expiresAt: exp };
  return { state: 'ok', expiresAt: exp || undefined, taskListId: cfg.taskListId };
}

export function redactGoogleTasksSettings(taskSync) {
  if (!taskSync?.google) return taskSync;
  const g = taskSync.google;
  return {
    ...taskSync,
    google: {
      ...g,
      clientSecret: g.clientSecret ? '••••' : '',
      oauth: g.oauth
        ? {
            ...g.oauth,
            accessToken: g.oauth.accessToken ? '••••' : '',
            refreshToken: g.oauth.refreshToken ? '••••' : ''
          }
        : undefined
    }
  };
}

export async function refreshGoogleTasksToken(settings, { fetch: f = fetch } = {}) {
  const g = settings?.taskSync?.google || {};
  const cfg = resolveGoogleTasksClientConfig(settings);
  const tok = g.oauth;
  if (!tok?.refreshToken) return { ok: false, error: 'Refresh token Google ausente.' };
  if (!cfg.clientId) return { ok: false, error: 'Client ID Google ausente.' };
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tok.refreshToken,
    client_id: cfg.clientId
  });
  if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret);
  const r = await f(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { ok: false, error: j.error_description || j.error || `Refresh HTTP ${r.status}` };
  }
  return { ok: true, tokens: normalizeTokenResponse(j) };
}

export function applyGoogleTokensToSettings(settings, tokens) {
  const prev = settings.taskSync?.google || {};
  return {
    ...settings,
    taskSync: {
      ...(settings.taskSync || {}),
      google: {
        ...prev,
        oauth: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken || prev.oauth?.refreshToken || '',
          tokenType: tokens.tokenType,
          scope: tokens.scope || GOOGLE_TASKS_SCOPE,
          expiresAt: tokens.expiresAt
        }
      }
    }
  };
}

/**
 * @param {{ redirectUri: string, settings: object }} opts
 */
export async function startGoogleTasksOAuthFlow({ redirectUri, settings }) {
  const cfg = resolveGoogleTasksClientConfig(settings);
  if (!cfg.clientId) throw new Error('Client ID Google não configurado.');
  const { verifier, challenge } = generatePkce();
  const state = b64url(randomBytes(16));
  const flowId = b64url(randomBytes(12));
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_TASKS_SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent'
  });
  flowStore.set(flowId, {
    flowId,
    state,
    codeVerifier: verifier,
    redirectUri,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    createdAt: Date.now(),
    status: 'pending',
    error: null
  });
  pruneFlows();
  return { flowId, authorizeUrl: `${GOOGLE_AUTH_ENDPOINT}?${params}`, state };
}

export function getGoogleTasksOAuthFlow(flowId) {
  return flowStore.get(flowId) || null;
}

export function findGoogleTasksOAuthFlowByState(state) {
  for (const f of flowStore.values()) {
    if (f.status === 'pending' && f.state === state) return f;
  }
  return null;
}

export async function exchangeGoogleTasksCode(flow, code, { fetch: f = fetch } = {}) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: flow.redirectUri,
    client_id: flow.clientId,
    code_verifier: flow.codeVerifier
  });
  if (flow.clientSecret) body.set('client_secret', flow.clientSecret);
  const r = await f(GOOGLE_TOKEN_ENDPOINT, {
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

export async function resolveGoogleTasksAccessToken(settings, { fetch: f = fetch, refresh = true } = {}) {
  const oauth = settings?.taskSync?.google?.oauth;
  if (!oauth?.accessToken) return null;
  if (
    refresh &&
    oauth.expiresAt &&
    oauth.expiresAt < Date.now() + 60_000 &&
    oauth.refreshToken
  ) {
    const refreshed = await refreshGoogleTasksToken(settings, { fetch: f });
    if (refreshed.ok && refreshed.tokens?.accessToken) {
      return { accessToken: refreshed.tokens.accessToken, refreshed: refreshed.tokens };
    }
  }
  return { accessToken: oauth.accessToken };
}

export function _clearGoogleTasksOAuthFlows() {
  flowStore.clear();
}

function pruneFlows() {
  const cutoff = Date.now() - 15 * 60_000;
  for (const [id, f] of flowStore) {
    if (f.createdAt < cutoff) flowStore.delete(id);
  }
}
