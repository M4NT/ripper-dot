import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';

import { freePort } from './helpers/free-port.mjs';
import {
  _clearOAuthFlows,
  discoverMcpOAuth,
  exchangeOAuthCode,
  findOAuthFlowByState,
  generatePkce,
  getOAuthFlow,
  oauthAuthorizationServerMetadataUrls,
  startMcpOAuthFlow,
  applyOAuthTokensToPlugin,
  mergePluginAuth,
  mcpHttpAuthHeaders,
  oauthCallbackHtml,
  oauthCallbackScript,
  canonicalizeResource,
  resolveOAuthResource,
  resourceMatchesMcpUrl,
  isSafeOutboundUrl,
  isPrivateOrInternalHost,
  refreshPluginOAuthToken,
  OAUTH_FLOW_TTL_MS
} from '../lib/mcp-oauth.mjs';

function publicDiscovery(overrides = {}) {
  return {
    found: true,
    resource: 'https://mcp.example.com/mcp',
    authorizationServer: {
      authorization_endpoint: 'https://idp.example.com/authorize',
      token_endpoint: 'https://idp.example.com/token',
      ...overrides
    }
  };
}

test('generatePkce produz verifier e challenge S256', () => {
  const { verifier, challenge, method } = generatePkce();
  assert.equal(method, 'S256');
  assert.ok(verifier.length > 20);
  assert.ok(challenge.length > 20);
});

test('oauthAuthorizationServerMetadataUrls inclui path do recurso', () => {
  const urls = oauthAuthorizationServerMetadataUrls('https://mcp.example.com/v1/mcp');
  assert.ok(urls.some(u => u.includes('oauth-authorization-server/v1/mcp')));
});

test('discoverMcpOAuth lê metadados RFC 8414', async () => {
  const asMeta = {
    authorization_endpoint: 'https://idp.test/authorize',
    token_endpoint: 'https://idp.test/token',
    scopes_supported: ['mcp']
  };
  const fetch = async url => {
    if (String(url).includes('oauth-authorization-server')) {
      return { ok: true, json: async () => asMeta, headers: new Headers() };
    }
    return { ok: false, json: async () => null, headers: new Headers() };
  };
  const d = await discoverMcpOAuth('https://mcp.example.com/mcp', { fetch });
  assert.equal(d.found, true);
  assert.equal(d.authorizationServer.token_endpoint, 'https://idp.test/token');
});

test('fluxo OAuth feliz com IdP falso', async () => {
  _clearOAuthFlows();
  const prev = process.env.RIPPER_OAUTH_ALLOW_PRIVATE;
  process.env.RIPPER_OAUTH_ALLOW_PRIVATE = '1';
  let lastTokenBody = '';
  let port;
  const srv = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/.well-known/oauth-authorization-server') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        authorization_endpoint: `http://127.0.0.1:${port}/authorize`,
        token_endpoint: `http://127.0.0.1:${port}/token`
      }));
      return;
    }
    if (u.pathname === '/authorize') {
      const redirect = u.searchParams.get('redirect_uri');
      const state = u.searchParams.get('state');
      res.writeHead(302, { location: `${redirect}?code=fake-code&state=${state}` });
      res.end();
      return;
    }
    if (u.pathname === '/token' && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      lastTokenBody = Buffer.concat(chunks).toString();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, token_type: 'Bearer' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  port = await new Promise((resolve, reject) => {
    srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
    srv.on('error', reject);
  });

  const discovery = await discoverMcpOAuth(`https://127.0.0.1:${port}/mcp`, {
    fetch: async url => fetch(url.replace('https://', 'http://'))
  });
  const plugin = { name: 'demo', type: 'http', url: `https://127.0.0.1:${port}/mcp`, auth: { oauthClient: 'custom', clientId: 'cid', clientSecret: '' } };
  const redirectUri = `http://127.0.0.1:${port}/cb`;
  const { flowId, authorizeUrl, state } = await startMcpOAuthFlow({ plugin, discovery, redirectUri });
  const flow = findOAuthFlowByState(state);
  assert.ok(flow);
  const r = await fetch(authorizeUrl.replace('https://', 'http://'), { redirect: 'manual' });
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  const tokens = await exchangeOAuthCode(flow, loc.searchParams.get('code'));
  assert.equal(tokens.accessToken, 'at-1');
  assert.match(lastTokenBody, /code_verifier=/);
  flow.status = 'complete';
  const merged = applyOAuthTokensToPlugin(plugin, tokens, flow);
  assert.equal(merged.auth.oauth.accessToken, 'at-1');
  const headers = await mcpHttpAuthHeaders(merged, { refresh: false });
  assert.match(headers.authorization, /Bearer at-1/);
  srv.close();
  _clearOAuthFlows();
  if (prev === undefined) delete process.env.RIPPER_OAUTH_ALLOW_PRIVATE;
  else process.env.RIPPER_OAUTH_ALLOW_PRIVATE = prev;
});

test('state mismatch não encontra fluxo', () => {
  _clearOAuthFlows();
  assert.equal(findOAuthFlowByState('wrong'), null);
});

test('mergePluginAuth preserva segredos com máscara', () => {
  const prev = { clientSecret: 'sec', oauth: { accessToken: 'tok', refreshToken: 'ref' } };
  const next = mergePluginAuth(prev, { clientSecret: '••••', oauth: { accessToken: '••••', refreshToken: '••••' } });
  assert.equal(next.clientSecret, 'sec');
  assert.equal(next.oauth.accessToken, 'tok');
});

test('callback OAuth via servidor Ripper', async () => {
  _clearOAuthFlows();
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-oauth-'));
  const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));
  let idpPort;
  const idp = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const mcp = `http://127.0.0.1:${idpPort}/mcp`;
    if (u.pathname === '/.well-known/oauth-protected-resource') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ resource: mcp, authorization_servers: [`http://127.0.0.1:${idpPort}`] }));
      return;
    }
    if (u.pathname === '/.well-known/oauth-authorization-server') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        authorization_endpoint: `http://127.0.0.1:${idpPort}/authorize`,
        token_endpoint: `http://127.0.0.1:${idpPort}/token`
      }));
      return;
    }
    if (u.pathname === '/token' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'srv-at', expires_in: 60, token_type: 'Bearer' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  idpPort = await new Promise(r => idp.listen(0, '127.0.0.1', () => r(idp.address().port)));
  const mcpUrl = `http://127.0.0.1:${idpPort}/mcp`;

  const ripperListen = await freePort();
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      RIPPER_DATA: dataDir,
      PORT: String(ripperListen),
      HOST: '127.0.0.1',
      RIPPER_TOKEN: 'oauth-test',
      RIPPER_OAUTH_ALLOW_PRIVATE: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const base = `http://127.0.0.1:${ripperListen}`;
  const auth = { authorization: 'Bearer oauth-test' };
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const h = await fetch(`${base}/api/health`, { headers: auth });
      if (h.ok) break;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  if (Date.now() >= deadline) {
    child.kill('SIGTERM');
    throw new Error('ripper não subiu');
  }

  await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      plugins: [{
        name: 'oauth-demo',
        type: 'http',
        url: mcpUrl,
        enabled: true,
        auth: { mode: 'oauth_now', oauthClient: 'custom', clientId: 'c1' }
      }]
    })
  });

  const started = await fetch(`${base}/api/mcp/oauth/start`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      pluginName: 'oauth-demo',
      url: 'https://evil.example/steal',
      discovery: {
        found: true,
        authorizationServer: {
          authorization_endpoint: 'https://evil.example/authorize',
          token_endpoint: 'https://evil.example/token'
        }
      }
    })
  }).then(r => r.json());
  assert.match(started.authorizeUrl, new RegExp(`127\\.0\\.0\\.1:${idpPort}`));
  assert.doesNotMatch(started.authorizeUrl, /evil\.example/);

  const denied = await fetch(`${base}/api/mcp/oauth/callback?error=access_denied&error_description=${encodeURIComponent('</script><script>alert(1)</script>')}&state=${started.state}`);
  assert.equal(denied.status, 400);
  const deniedHtml = await denied.text();
  assert.match(denied.headers.get('content-security-policy') || '', /script-src 'self'/);
  assert.match(deniedHtml, /src="\/oauth-callback\.js"/);
  assert.doesNotMatch(deniedHtml, /<script>alert/);
  assert.doesNotMatch(deniedHtml, /postMessage/);

  const jsRes = await fetch(`${base}/oauth-callback.js`);
  assert.equal(jsRes.status, 200);
  assert.match(jsRes.headers.get('content-type') || '', /javascript/);
  assert.match(jsRes.headers.get('content-security-policy') || '', /script-src 'self'/);
  const js = await jsRes.text();
  assert.match(js, /window\.close/);
  assert.match(js, /postMessage/);
  assert.equal(js, oauthCallbackScript());

  const sessionStart = await fetch(`${base}/api/mcp/oauth/start`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json', cookie: 'ripper_session=dono-1' },
    body: JSON.stringify({ pluginName: 'oauth-demo' })
  }).then(r => r.json());
  const stolen = await fetch(`${base}/api/mcp/oauth/callback?code=abc&state=${sessionStart.state}`);
  assert.equal(stolen.status, 400);
  const owned = await fetch(`${base}/api/mcp/oauth/callback?code=abc&state=${sessionStart.state}`, {
    headers: { cookie: 'ripper_session=dono-1' }
  });
  assert.equal(owned.status, 200);
  const st = await fetch(`${base}/api/mcp/oauth/status/${sessionStart.flowId}`, { headers: auth }).then(r => r.json());
  assert.equal(st.status, 'complete');

  const bad = await fetch(`${base}/api/mcp/oauth/callback?code=x&state=bad-state`);
  assert.equal(bad.status, 400);

  child.kill('SIGTERM');
  await new Promise(r => child.on('exit', r));
  idp.close();
  _clearOAuthFlows();
});

test('callback OAuth: error_description vindo da URL é escapado antes de ir para o HTML', async () => {
  const { escapeHtml } = await import('../lib/mcp-oauth.mjs');
  assert.equal(escapeHtml('<script>alert("x")</script>&\''), '&#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62;&#38;&#39;');
  assert.equal(escapeHtml(undefined), '');
});

test('resource canônico e validado contra a URL do MCP', () => {
  assert.equal(canonicalizeResource('https://MCP.Example.com:443/mcp#x'), 'https://mcp.example.com/mcp');
  assert.equal(resourceMatchesMcpUrl('https://mcp.example.com/mcp', 'https://mcp.example.com/mcp/'), true);
  assert.equal(resourceMatchesMcpUrl('https://evil.example/mcp', 'https://mcp.example.com/mcp'), false);
  assert.equal(resolveOAuthResource('https://evil.example/other', 'https://mcp.example.com/mcp'), 'https://mcp.example.com/mcp');
  assert.equal(resolveOAuthResource('https://mcp.example.com/mcp', 'https://mcp.example.com/mcp'), 'https://mcp.example.com/mcp');
});

test('SSRF: descoberta e DCR não seguem endereço interno', async () => {
  const fetched = [];
  const fetch = async url => {
    fetched.push(String(url));
    return { ok: false, json: async () => null };
  };
  const headers = new Headers({
    'www-authenticate': 'Bearer realm="mcp", resource_metadata="http://169.254.169.254/latest/meta-data"'
  });
  await discoverMcpOAuth('https://mcp.example.com/mcp', { fetch, probeHeaders: headers });
  assert.ok(!fetched.some(u => u.includes('169.254') || u.includes('127.0.0.1')));
  assert.equal(isPrivateOrInternalHost('169.254.169.254'), true);
  assert.equal(isPrivateOrInternalHost('127.0.0.1'), true);
  assert.equal(isPrivateOrInternalHost('10.1.2.3'), true);
  assert.equal(isSafeOutboundUrl('http://169.254.169.254/x'), false);
  assert.equal(isSafeOutboundUrl('https://mcp.example.com/mcp'), true);

  _clearOAuthFlows();
  await assert.rejects(
    () => startMcpOAuthFlow({
      plugin: { name: 'x', url: 'https://mcp.example.com/mcp', auth: { oauthClient: 'dcr' } },
      discovery: publicDiscovery({ registration_endpoint: 'http://127.0.0.1:9/register' }),
      redirectUri: 'https://ripper.example/cb'
    }),
    /bloqueada|HTTPS/
  );
});

test('state expirado não vale; sessão do dono é exigida', async () => {
  _clearOAuthFlows();
  const plugin = { name: 'demo', url: 'https://mcp.example.com/mcp', auth: { oauthClient: 'custom', clientId: 'cid' } };
  const { state, flowId } = await startMcpOAuthFlow({
    plugin,
    discovery: publicDiscovery(),
    redirectUri: 'https://ripper.example/cb',
    sessionKey: 's:abc'
  });
  assert.equal(findOAuthFlowByState(state), null);
  assert.equal(findOAuthFlowByState(state, { sessionKey: 's:other' }), null);
  assert.ok(findOAuthFlowByState(state, { sessionKey: 's:abc' }));
  const flow = getOAuthFlow(flowId);
  flow.createdAt = Date.now() - OAUTH_FLOW_TTL_MS - 1000;
  assert.equal(findOAuthFlowByState(state, { sessionKey: 's:abc' }), null);
  _clearOAuthFlows();
});

test('refresh reusa auth.resource validado e cai fora se invalid_target', async () => {
  let bodies = [];
  const fetch = async (_url, init) => {
    bodies.push(String(init.body));
    if (bodies.length === 1) return { ok: false, status: 400, json: async () => ({ error: 'invalid_target' }) };
    return { ok: true, json: async () => ({ access_token: 'n', refresh_token: 'r2', expires_in: 60 }) };
  };
  const r = await refreshPluginOAuthToken({
    url: 'https://mcp.example.com/mcp',
    auth: {
      tokenEndpoint: 'https://idp.example.com/token',
      resource: 'https://mcp.example.com/mcp',
      oauth: { refreshToken: 'rt' }
    }
  }, { fetch });
  assert.equal(r.ok, true);
  assert.match(bodies[0], /resource=https%3A%2F%2Fmcp.example.com%2Fmcp/);
  assert.doesNotMatch(bodies[1], /resource=/);

  bodies = [];
  await refreshPluginOAuthToken({
    url: 'https://mcp.example.com/mcp',
    auth: {
      tokenEndpoint: 'https://idp.example.com/token',
      resource: 'https://evil.example/other',
      oauth: { refreshToken: 'rt' }
    }
  }, { fetch: async (_url, init) => {
    bodies.push(String(init.body));
    return { ok: true, json: async () => ({ access_token: 'n', expires_in: 60 }) };
  } });
  assert.match(bodies[0], /resource=https%3A%2F%2Fmcp.example.com%2Fmcp/);
  assert.doesNotMatch(bodies[0], /evil/);
});

test('applyOAuthTokensToPlugin guarda resource para o refresh', async () => {
  const plugin = { name: 'demo', url: 'https://mcp.example.com/mcp', auth: { mode: 'oauth_now' } };
  const merged = applyOAuthTokensToPlugin(plugin, {
    accessToken: 'at',
    refreshToken: 'rt',
    tokenType: 'Bearer',
    scope: 'mcp',
    expiresAt: Date.now() + 1000
  }, { clientId: 'c', tokenEndpoint: 'https://idp.example.com/token', resource: 'https://mcp.example.com/mcp' });
  assert.equal(merged.auth.resource, 'https://mcp.example.com/mcp');
});
