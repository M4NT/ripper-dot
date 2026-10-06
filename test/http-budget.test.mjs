import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import {
  resolveHttpBudget,
  rejectOversizeBody,
  attachHttpTimeout,
  bodyByteLimit,
  isSseChatRequest
} from '../lib/http-budget.mjs';

const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));

test('resolveHttpBudget lê env com padrões', () => {
  const b = resolveHttpBudget({});
  assert.equal(b.maxBodyBytes, 1_048_576);
  assert.equal(b.httpTimeoutMs, 120_000);
  assert.equal(b.sseTimeoutMs, 0);
  const custom = resolveHttpBudget({
    RIPPER_MAX_BODY_BYTES: '2048',
    RIPPER_HTTP_TIMEOUT_MS: '5000',
    RIPPER_SSE_TIMEOUT_MS: '600000'
  });
  assert.equal(custom.maxBodyBytes, 2048);
  assert.equal(custom.httpTimeoutMs, 5000);
  assert.equal(custom.sseTimeoutMs, 600_000);
});

test('bodyByteLimit distingue upload de arquivo', () => {
  const limits = { maxBodyBytes: 1000, maxFileBytes: 9_000_000 };
  assert.equal(bodyByteLimit('POST', '/api/chat', limits), 1000);
  assert.equal(bodyByteLimit('POST', '/api/files', limits), 9_000_000);
  assert.equal(bodyByteLimit('GET', '/api/health', limits), null);
});

test('isSseChatRequest só POST /api/chat', () => {
  assert.equal(isSseChatRequest('POST', '/api/chat'), true);
  assert.equal(isSseChatRequest('GET', '/api/chat'), false);
});

test('rejectOversizeBody responde 413 antes de ler corpo', () => {
  const req = { method: 'POST', headers: { 'content-length': '5000' } };
  let status;
  let body = '';
  const res = {
    writeHead(code, _h) { status = code; },
    end(chunk) { body = chunk; }
  };
  const ok = rejectOversizeBody(req, res, 'POST', '/api/settings', { maxBodyBytes: 100, maxFileBytes: 1_000_000 });
  assert.equal(ok, true);
  assert.equal(status, 413);
  assert.match(body, /100 bytes/);
});

test('attachHttpTimeout envia 408 quando o orçamento expira', async () => {
  const req = new EventEmitter();
  req.destroy = () => {};
  let status;
  let body = '';
  const res = new EventEmitter();
  res.headersSent = false;
  res.writeHead = (code, _h) => { status = code; };
  res.end = chunk => { body = chunk; res.emit('finish'); };

  attachHttpTimeout(req, res, 'GET', '/api/health', { httpTimeoutMs: 30, sseTimeoutMs: 0 }, {});
  await new Promise(r => setTimeout(r, 80));
  assert.equal(status, 408);
  assert.match(body, /Tempo esgotado/);
});

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

async function withServer(envExtra, fn) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-http-budget-'));
  const port = await freePort();
  const env = {
    ...process.env,
    RIPPER_DATA: dataDir,
    PORT: String(port),
    HOST: '127.0.0.1',
    RIPPER_TOKEN: 'budget-test-token',
    ...envExtra
  };
  const child = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(base + '/api/health', env.RIPPER_TOKEN, 60_000);
    await fn(base, env.RIPPER_TOKEN);
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('exit', r));
  }
}

test('POST com corpo maior que RIPPER_MAX_BODY_BYTES retorna 413', async () => {
  await withServer({ RIPPER_MAX_BODY_BYTES: '64' }, async (base, token) => {
    const payload = JSON.stringify({ defaultModel: 'claude-sonnet-5-5', padding: 'x'.repeat(200) });
    const r = await fetch(base + '/api/settings', {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: payload
    });
    assert.equal(r.status, 413);
    const body = await r.json();
    assert.match(body.error, /64 bytes/);
  });
});

test('POST /api/chat SSE não cai no timeout HTTP curto', async () => {
  await withServer({
    RIPPER_HTTP_TIMEOUT_MS: '80',
    RIPPER_SSE_TIMEOUT_MS: '0',
    RIPPER_TEST_PROVIDER: 'stream'
  }, async (base, token) => {
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const st = await fetch(base + '/api/state', { headers: auth }).then(r => r.json());
    const agent = st.agents[0];
    const r = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ agentId: agent.id, text: 'oi timeout', model: 'claude-sonnet-5-5', effort: 'low' })
    });
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.match(text, /"done":true/);
  });
});
