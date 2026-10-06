import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}
import {
  _clearOAuthFlows,
  discoverMcpOAuth,
  exchangeOAuthCode,
  findOAuthFlowByState,
  generatePkce,
  oauthAuthorizationServerMetadataUrls,
  startMcpOAuthFlow,
  applyOAuthTokensToPlugin,
  mergePluginAuth,
  mcpHttpAuthHeaders
} from '../lib/mcp-oauth.mjs';

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
    if (u.pathname === '/token' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'srv-at', expires_in: 60, token_type: 'Bearer' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  idpPort = await new Promise(r => idp.listen(0, '127.0.0.1', () => r(idp.address().port)));

  const ripperListen = await freePort();
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(ripperListen), HOST: '127.0.0.1', RIPPER_TOKEN: 'oauth-test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const base = `http://127.0.0.1:${ripperListen}`;
  const auth = { authorization: 'Bearer oauth-test' };
  const deadline = Date.now() + 15_000;
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

  const discovery = {
    found: true,
    authorizationServer: {
      authorization_endpoint: `${base}/noop-authorize`,
      token_endpoint: `http://127.0.0.1:${idpPort}/token`
    }
  };
  await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      plugins: [{
        name: 'oauth-demo',
        type: 'http',
        url: 'https://mcp.example.com/mcp',
        enabled: true,
        auth: { mode: 'oauth_now', oauthClient: 'custom', clientId: 'c1' }
      }]
    })
  });

  const started = await fetch(`${base}/api/mcp/oauth/start`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ pluginName: 'oauth-demo', discovery })
  }).then(r => r.json());

  const denied = await fetch(`${base}/api/mcp/oauth/callback?error=access_denied&state=${started.state}`);
  assert.equal(denied.status, 400);

  const started2 = await fetch(`${base}/api/mcp/oauth/start`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ pluginName: 'oauth-demo', discovery })
  }).then(r => r.json());
  const cb = await fetch(`${base}/api/mcp/oauth/callback?code=abc&state=${started2.state}`);
  assert.equal(cb.status, 200);
  const st = await fetch(`${base}/api/mcp/oauth/status/${started2.flowId}`, { headers: auth }).then(r => r.json());
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
