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
