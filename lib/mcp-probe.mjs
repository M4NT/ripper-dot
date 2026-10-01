/** Sonda HTTP/stdio MCP para conectores personalizados — pass/fail explícito, sem falsos positivos. */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
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
    return { ok: r.ok, status: r.status, json, raw: text.slice(0, 400), headers: r.headers, rpcError: json?.error?.message };
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

async function mcpListToolsHttp(url, headers = {}, f = fetch) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  try {
    const r = await f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: MCP_ACCEPT, ...headers },
      body,
      signal: AbortSignal.timeout(6000)
    });
    const j = await r.json().catch(() => null);
    if (j?.error) return { tools: [], error: j.error.message || 'tools/list falhou' };
    const list = j?.result?.tools;
    if (!Array.isArray(list)) return { tools: [], error: 'Resposta tools/list inválida' };
    return { tools: list.map(t => t.name).filter(Boolean).slice(0, 80) };
  } catch (e) {
    return { tools: [], error: e?.message || 'tools/list timeout' };
  }
}

function finalizeHttpResult({ steps, init, login, tools, listTools }) {
  const initOk = init.ok && init.json?.result && !init.json?.error;
  if (initOk) {
    steps.push(step('login_meta', 'ok', 'Protocolo MCP'));
    steps.push(step('login_provider', login.found ? 'ok' : 'skipped', login.found ? 'OAuth detectado' : 'Não detectado'));
    if (init.json.result?.serverInfo?.name) {
      const connectStep = steps.find(s => s.id === 'connect');
      if (connectStep) connectStep.detail = init.json.result.serverInfo.name;
    }
    if (listTools && tools?.length) steps.push(step('tools', 'ok', `${tools.length} ferramenta(s)`));
    else if (listTools) steps.push(step('tools', 'skipped', 'Nenhuma ferramenta listada'));
    return {
      ok: true,
      verified: true,
      steps,
      login,
      tools: tools?.length ? tools : undefined,
      detail: 'Initialize MCP concluído.'
    };
  }

  if (login.found) {
    steps.push(step('login_meta', 'ok', login.discovery?.authorizationServer ? 'Metadados OAuth' : 'Indício de OAuth'));
    steps.push(step('login_provider', 'ok', 'Login OAuth necessário'));
    steps.push(step('tools', 'skipped', 'Requer login'));
    return {
      ok: false,
      verified: false,
      oauthRequired: true,
      steps,
      login,
      failureReason: 'Servidor exige OAuth antes do handshake MCP.',
      warning: 'Servidor MCP exige login OAuth antes de listar ferramentas.'
    };
  }

  const failDetail = init.rpcError || (init.status ? `HTTP ${init.status}` : init.error) || 'Sem resposta MCP JSON';
  steps.push(step('login_meta', 'error', failDetail));
  steps.push(step('login_provider', 'skipped', 'Ignorado'));
  steps.push(step('tools', 'skipped', 'Ignorado'));
  return {
    ok: false,
    verified: false,
    steps,
    failureReason: failDetail,
    warning: 'Não foi possível concluir initialize MCP neste servidor.'
  };
}

/**
 * @param {string} rawUrl
 * @param {{ plugin?: object, fetch?: typeof fetch, listTools?: boolean, refreshOAuth?: boolean }} [opts]
 */
export async function verifyMcpServer(rawUrl, opts = {}) {
  let url;
  try {
    url = new URL(String(rawUrl).trim());
    if (url.protocol !== 'https:') throw new Error('HTTPS obrigatório.');
  } catch (e) {
    return {
      ok: false,
      verified: false,
      steps: [step('connect', 'error', e.message || 'URL inválida')],
      failureReason: e.message || 'URL inválida',
      warning: 'URL inválida. Use HTTPS terminando em /mcp quando possível.'
    };
  }

  const f = opts.fetch || fetch;
  const authHeaders = opts.plugin
    ? await mcpHttpAuthHeaders(opts.plugin, { refresh: !!opts.refreshOAuth, fetch: f })
    : {};

  const steps = [];
  const connect = await fetchProbe(url.href, { headers: authHeaders, fetch: f });
  if (!connect.ok && connect.status !== 401 && connect.status !== 403) {
    const detail = connect.status ? `HTTP ${connect.status}` : connect.error || 'Falha de rede';
    steps.push(step('connect', 'error', detail, { httpStatus: connect.status || undefined }));
    steps.push(step('login_meta', 'skipped', 'Ignorado'));
    steps.push(step('login_provider', 'skipped', 'Ignorado'));
    return {
      ok: false,
      verified: false,
      steps,
      failureReason: detail,
      warning: 'Não foi possível contactar o servidor MCP.'
    };
  }
  if (connect.ok) {
    steps.push(step('connect', 'ok', 'Conectado', { httpStatus: connect.status }));
  } else {
    steps.push(step('connect', 'ok', `Autenticação exigida (HTTP ${connect.status})`, { httpStatus: connect.status }));
  }

  const init = await mcpInitialize(url.href, authHeaders, f);
  const login = await resolveLogin(url.href, connect.headers, init.headers, init.json, f);
  let tools;
  if (init.ok && init.json?.result) {
    if (opts.listTools !== false) {
      const listed = await mcpListToolsHttp(url.href, authHeaders, f);
      tools = listed.tools;
      if (listed.error && !tools.length) {
        steps.push(step('tools', 'error', listed.error));
      }
    }
  }
  return finalizeHttpResult({ steps, init, login, tools, listTools: opts.listTools !== false });
}

/** Sonda processo MCP stdio (initialize + tools/list). */
export async function verifyMcpStdio(plugin, opts = {}) {
  const steps = [];
  const command = String(plugin.command || '').trim();
  const args = (plugin.args || []).map(String);
  if (!command) {
    return {
      ok: false,
      verified: false,
      steps: [step('spawn', 'error', 'Comando ausente')],
      failureReason: 'Comando stdio ausente.'
    };
  }

  steps.push(step('spawn', 'ok', [command, ...args].join(' ').slice(0, 120)));

  let client;
  try {
    const transport = new StdioClientTransport({ command, args, stderr: 'pipe' });
    client = new Client({ name: 'ripper-dot-probe', version: '1.0.0' });
    const ac = AbortSignal.timeout(opts.timeout || 12_000);
    await Promise.race([
      client.connect(transport),
      new Promise((_, rej) => { ac.addEventListener('abort', () => rej(new Error('timeout'))); })
    ]);
    steps.push(step('initialize', 'ok', 'Handshake MCP stdio'));
    let tools;
    if (opts.listTools !== false) {
      const listed = await client.listTools();
      tools = (listed.tools || []).map(t => t.name).filter(Boolean).slice(0, 80);
      steps.push(step('tools', tools.length ? 'ok' : 'skipped', tools.length ? `${tools.length} ferramenta(s)` : 'Nenhuma ferramenta'));
    }
    await client.close().catch(() => {});
    return {
      ok: true,
      verified: true,
      steps,
      tools: tools?.length ? tools : undefined,
      detail: 'Processo MCP stdio respondeu.'
    };
  } catch (e) {
    steps.push(step('initialize', 'error', e?.message || 'Falha no stdio'));
    steps.push(step('tools', 'skipped', 'Ignorado'));
    try { await client?.close(); } catch {}
    return {
      ok: false,
      verified: false,
      steps,
      failureReason: e?.message || 'Falha ao iniciar MCP stdio.',
      warning: 'Verifique comando, args e dependências do servidor MCP.'
    };
  }
}

/** Despachante HTTP / stdio para API e catálogo. */
export async function verifyMcpConnector(pluginOrUrl, opts = {}) {
  if (typeof pluginOrUrl === 'string') return verifyMcpServer(pluginOrUrl, opts);
  const p = pluginOrUrl;
  if (p.type === 'stdio') return verifyMcpStdio(p, opts);
  if (p.url) return verifyMcpServer(p.url, { ...opts, plugin: p });
  return {
    ok: false,
    verified: false,
    steps: [step('connect', 'error', 'URL ou comando ausente')],
    failureReason: 'Conector sem URL ou comando.'
  };
}
