import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDiagnostics } from '../lib/diagnostics.mjs';

test('collectDiagnostics não inventa métricas de saúde', async () => {
  const d = await collectDiagnostics({
    db: { schemaVersion: 2, agents: [{ id: 'a' }], chats: [], projects: [] },
    settings: { julia: { url: 'http://127.0.0.1:8765' } },
    host: '127.0.0.1',
    port: 3000,
    tokenConfigured: true,
    frontendBuilt: true,
    codexInstalled: false,
    juliaStatus: { online: false, reason: 'offline' },
    dockerProbe: { version: null, image: 'missing' },
    activeChatCount: 0,
    pendingApprovals: 1
  });
  assert.equal(d.ok, true);
  assert.equal(d.data.agents, 1);
  assert.equal(d.runtime.julia, 'offline');
  assert.equal(d.runtime.codexCli, 'missing');
  assert.equal(d.runtime.pendingApprovals, 1);
  assert.equal(d.score, undefined);
  assert.equal(d.healthScore, undefined);
  assert.ok(Array.isArray(d.providers?.circuitBreakers));
  assert.ok(d.providers.circuitBreakers.some(b => b.provider === 'claude'));
});
