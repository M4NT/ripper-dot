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

async function waitForHealthz(base, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + '/healthz');
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('servidor não subiu a tempo');
}

async function withServer(fn) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-openapi-'));
  const port = await freePort();
  const env = {
    ...process.env,
    RIPPER_DATA: dataDir,
    PORT: String(port),
    HOST: '127.0.0.1',
    RIPPER_TOKEN: 'test-openapi-token'
  };
  const child = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitForHealthz(base, 15_000);
    await fn(base, env.RIPPER_TOKEN);
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('exit', r));
  }
}

test('GET /openapi.json retorna OpenAPI 3 válido', async () => {
  await withServer(async (base, token) => {
    const r = await fetch(base + '/openapi.json');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /application\/json/);
    assert.ok(r.headers.get('x-request-id'));
    const doc = await r.json();
    assert.match(String(doc.openapi), /^3\./);
    assert.ok(doc.paths['/api/health']);
    assert.ok(doc.paths['/api/chat']);
    assert.ok(doc.paths['/api/flags']);
    assert.ok(doc.paths['/metrics']);
    assert.ok(doc.paths['/healthz']);
    assert.ok(doc.components?.securitySchemes?.bearerAuth);
    assert.match(doc.info.description, /RIPPER_METRICS_PUBLIC/);

    const m = await fetch(base + '/metrics', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(m.status, 200);
  });
});

test('GET /docs e sondas ops', async () => {
  await withServer(async base => {
    const docs = await fetch(base + '/docs');
    assert.equal(docs.status, 200);
    const html = await docs.text();
    assert.match(html, /\/openapi\.json/);

    const hz = await (await fetch(base + '/healthz')).json();
    assert.equal(hz.ok, true);
    assert.equal(hz.version, '0.1.0');
    assert.ok(hz.uptimeSeconds >= 0);

    const rz = await (await fetch(base + '/readyz')).json();
    assert.equal(rz.ok, true);
    assert.equal(rz.version, '0.1.0');
  });
});
