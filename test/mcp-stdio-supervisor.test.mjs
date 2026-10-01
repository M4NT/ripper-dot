import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  computeBackoffMs,
  runIsolatedStdioProbe,
  supervisedStdioProbe,
  resetStdioSupervisorState,
  getStdioSupervisorPublicState
} from '../lib/mcp-stdio-supervisor.mjs';
import { verifyMcpStdio } from '../lib/mcp-probe.mjs';

const minimalServer = fileURLToPath(new URL('./fixtures/mcp-stdio-minimal.mjs', import.meta.url));

test('computeBackoffMs cresce com teto', () => {
  assert.equal(computeBackoffMs(1), 400);
  assert.equal(computeBackoffMs(2), 800);
  assert.equal(computeBackoffMs(10), 16_000);
});

test('runIsolatedStdioProbe: servidor MCP mínimo responde', async () => {
  const r = await runIsolatedStdioProbe({
    name: 'minimal',
    command: process.execPath,
    args: [minimalServer]
  }, { timeout: 15_000 });
  assert.equal(r.ok, true);
  assert.ok(r.tools?.includes('ping'));
});

test('crash do host não derruba o processo de teste', async () => {
  resetStdioSupervisorState();
  const r = await runIsolatedStdioProbe({
    name: 'host-crash',
    command: process.execPath,
    args: [minimalServer]
  }, { hostEnv: { RIPPER_MCP_HOST_TEST_CRASH: '1' }, timeout: 5_000 });
  assert.equal(r.ok, false);
  assert.equal(r.hostCrashed, true);
  assert.equal(process.exitCode ?? 0, 0);
});

test('supervisedStdioProbe aplica backoff após crashes repetidos', async () => {
  resetStdioSupervisorState();
  const plugin = {
    name: 'flaky',
    command: process.execPath,
    args: [minimalServer]
  };
  const first = await supervisedStdioProbe(plugin, {
    hostEnv: { RIPPER_MCP_HOST_TEST_CRASH: '1' },
    maxAttempts: 2,
    timeout: 4_000
  });
  assert.equal(first.supervisor?.state, 'crashed');
  assert.ok(first.supervisor.failures >= 1);

  const blocked = await supervisedStdioProbe(plugin, { timeout: 4_000 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.supervisor?.state, 'cooldown');
  assert.ok(blocked.supervisor.retryAfterMs > 0);

  const pub = getStdioSupervisorPublicState('flaky');
  assert.equal(pub.state, 'cooldown');
});

test('verifyMcpStdio expõe supervisor em falha de comando inválido', async () => {
  resetStdioSupervisorState();
  const r = await verifyMcpStdio({
    name: 'bad',
    command: process.execPath,
    args: ['-e', 'process.exit(3)']
  }, { listTools: false, timeout: 4_000, maxAttempts: 1 });
  assert.equal(r.ok, false);
  assert.ok(r.steps.some(s => s.id === 'supervisor'));
  assert.ok(r.failureReason);
});

test('verifyMcpStdio sucesso via host isolado', async () => {
  resetStdioSupervisorState();
  const r = await verifyMcpStdio({
    name: 'minimal',
    command: process.execPath,
    args: [minimalServer]
  }, { timeout: 15_000 });
  assert.equal(r.ok, true);
  assert.equal(r.supervisor?.state, 'ok');
  assert.ok(r.tools?.includes('ping'));
});
