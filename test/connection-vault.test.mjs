import { freePort } from './helpers/free-port.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { _resetStoreForTests, load } from '../lib/store.mjs';
import {
  _resetVaultForTests,
  agentAllowedByScope,
  deleteVaultCredential,
  getVaultCredential,
  listVaultEntries,
  migrateLegacySecretsToVault,
  pluginHasInlineSecrets,
  putVaultCredential,
  resolvePluginWithVault,
  vaultConfigured
} from '../lib/connection-vault.mjs';

const VAULT_KEY = 'a'.repeat(64);
const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));

function withVaultDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-vault-'));
  const prevData = process.env.RIPPER_DATA;
  const prevKey = process.env.RIPPER_VAULT_KEY;
  process.env.RIPPER_DATA = dir;
  process.env.RIPPER_VAULT_KEY = VAULT_KEY;
  _resetVaultForTests();
  _resetStoreForTests();
  try {
    return fn(dir);
  } finally {
    process.env.RIPPER_DATA = prevData;
    process.env.RIPPER_VAULT_KEY = prevKey;
    _resetVaultForTests();
    _resetStoreForTests();
  }
}

test('vaultConfigured exige RIPPER_VAULT_KEY ou RIPPER_TOKEN', () => {
  const prevKey = process.env.RIPPER_VAULT_KEY;
  const prevTok = process.env.RIPPER_TOKEN;
  delete process.env.RIPPER_VAULT_KEY;
  delete process.env.RIPPER_TOKEN;
  assert.equal(vaultConfigured(), false);
  process.env.RIPPER_VAULT_KEY = VAULT_KEY;
  assert.equal(vaultConfigured(), true);
  process.env.RIPPER_VAULT_KEY = prevKey;
  process.env.RIPPER_TOKEN = prevTok;
});

test('credenciais ficam criptografadas em connection-vault.json', () => {
  withVaultDir(dir => {
    putVaultCredential('gmail-global', {
      label: 'Gmail',
      scope: { agents: ['*'] },
      credential: { auth: { apiKey: 'super-secret-key-value' } }
    });
    const raw = readFileSync(join(dir, 'connection-vault.json'), 'utf8');
    assert.doesNotMatch(raw, /super-secret-key-value/);
    assert.match(raw, /"sealed"/);
    const got = getVaultCredential('gmail-global', { agentId: 'agent-1' });
    assert.equal(got.auth.apiKey, 'super-secret-key-value');
  });
});

test('escopo restringe agentes', () => {
  withVaultDir(() => {
    putVaultCredential('scoped', {
      scope: { agents: ['allowed-id'] },
      credential: { auth: { apiKey: 'x' } }
    });
    assert.ok(agentAllowedByScope({ agents: ['allowed-id'] }, 'allowed-id'));
    assert.throws(() => getVaultCredential('scoped', { agentId: 'other-id' }), /permissão/);
  });
});

test('listVaultEntries não expõe segredos', () => {
  withVaultDir(() => {
    putVaultCredential('demo', { credential: { auth: { apiKey: 'hidden' } } });
    const list = listVaultEntries();
    assert.equal(list.configured, true);
    assert.equal(list.entries.length, 1);
    assert.equal(list.entries[0].hasCredential, true);
    assert.doesNotMatch(JSON.stringify(list), /hidden/);
  });
});

test('resolvePluginWithVault mescla auth do cofre', () => {
  withVaultDir(() => {
    putVaultCredential('connector-gmail', {
      credential: { auth: { oauth: { accessToken: 'at-123', refreshToken: 'rt-456' } } }
    });
    const plugin = {
      name: 'gmail',
      type: 'http',
      url: 'https://mcp.example/mcp',
      auth: { vaultRef: 'connector-gmail', mode: 'oauth_now' }
    };
    const resolved = resolvePluginWithVault(plugin, { agentId: 'a1' });
    assert.equal(resolved.auth.oauth.accessToken, 'at-123');
  });
});

test('migrateLegacySecretsToVault move segredos de plugins e agent.secrets', () => {
  withVaultDir(() => {
    const db = load();
    db.settings.plugins = [{
      name: 'slack',
      type: 'http',
      url: 'https://mcp.example/mcp',
      auth: { apiKey: 'slack-key', mode: 'none' }
    }];
    db.agents[0].secrets = { webhook: { auth: { apiKey: 'agent-only' } } };
    const { count, migrated } = migrateLegacySecretsToVault(db);
    assert.equal(count, 2);
    assert.ok(migrated.some(m => m.kind === 'connector'));
    assert.ok(migrated.some(m => m.kind === 'agent'));
    assert.equal(pluginHasInlineSecrets(db.settings.plugins[0]), false);
    assert.equal(db.settings.plugins[0].auth.vaultRef, 'connector-slack');
    assert.equal(db.agents[0].secrets, undefined);
    const agentKey = migrated.find(m => m.kind === 'agent').vaultKey;
    const cred = getVaultCredential(agentKey, { agentId: db.agents[0].id });
    assert.equal(cred.auth.apiKey, 'agent-only');
  });
});

test('deleteVaultCredential remove entrada', () => {
  withVaultDir(dir => {
    putVaultCredential('tmp', { credential: { auth: { apiKey: 'z' } } });
    assert.ok(deleteVaultCredential('tmp'));
    assert.equal(getVaultCredential('tmp', { agentId: 'a' }), null);
    assert.ok(existsSync(join(dir, 'connection-vault.json')));
  });
});


async function withHttpServer(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-vault-http-'));
  const port = await freePort();
  const env = {
    ...process.env,
    RIPPER_DATA: dir,
    RIPPER_VAULT_KEY: VAULT_KEY,
    PORT: String(port),
    HOST: '127.0.0.1',
    RIPPER_TOKEN: 'vault-http-token'
  };
  const child = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: 'Bearer vault-http-token' };
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(base + '/api/health', { headers: auth });
        if (r.ok) break;
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    await fn(base, auth);
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('exit', r));
  }
}

test('API /api/vault/connections put/get/list', async () => {
  await withHttpServer(async (base, auth) => {
    const put = await fetch(base + '/api/vault/connections/gmail-shared', {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'Gmail compartilhado',
        scope: { agents: ['*'] },
        credential: { auth: { apiKey: 'gmail-secret-token' } }
      })
    });
    assert.equal(put.status, 200);
    const list = await (await fetch(base + '/api/vault/connections', { headers: auth })).json();
    assert.equal(list.entries.length, 1);
    assert.doesNotMatch(JSON.stringify(list), /gmail-secret-token/);
    const st = await (await fetch(base + '/api/state', { headers: auth })).json();
    const agentId = st.agents[0].id;
    const got = await (await fetch(base + `/api/vault/connections/gmail-shared?agentId=${agentId}`, { headers: auth })).json();
    assert.equal(got.credential.auth.apiKey, 'gmail-secret-token');
  });
});
