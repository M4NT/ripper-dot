import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { connect, createServer } from 'node:net';
import { isShuttingDown, _markShuttingDownForTests, SHUTDOWN_MESSAGE } from '../lib/shutdown.mjs';

test('isShuttingDown inicia false e pode ser marcado em testes', () => {
  assert.equal(isShuttingDown(), false);
  _markShuttingDownForTests(true);
  assert.equal(isShuttingDown(), true);
  _markShuttingDownForTests(false);
  assert.equal(isShuttingDown(), false);
});

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

async function waitForHealth(base, token, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + '/api/health', { headers: { authorization: `Bearer ${token}` } });
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('servidor não subiu a tempo');
}

test('SIGTERM faz novas requisições /api/* retornarem 503', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-shutdown-'));
  const port = await freePort();
  const token = 'shutdown-test-token';
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      RIPPER_DATA: dataDir,
      PORT: String(port),
      HOST: '127.0.0.1',
      RIPPER_TOKEN: token,
      RIPPER_SHUTDOWN_MS: '20000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const base = `http://127.0.0.1:${port}`;
  let holdSocket;
  try {
    await waitForHealth(base, token, 15_000);
    holdSocket = connect(port, '127.0.0.1');
    await new Promise((resolve, reject) => {
      holdSocket.once('connect', resolve);
      holdSocket.once('error', reject);
    });
    child.kill('SIGTERM');
    const deadline = Date.now() + 5000;
    let saw503 = false;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(base + '/api/health', { headers: { authorization: `Bearer ${token}` } });
        if (r.status === 503) {
          const body = await r.json();
          assert.match(body.error, /encerramento/i);
          assert.equal(body.error, SHUTDOWN_MESSAGE);
          saw503 = true;
          break;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 50));
    }
    assert.equal(saw503, true, 'esperava 503 após SIGTERM');
  } finally {
    holdSocket?.destroy();
    if (child.exitCode === null) child.kill('SIGKILL');
    await new Promise(r => child.on('exit', r));
  }
});
