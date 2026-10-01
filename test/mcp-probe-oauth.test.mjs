import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyMcpServer } from '../lib/mcp-probe.mjs';

test('verifyMcpServer detecta OAuth em 401 com metadados', async () => {
  const asMeta = {
    authorization_endpoint: 'https://idp.test/authorize',
    token_endpoint: 'https://idp.test/token'
  };
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.includes('oauth-authorization-server')) {
      return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(asMeta), json: async () => asMeta };
    }
    if (init.method === 'POST') {
      return {
        ok: false,
        status: 401,
        headers: new Headers({ 'www-authenticate': 'Bearer realm="mcp"' }),
        text: async () => '{}',
        json: async () => null
      };
    }
    return { ok: true, status: 200, headers: new Headers(), text: async () => '', json: async () => null };
  };
  const r = await verifyMcpServer('https://mcp.example.com/mcp', { fetch });
  assert.equal(r.ok, false);
  assert.equal(r.oauthRequired, true);
  assert.equal(r.login.found, true);
  assert.equal(r.login.discovery.authorizationServer.token_endpoint, 'https://idp.test/token');
});
