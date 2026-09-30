/** Sonda HTTP/MCP para o fluxo “Adicionar conector personalizado”. */

import { discoverMcpOAuth, mcpHttpAuthHeaders } from './mcp-oauth.mjs';

const MCP_ACCEPT = 'application/json, text/event-stream';

function step(id, status, detail, extra = {}) {
  return { id, status, detail, ...extra };
}

async function fetchProbe(url, { method = 'GET', headers = {}, timeout = 8000, fetch: f = fetch } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await f(url, { method, headers: { accept: MCP_ACCEPT, ...headers }, redirect: 'follow', signal: ac.signal });
    return { ok: r.ok, status: r.status, headers: r.headers };
  } catch (e) {
    return { ok: false, status: 0, error: e?.name === 'AbortError' ? 'timeout' : (e?.message || 'network') };
  } finally {
    clearTimeout(t);
  }
}

async function mcpInitialize(url, headers = {}, f = fetch) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ripper-dot', version: '1.0.0' }
    }
  });
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: MCP_ACCEPT, ...headers },
      body,
      signal: ac.signal
    });
    const text = await r.text().catch(() => '');
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    return { ok: r.ok, status: r.status, json, raw: text.slice(0, 400), headers: r.headers };
  } catch (e) {
    return { ok: false, status: 0, error: e?.name === 'AbortError' ? 'timeout' : (e?.message || 'network') };
  } finally {
    clearTimeout(t);
  }
}

function guessOAuth(meta) {
  const h = meta?.headers;
  const www = h?.get?.('www-authenticate') || '';
  if (/bearer/i.test(www) || /oauth/i.test(www)) return { found: true, provider: 'oauth_header' };
  const link = h?.get?.('link') || '';
  if (/oauth/i.test(link) || /\.well-known\/oauth/i.test(link)) return { found: true, provider: 'oauth_metadata' };
  if (meta?.json?.result?.capabilities?.authentication) return { found: true, provider: 'mcp_auth_capability' };
  return { found: false };
}

async function resolveLogin(url, connectHeaders, initHeaders, initJson, f = fetch) {
  const mergedHeaders = initHeaders || connectHeaders;
  const quick = guessOAuth({ headers: mergedHeaders, json: initJson });
  const discovery = await discoverMcpOAuth(url, { probeHeaders: mergedHeaders, fetch: f });
  if (discovery.found) {
    return {
      found: true,
      provider: discovery.provider || quick.provider,
      discovery,
      requiresAuth: !initJson?.result
    };
  }
  return { ...quick, requiresAuth: false };
}

/**
 * @param {string} rawUrl
 * @param {{ plugin?: object }} [opts] plugin com credenciais OAuth opcionais
 * @returns {Promise<{ ok: boolean, steps: object[], login?: object, tools?: string[], warning?: string }>}
 */
export async function verifyMcpServer(rawUrl, opts = {}) {
  let url;
  try {
    url = new URL(String(rawUrl).trim());
    if (url.protocol !== 'https:') throw new Error('HTTPS obrigatório.');
  } catch (e) {
    return {
      ok: false,
      steps: [step('connect', 'error', e.message || 'URL inválida')],
      warning: 'URL inválida. Use HTTPS terminando em /mcp quando possível.'
    };
  }

  const f = opts.fetch || fetch;
  const authHeaders = opts.plugin ? await mcpHttpAuthHeaders(opts.plugin, { refresh: false, fetch: f }) : {};

  const steps = [];
  const connect = await fetchProbe(url.href, { headers: authHeaders, fetch: f });
  if (!connect.ok && connect.status !== 401) {
    steps.push(step('connect', 'error', connect.status ? `HTTP ${connect.status}` : connect.error || 'Falha de rede', { httpStatus: connect.status || undefined }));
    steps.push(step('login_meta', 'skipped', 'Ignorado'));
    steps.push(step('login_provider', 'skipped', 'Ignorado'));
    return {
      ok: false,
      steps,
      warning: 'Não foi possível verificar o servidor. Você pode continuar e configurá-lo manualmente.'
    };
  }
  if (connect.ok) {
    steps.push(step('connect', 'ok', 'Conectado', { httpStatus: connect.status }));
  } else {
    steps.push(step('connect', 'ok', 'Servidor exige autenticação', { httpStatus: connect.status }));
  }

  const init = await mcpInitialize(url.href, authHeaders, f);
  const login = await resolveLogin(url.href, connect.headers, init.headers, init.json, f);

  if (init.ok && init.json?.result) {
    steps.push(step('login_meta', 'ok', 'Protocolo MCP'));
    steps.push(step('login_provider', login.found ? 'ok' : 'skipped', login.found ? 'OAuth detectado' : 'Não detectado'));
    if (init.json.result?.serverInfo?.name) {
      steps[0].detail = init.json.result.serverInfo.name;
    }
    const listed = await mcpListTools(url.href, authHeaders, f);
    const tools = listed?.length ? listed : undefined;
    return { ok: true, steps, login, tools };
  }

  if (login.found) {
    steps.push(step('login_meta', 'ok', login.discovery?.authorizationServer ? 'Metadados OAuth' : 'Indício de OAuth'));
    steps.push(step('login_provider', 'ok', 'Login OAuth necessário'));
    return {
      ok: true,
      steps,
      login,
      warning: login.requiresAuth ? 'Servidor MCP exige login OAuth antes de listar ferramentas.' : undefined
    };
  }

  steps.push(step('login_meta', 'skipped', init.status ? `HTTP ${init.status}` : init.error || 'Sem MCP JSON'));
  steps.push(step('login_provider', 'skipped', 'Ignorado'));
  return {
    ok: false,
    steps,
    warning: 'Não foi possível determinar como este servidor faz login. Configure manualmente se necessário.'
  };
}

async function mcpListTools(url, headers = {}, f = fetch) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  try {
    const r = await f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: MCP_ACCEPT, ...headers },
      body,
      signal: AbortSignal.timeout(6000)
    });
    const j = await r.json().catch(() => null);
    const list = j?.result?.tools;
    if (!Array.isArray(list)) return [];
    return list.map(t => t.name).filter(Boolean).slice(0, 40);
  } catch {
    return [];
  }
}
