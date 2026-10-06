import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import {
  resolveEffectiveChaos,
  maybeChaosProviderFailure,
  maybeChaosMcpFailure,
  applyChaosPatch,
  scheduleChaosFire,
  _resetChaosForTests,
  isChaosBlockedInProduction
} from '../lib/chaos.mjs';
import { applySettingsPatch } from '../lib/settings-patch.mjs';
import { freePort } from './helpers/free-port.mjs';

test('resolveEffectiveChaos: desligado por padrão', () => {
  const c = resolveEffectiveChaos({});
  assert.equal(c.enabled, false);
  assert.equal(c.active, false);
});

test('resolveEffectiveChaos: env habilita quando permitido', () => {
  const prev = process.env.RIPPER_CHAOS_ENABLED;
  process.env.RIPPER_CHAOS_ENABLED = '1';
  process.env.NODE_ENV = 'test';
  try {
    const c = resolveEffectiveChaos({});
    assert.equal(c.enabled, true);
    assert.equal(c.active, true);
  } finally {
    if (prev === undefined) delete process.env.RIPPER_CHAOS_ENABLED;
    else process.env.RIPPER_CHAOS_ENABLED = prev;
  }
});

test('maybeChaosProviderFailure: taxa 1 falha sempre', () => {
  _resetChaosForTests();
  const chaos = { active: true, providerFailRate: 1 };
  const err = maybeChaosProviderFailure(chaos, { random: () => 0 });
  assert.ok(err);
  assert.match(err.message, /chaos/);
});

test('maybeChaosProviderFailure: inativo não falha', () => {
  _resetChaosForTests();
  assert.equal(maybeChaosProviderFailure({ active: false, providerFailRate: 1 }), null);
});

test('scheduleChaosFire one-shot provider', () => {
  _resetChaosForTests();
  scheduleChaosFire('provider');
  const err = maybeChaosProviderFailure({ active: false, providerFailRate: 0 });
  assert.ok(err);
  assert.equal(maybeChaosProviderFailure({ active: false, providerFailRate: 0 }), null);
});

test('maybeChaosMcpFailure respeita mcpDisconnect', () => {
  _resetChaosForTests();
  const err = maybeChaosMcpFailure({ active: true, mcpDisconnect: true });
  assert.match(err.message, /MCP/);
});

test('applyChaosPatch rejeita enable em produção sem override', () => {
  const prevNode = process.env.NODE_ENV;
  const prevAllow = process.env.RIPPER_CHAOS_ALLOW_PROD;
  process.env.NODE_ENV = 'production';
  delete process.env.RIPPER_CHAOS_ALLOW_PROD;
  try {
    const s = { chaos: { enabled: false, providerFailRate: 0, sseDelayMs: 0, mcpDisconnect: false } };
    assert.throws(() => applyChaosPatch(s, { enabled: true }), /produção/);
  } finally {
    process.env.NODE_ENV = prevNode;
    if (prevAllow === undefined) delete process.env.RIPPER_CHAOS_ALLOW_PROD;
    else process.env.RIPPER_CHAOS_ALLOW_PROD = prevAllow;
  }
});

test('applySettingsPatch persiste chaos', () => {
  const s = { defaultModel: 'auto', claude: {}, computer: {}, chaos: { enabled: false, providerFailRate: 0, sseDelayMs: 0, mcpDisconnect: false } };
  applySettingsPatch(s, { chaos: { enabled: true, providerFailRate: 0.25, sseDelayMs: 10, mcpDisconnect: true } });
  assert.equal(s.chaos.enabled, true);
  assert.equal(s.chaos.providerFailRate, 0.25);
  assert.equal(s.chaos.mcpDisconnect, true);
});

const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));


async function withServer(envExtra, fn) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-chaos-'));
  const port = await freePort();
  const env = {
    ...process.env,
    RIPPER_DATA: dataDir,
    PORT: String(port),
    HOST: '127.0.0.1',
    RIPPER_TOKEN: 'test-chaos-token',
    NODE_ENV: 'test',
    ...envExtra
  };
  const child = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${env.RIPPER_TOKEN}` };
  try {
    await waitFor(base + '/api/health', auth.authorization, 60_000);
    await fn(base, auth);
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('exit', r));
  }
}

async function waitFor(url, authHeader, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { headers: { authorization: authHeader } });
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('servidor não subiu a tempo');
}

test('GET /api/chaos/status', async () => {
  await withServer({}, async (base, auth) => {
    const r = await fetch(base + '/api/chaos/status', { headers: auth });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.effective.active, false);
    assert.equal(body.productionGuard, isChaosBlockedInProduction());
  });
});

test('chaos provider fail rate 1 injeta warn no chat SSE', async () => {
  await withServer({
    RIPPER_TEST_PROVIDER: 'stream',
    RIPPER_CHAOS_ENABLED: '1',
    RIPPER_CHAOS_PROVIDER_FAIL_RATE: '1'
  }, async (base, auth) => {
    const agents = await (await fetch(base + '/api/state', { headers: auth })).json();
    const agentId = agents.agents[0].id;
    const res = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ agentId, text: 'oi chaos' })
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /chaos: falha simulada do provedor|falhou/i);
  });
});

test('POST /api/chaos/fire agenda one-shot MCP', async () => {
  await withServer({}, async (base, auth) => {
    const fire = await fetch(base + '/api/chaos/fire', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'mcp' })
    });
    assert.equal(fire.status, 200);
    const verify = await fetch(base + '/api/mcp/verify', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.test/mcp', listTools: false })
    });
    const body = await verify.json();
    assert.equal(body.ok, false);
    assert.match(body.failureReason || '', /chaos.*MCP/i);
  });
});
