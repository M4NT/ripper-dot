import { freePort } from './helpers/free-port.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  checkRateLimit,
  normalizeRateLimit,
  rateLimitBucket,
  _resetRateLimitForTests,
  _setRateLimitClock
} from '../lib/rate-limit.mjs';

const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));

test('rateLimitBucket classifica chat e APIs pesadas', () => {
  assert.equal(rateLimitBucket('POST', '/api/chat'), 'chat');
  assert.equal(rateLimitBucket('GET', '/api/data/backup'), 'api');
  assert.equal(rateLimitBucket('POST', '/api/data/restore'), 'api');
  assert.equal(rateLimitBucket('GET', '/api/metering/export'), 'api');
  assert.equal(rateLimitBucket('GET', '/api/health'), null);
});

test('normalizeRateLimit aplica env RIPPER_RATE_*', () => {
  const cfg = normalizeRateLimit({ enabled: false, chatPerMinute: 5 }, {
    env: {
      RIPPER_RATE_ENABLED: '1',
      RIPPER_RATE_CHAT_PER_MINUTE: '2',
      RIPPER_RATE_API_PER_MINUTE: '3',
      RIPPER_RATE_WINDOW_MS: '5000'
    }
  });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.chatPerMinute, 2);
  assert.equal(cfg.apiPerMinute, 3);
  assert.equal(cfg.windowMs, 5000);
});

test('checkRateLimit bloqueia segunda requisição na janela', () => {
  _resetRateLimitForTests();
  let t = 1_000_000;
  _setRateLimitClock(() => t);
  const settings = { rateLimit: { enabled: true, chatPerMinute: 1, apiPerMinute: 1, windowMs: 60_000 } };
  const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  const first = checkRateLimit({ req, settings, ripperToken: 'tok', method: 'POST', path: '/api/chat' });
  assert.equal(first.ok, true);
  const second = checkRateLimit({ req, settings, ripperToken: 'tok', method: 'POST', path: '/api/chat' });
  assert.equal(second.ok, false);
  assert.ok(second.retryAfterSec >= 1);
  _resetRateLimitForTests();
});

test('checkRateLimit desligado não conta', () => {
  _resetRateLimitForTests();
  const settings = { rateLimit: { enabled: false, chatPerMinute: 1, apiPerMinute: 1, windowMs: 60_000 } };
  const req = { headers: {}, socket: { remoteAddress: '10.0.0.1' } };
  assert.equal(checkRateLimit({ req, settings, ripperToken: 'x', method: 'POST', path: '/api/chat' }).ok, true);
  assert.equal(checkRateLimit({ req, settings, ripperToken: 'x', method: 'POST', path: '/api/chat' }).ok, true);
  _resetRateLimitForTests();
});


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

async function withRateLimitServer(fn) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-rl-'));
  const port = await freePort();
  const env = {
    ...process.env,
    RIPPER_DATA: dataDir,
    PORT: String(port),
    HOST: '127.0.0.1',
    RIPPER_TOKEN: 'rate-limit-token',
    RIPPER_TEST_PROVIDER: 'stream',
    RIPPER_RATE_ENABLED: '1',
    RIPPER_RATE_CHAT_PER_MINUTE: '1',
    RIPPER_RATE_WINDOW_MS: '60000'
  };
  const child = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${env.RIPPER_TOKEN}` };
  try {
    await waitFor(base + '/api/health', env.RIPPER_TOKEN, 60_000);
    await fn(base, auth);
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('exit', r));
  }
}

test('segundo POST /api/chat na janela retorna 429 com Retry-After', async () => {
  await withRateLimitServer(async (base, auth) => {
    const st = await (await fetch(base + '/api/state', { headers: auth })).json();
    const agent = st.agents[0];
    const headers = { ...auth, 'content-type': 'application/json' };
    const first = await fetch(base + '/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({ agentId: agent.id, text: 'ping', model: 'claude-sonnet-5-5', effort: 'low' })
    });
    assert.equal(first.status, 200);
    const second = await fetch(base + '/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({ agentId: agent.id, text: 'pong', model: 'claude-sonnet-5-5', effort: 'low' })
    });
    assert.equal(second.status, 429);
    assert.ok(+second.headers.get('retry-after') >= 1);
    const err = await second.json();
    assert.match(err.error, /Limite de taxa/);
    await first.body?.cancel?.();
  });
});
