import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import {
  redactPlugin,
  redactSettingsSecrets,
  createPluginRecord,
  listConnectorRecords
} from '../lib/mcp-connectors.mjs';
import { pluginOAuthStatus, refreshPluginOAuthToken, mergePluginAuth } from '../lib/mcp-oauth.mjs';
import { verifyMcpServer } from '../lib/mcp-probe.mjs';

const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

test('redactSettingsSecrets mascara headers e tokens de plugin', () => {
  const s = redactSettingsSecrets({
    claude: { apiKey: 'secret-claude' },
    computer: { boatApiKey: 'boat' },
    plugins: [{
      name: 'x',
      type: 'http',
      url: 'https://mcp.test/mcp',
      headers: { 'x-api-key': 'hush' },
      auth: { apiKey: 'key', oauth: { accessToken: 'at', refreshToken: 'rt' } }
    }]
  });
  assert.equal(s.claude.apiKey, '••••');
  assert.equal(s.plugins[0].headers['x-api-key'], '••••');
  assert.equal(s.plugins[0].auth.apiKey, '••••');
  assert.equal(s.plugins[0].auth.oauth.accessToken, '••••');
});

test('verifyMcpServer sucesso só com initialize MCP válido', async () => {
  const fetch = async (url, init = {}) => {
    if (init.method === 'POST') {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'Demo MCP' }, capabilities: {} } }),
        json: async () => ({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'Demo MCP' }, capabilities: {} } })
      };
    }
    return { ok: true, status: 200, headers: new Headers(), text: async () => '', json: async () => null };
  };
  const r = await verifyMcpServer('https://demo.test/mcp', { fetch, listTools: false });
  assert.equal(r.ok, true);
  assert.equal(r.verified, true);
});

test('pluginOAuthStatus needs_auth sem token', () => {
  const st = pluginOAuthStatus({ auth: { mode: 'oauth_now' } });
  assert.equal(st.state, 'needs_auth');
});

test('refreshPluginOAuthToken retorna erro explícito', async () => {
  const fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) });
  const r = await refreshPluginOAuthToken({
    auth: { tokenEndpoint: 'https://idp/token', oauth: { refreshToken: 'r' } }
  }, { fetch });
  assert.equal(r.ok, false);
  assert.match(r.error, /invalid_grant/);
});

test('API CRUD /api/mcp/connectors', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-mcp-crud-'));
  const port = await freePort();
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TOKEN: 'crud-token' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: 'Bearer crud-token', 'content-type': 'application/json' };
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(base + '/api/health', { headers: auth })).ok) break;
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    const created = await fetch(base + '/api/mcp/connectors', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'demo-http', type: 'http', url: 'https://mcp.example.com/mcp', headers: { secret: 'nope' } })
    }).then(r => r.json());
    assert.equal(created.connector.headers.secret, '••••');

    const list = await fetch(base + '/api/mcp/connectors', { headers: auth }).then(r => r.json());
    assert.equal(list.connectors.length, 1);

    await fetch(base + '/api/mcp/connectors/demo-http', { method: 'DELETE', headers: auth });
    const list2 = await fetch(base + '/api/mcp/connectors', { headers: auth }).then(r => r.json());
    assert.equal(list2.connectors.length, 0);
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('exit', r));
  }
});

test('createPluginRecord rejeita nome duplicado', () => {
  assert.throws(() => createPluginRecord({ name: 'a', type: 'http', url: 'https://x/mcp' }, [{ name: 'a', type: 'http', url: 'https://y/mcp' }]));
});

test('listConnectorRecords inclui authStatus', () => {
  const rows = listConnectorRecords({ plugins: [{ name: 'p', type: 'http', url: 'https://a/mcp', auth: { mode: 'none' } }] });
  assert.equal(rows[0].authStatus.state, 'none');
});

test('mergePluginAuth preserva apiKey com máscara', () => {
  const next = mergePluginAuth({ apiKey: 'real' }, { apiKey: '••••' });
  assert.equal(next.apiKey, 'real');
});
