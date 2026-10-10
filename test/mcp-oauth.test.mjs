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
  isBlockedIp,
  resolvePublicAddresses,
  safeFetch,
  refreshPluginOAuthToken,
  oauthBindingCookie,
  oauthCookieName,
  readOAuthBindingCookie,
  OAUTH_COOKIE_NAME,
  OAUTH_CALLBACK_PATH,
  OAUTH_FLOW_TTL_MS,
  OAUTH_FETCH_MAX_BODY
} from '../lib/mcp-oauth.mjs';

function setCookieLines(res) {
  return typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
}

function oauthCookieHeader(res, state) {
  const prefix = state ? `${OAUTH_COOKIE_NAME}_${state}=` : `${OAUTH_COOKIE_NAME}_`;
  return setCookieLines(res).find(c => c.startsWith(prefix)) || '';
}

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
  const { flowId, authorizeUrl, state, cookieRaw } = await startMcpOAuthFlow({ plugin, discovery, redirectUri });
  const flow = findOAuthFlowByState(state, { cookie: cookieRaw });
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

  const startRes = await fetch(`${base}/api/mcp/oauth/start`, {
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
  });
  const startedCookie = oauthCookieHeader(startRes);
  assert.match(startedCookie, /HttpOnly/);
  assert.match(startedCookie, /SameSite=Lax/);
  assert.match(startedCookie, new RegExp(`Path=${OAUTH_CALLBACK_PATH.replace(/\//g, '\\/')}`));
  assert.doesNotMatch(startedCookie, /ripper_session|SameSite=Strict/);
  const started = await startRes.json();
  assert.match(startedCookie, new RegExp(`^${OAUTH_COOKIE_NAME}_${started.state}=`));
  assert.equal(started.cookieRaw, undefined);
  assert.match(started.authorizeUrl, new RegExp(`127\\.0\\.0\\.1:${idpPort}`));
  assert.doesNotMatch(started.authorizeUrl, /evil\.example/);

  const denied = await fetch(`${base}/api/mcp/oauth/callback?error=access_denied&error_description=${encodeURIComponent('</script><script>alert(1)</script>')}&state=${started.state}`, {
    headers: { cookie: startedCookie.split(';')[0] }
  });
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

  const bindRes = await fetch(`${base}/api/mcp/oauth/start`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ pluginName: 'oauth-demo' })
  });
  const bound = await bindRes.json();
  const bindCookie = oauthCookieHeader(bindRes, bound.state);
  assert.match(bindCookie, new RegExp(`^${OAUTH_COOKIE_NAME}_${bound.state}=`));
  const stolen = await fetch(`${base}/api/mcp/oauth/callback?code=abc&state=${bound.state}`);
  assert.equal(stolen.status, 400);
  const owned = await fetch(`${base}/api/mcp/oauth/callback?code=abc&state=${bound.state}`, {
    headers: { cookie: bindCookie.split(';')[0] }
  });
  assert.equal(owned.status, 200);
  assert.match(owned.headers.get('set-cookie') || '', /Max-Age=0/);
  const replay = await fetch(`${base}/api/mcp/oauth/callback?code=abc&state=${bound.state}`, {
    headers: { cookie: bindCookie.split(';')[0] }
  });
  assert.equal(replay.status, 400);
  const st = await fetch(`${base}/api/mcp/oauth/status/${bound.flowId}`, { headers: auth }).then(r => r.json());
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
  assert.equal(isBlockedIp('::ffff:7f00:1'), true);
  assert.equal(isBlockedIp('::ffff:a9fe:a9fe'), true);
  assert.equal(isBlockedIp('::ffff:169.254.169.254'), true);
  assert.equal(isBlockedIp('fe90::1'), true);
  assert.equal(isBlockedIp('fe80::1'), true);
  assert.equal(isBlockedIp('224.0.0.1'), true);
  assert.equal(isBlockedIp('239.255.255.255'), true);
  assert.equal(isBlockedIp('240.0.0.1'), true);
  assert.equal(isBlockedIp('255.255.255.255'), true);
  assert.equal(isBlockedIp('2002:c000:201::1'), true);
  assert.equal(isBlockedIp('64:ff9b::c000:201'), true);
  assert.equal(isBlockedIp('8.8.8.8'), false);
  assert.equal(isBlockedIp('2001:4860:4860::8888'), false);

  await assert.rejects(
    () => resolvePublicAddresses('127.0.0.1.nip.io', {
      lookupFn: async () => [{ address: '127.0.0.1', family: 4 }]
    }),
    /bloqueada/
  );
  await assert.rejects(
    () => resolvePublicAddresses('ok.example', {
      lookupFn: async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '::ffff:a9fe:a9fe', family: 6 }
      ]
    }),
    /bloqueada/
  );

  const nipHits = [];
  await discoverMcpOAuth('https://127.0.0.1.nip.io/mcp', {
    fetch: async url => { nipHits.push(String(url)); return { ok: false, json: async () => null }; },
    lookupFn: async () => [{ address: '127.0.0.1', family: 4 }]
  });
  assert.equal(nipHits.length, 0);

  const hops = [];
  await assert.rejects(
    () => safeFetch('https://cdn.example/meta', {}, {
      lookupFn: async host => (host === 'cdn.example'
        ? [{ address: '203.0.113.10', family: 4 }]
        : [{ address: '169.254.169.254', family: 4 }]),
      fetch: async url => {
        hops.push(String(url));
        if (String(url).includes('cdn.example')) {
          return {
            ok: false,
            status: 302,
            headers: new Headers({ location: 'https://169.254.169.254/latest' }),
            arrayBuffer: async () => new ArrayBuffer(0)
          };
        }
        return { ok: true, status: 200, json: async () => ({ pwned: true }) };
      }
    }),
    /bloqueada/
  );
  assert.deepEqual(hops, ['https://cdn.example/meta']);

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

test('state expirado não vale; cookie OAuth é exigido e de uso único', async () => {
  _clearOAuthFlows();
  const plugin = { name: 'demo', url: 'https://mcp.example.com/mcp', auth: { oauthClient: 'custom', clientId: 'cid' } };
  const { state, cookieRaw } = await startMcpOAuthFlow({
    plugin,
    discovery: publicDiscovery(),
    redirectUri: 'https://ripper.example/cb'
  });
  const setCookie = oauthBindingCookie(cookieRaw, { state });
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, new RegExp(`Path=${OAUTH_CALLBACK_PATH.replace(/\//g, '\\/')}`));
  assert.match(setCookie, new RegExp(`^${OAUTH_COOKIE_NAME}_${state}=`));
  assert.throws(() => oauthBindingCookie(cookieRaw), /state OAuth ausente/);
  assert.equal(findOAuthFlowByState(state), null);
  assert.equal(findOAuthFlowByState(state, { cookie: 'errado' }), null);
  assert.ok(findOAuthFlowByState(state, { cookie: cookieRaw }));
  assert.equal(findOAuthFlowByState(state, { cookie: cookieRaw }), null);

  const again = await startMcpOAuthFlow({ plugin, discovery: publicDiscovery(), redirectUri: 'https://ripper.example/cb' });
  const flow = getOAuthFlow(again.flowId);
  flow.createdAt = Date.now() - OAUTH_FLOW_TTL_MS - 1000;
  assert.equal(findOAuthFlowByState(again.state, { cookie: again.cookieRaw }), null);
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

test('307/308 POST não reenvia code/code_verifier/client_secret cross-origin', async () => {
  const secretBody = 'grant_type=authorization_code&code=abc&code_verifier=pkce&client_secret=s3cret';
  const hops = [];
  const lookupFn = async () => [{ address: '203.0.113.10', family: 4 }];
  const fetch = async (url, init) => {
    hops.push({ url: String(url), method: String(init?.method || 'GET').toUpperCase(), body: init?.body });
    return {
      ok: false,
      status: 307,
      headers: new Headers({ location: 'https://evil.example/token' }),
      arrayBuffer: async () => new ArrayBuffer(0)
    };
  };
  await assert.rejects(
    () => safeFetch('https://idp.example/token', { method: 'POST', body: secretBody }, { lookupFn, fetch }),
    /cross-origin recusado/
  );
  assert.deepEqual(hops.map(h => h.url), ['https://idp.example/token']);
  assert.ok(!hops.some(h => String(h.url).includes('evil.example')));

  hops.length = 0;
  const sameOrigin = async (url, init) => {
    hops.push({ url: String(url), method: String(init?.method || 'GET').toUpperCase(), body: init?.body });
    if (String(url).endsWith('/token')) {
      return {
        ok: false,
        status: 308,
        headers: new Headers({ location: 'https://idp.example/token2' }),
        arrayBuffer: async () => new ArrayBuffer(0)
      };
    }
    return { ok: true, status: 200, json: async () => ({ access_token: 'x' }) };
  };
  const kept = await safeFetch('https://idp.example/token', { method: 'POST', body: secretBody }, { lookupFn, fetch: sameOrigin });
  assert.equal(kept.status, 200);
  assert.equal(hops[1].url, 'https://idp.example/token2');
  assert.equal(hops[1].method, 'POST');
  assert.match(String(hops[1].body), /code_verifier=pkce/);
  assert.match(String(hops[1].body), /client_secret=s3cret/);

  hops.length = 0;
  const via302 = async (url, init) => {
    hops.push({ url: String(url), method: String(init?.method || 'GET').toUpperCase(), body: init?.body });
    if (String(url).includes('idp.example')) {
      return {
        ok: false,
        status: 302,
        headers: new Headers({ location: 'https://other.example/token' }),
        arrayBuffer: async () => new ArrayBuffer(0)
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  await safeFetch('https://idp.example/token', { method: 'POST', body: secretBody }, { lookupFn, fetch: via302 });
  assert.equal(hops[1].url, 'https://other.example/token');
  assert.equal(hops[1].method, 'GET');
  assert.equal(hops[1].body, undefined);
});

test('cookie OAuth por fluxo: nome inclui o state e dois fluxos convivem', async () => {
  _clearOAuthFlows();
  const plugin = { name: 'demo', url: 'https://mcp.example.com/mcp', auth: { oauthClient: 'custom', clientId: 'cid' } };
  const a = await startMcpOAuthFlow({ plugin, discovery: publicDiscovery(), redirectUri: 'https://ripper.example/cb' });
  const b = await startMcpOAuthFlow({ plugin, discovery: publicDiscovery(), redirectUri: 'https://ripper.example/cb' });
  assert.notEqual(a.state, b.state);
  assert.equal(oauthCookieName(a.state), `${OAUTH_COOKIE_NAME}_${a.state}`);
  assert.notEqual(oauthCookieName(a.state), oauthCookieName(b.state));
  const cookieA = oauthBindingCookie(a.cookieRaw, { state: a.state });
  const cookieB = oauthBindingCookie(b.cookieRaw, { state: b.state });
  assert.match(cookieA, new RegExp(`^${OAUTH_COOKIE_NAME}_${a.state}=`));
  assert.match(cookieB, new RegExp(`^${OAUTH_COOKIE_NAME}_${b.state}=`));
  const both = `${cookieA.split(';')[0]}; ${cookieB.split(';')[0]}`;
  const req = { headers: { cookie: both } };
  const rawA = readOAuthBindingCookie(req, a.state);
  const rawB = readOAuthBindingCookie(req, b.state);
  assert.equal(rawA, a.cookieRaw);
  assert.equal(rawB, b.cookieRaw);
  assert.equal(findOAuthFlowByState(b.state, { cookie: rawA }), null);
  assert.ok(findOAuthFlowByState(a.state, { cookie: rawA }));
  assert.equal(findOAuthFlowByState(a.state, { cookie: rawA }), null);
  assert.ok(findOAuthFlowByState(b.state, { cookie: rawB }));
  _clearOAuthFlows();
});

test('pinnedRequest recusa corpo acima do teto e valida todos os IPs do DNS', async () => {
  const srv = createServer((req, res) => {
    if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('x'.repeat(OAUTH_FETCH_MAX_BODY + 1));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  const port = await new Promise((resolve, reject) => {
    srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
    srv.on('error', reject);
  });
  await assert.rejects(
    () => safeFetch(`http://127.0.0.1:${port}/big`, {}, { allowPrivate: true }),
    /grande demais/
  );
  const ok = await safeFetch(`http://127.0.0.1:${port}/ok`, {}, { allowPrivate: true });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true });
  srv.close();

  await assert.rejects(
    () => resolvePublicAddresses('mixed.example', {
      lookupFn: async () => [
        { address: '203.0.113.10', family: 4 },
        { address: '224.0.0.1', family: 4 }
      ]
    }),
    /bloqueada/
  );
  await assert.rejects(
    () => resolvePublicAddresses('nat64.example', {
      lookupFn: async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '64:ff9b::c000:201', family: 6 }
      ]
    }),
    /bloqueada/
  );
  await assert.rejects(
    () => resolvePublicAddresses('sixtofour.example', {
      lookupFn: async () => [
        { address: '2002:c000:201::1', family: 6 },
        { address: '1.1.1.1', family: 4 }
      ]
    }),
    /bloqueada/
  );
});
