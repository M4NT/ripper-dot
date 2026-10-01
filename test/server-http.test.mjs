import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

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

async function withServer(envExtra, fn) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-http-'));
  const port = await freePort();
  const env = {
    ...process.env,
    RIPPER_DATA: dataDir,
    PORT: String(port),
    HOST: '127.0.0.1',
    RIPPER_TOKEN: 'test-http-token',
    ...envExtra
  };
  const child = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(base + '/api/health', env.RIPPER_TOKEN, 15_000);
    await fn(base, env.RIPPER_TOKEN);
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('exit', r));
  }
}

async function waitFor(url, token, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('servidor não subiu a tempo');
}

test('GET /api/health exige RIPPER_TOKEN', async () => {
  await withServer({}, async base => {
    const denied = await fetch(base + '/api/health');
    assert.equal(denied.status, 401);
    const body = await denied.json();
    assert.match(body.error, /Não autorizado/);

    const ok = await fetch(base + '/api/health', { headers: { authorization: 'Bearer test-http-token' } });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true });
  });
});

test('?token= define cookie e redireciona (sem auth header)', async () => {
  await withServer({}, async (base, token) => {
    const r = await fetch(base + '/?token=' + encodeURIComponent(token), { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.match(r.headers.get('set-cookie') || '', /ripper_token=/);
  });
});

test('GET /api/chats lista e busca conversas reais com paginação', async () => {
  await withServer({ RIPPER_TEST_PROVIDER: 'stream' }, async (base, token) => {
    const auth = { authorization: `Bearer ${token}` };
    const st = await (await fetch(base + '/api/state', { headers: auth })).json();
    const agent = st.agents[0];
    const chatRes = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: agent.id, text: 'marcador-unico-busca', model: 'claude-sonnet-5-5', effort: 'low' })
    });
    await chatRes.text();
    await new Promise(r => setTimeout(r, 250));
    const list = await (await fetch(base + '/api/chats?limit=5', { headers: auth })).json();
    assert.ok(Array.isArray(list.items));
    assert.ok(list.total >= 1);
    const found = await (await fetch(base + '/api/chats?q=marcador-unico-busca', { headers: auth })).json();
    assert.equal(found.total, 1);
    assert.match(found.items[0].preview || '', /marcador-unico-busca/);
  });
});

test('GET /api/usage/limits retorna agregado', async () => {
  await withServer({}, async (base, token) => {
    const r = await fetch(base + '/api/usage/limits', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(body.contractVersion);
    assert.ok(body.accountUsage);
    assert.ok(body.providerSnapshot);
    assert.equal(body.limits.ripperQuota.rolling5h, null);
    assert.ok(body.limits.localUsage);
  });
});

test('GET /api/usage unifica contrato', async () => {
  await withServer({}, async (base, token) => {
    const r = await fetch(base + '/api/usage', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(body.accountUsage);
    assert.ok(body.providerSnapshot);
    assert.ok(body.contextWindow);
    assert.equal(body.contextWindow.emptyLabel, 'sem dados');
  });
});

test('GET /api/diagnostics retorna fatos sem score inventado', async () => {
  await withServer({}, async (base, token) => {
    const r = await fetch(base + '/api/diagnostics', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.ok(body.data.schemaVersion);
    assert.equal(body.score, undefined);
  });
});

test('GET /api/catalog permite cache público', async () => {
  await withServer({}, async (base, token) => {
    const r = await fetch(base + '/api/catalog', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('cache-control') || '', /max-age=3600/);
    const body = await r.json();
    assert.ok(body.templates?.length);
  });
});

test('POST /api/routines não devolve hookSecret', async () => {
  await withServer({}, async (base, token) => {
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const st = await fetch(base + '/api/state', { headers: auth }).then(r => r.json());
    const agentId = st.agents[0].id;
    const r = await fetch(base + '/api/routines', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ agentId, name: 'wh', prompt: 'ping', trigger: 'webhook', hookSecret: 'topsecret' })
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.hasSecret, true);
    assert.equal(body.hookSecret, undefined);
  });
});

test('GET /api/data/backup e restore', async () => {
  await withServer({}, async (base, token) => {
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const snap = await fetch(base + '/api/data/backup', { headers: auth }).then(r => r.json());
    assert.equal(snap.format, 1);
    snap.db.settings.name = 'restaurado-teste';
    const res = await fetch(base + '/api/data/restore', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ confirm: true, backup: snap })
    });
    assert.equal(res.status, 200);
    const st = await fetch(base + '/api/state', { headers: auth }).then(r => r.json());
    assert.equal(st.settings.name, 'restaurado-teste');
  });
});
