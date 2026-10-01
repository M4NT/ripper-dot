import test from 'node:test';
import assert from 'node:assert/strict';
import { runX9Scan } from '../lib/x9-scan.mjs';
import { collectX9Sources, deriveSandboxStatus } from '../lib/x9-sources.mjs';

const baseDb = {
  agents: [
    { id: '1', name: 'Ops', status: 'online', tools: ['computer', 'plugins'] }
  ],
  approvals: [],
  auditLog: [],
  memories: []
};

test('deriveSandboxStatus reflete computer.mode', () => {
  assert.equal(deriveSandboxStatus({ computer: { mode: 'off' } }).computerOff, true);
  assert.equal(deriveSandboxStatus({ computer: { mode: 'docker' } }).sandboxActive, true);
});

test('runX9Scan detecta approvalPolicy never', () => {
  const { findings } = runX9Scan({
    db: baseDb,
    settings: { approvalPolicy: 'never', computer: { mode: 'docker' }, plugins: [] },
    sources: { adminOverview: { available: false, reason: 'test' } }
  });
  assert.ok(findings.some(f => f.code === 'APPROVAL_NEVER' && f.severity === 'critical'));
});

test('runX9Scan usa /api/lgpd/status quando disponível', () => {
  const { findings } = runX9Scan({
    db: baseDb,
    settings: { computer: { mode: 'boat' }, plugins: [] },
    sources: {
      lgpd: { available: true, productTelemetry: false },
      adminOverview: { available: true }
    }
  });
  assert.ok(!findings.some(f => f.code === 'LGPD_STATUS_UNKNOWN'));
  assert.ok(!findings.some(f => f.code === 'API_ADMIN_OVERVIEW_UNAVAILABLE'));
});

test('runX9Scan respeita lgpdEnabled em settings', () => {
  const off = runX9Scan({
    db: baseDb,
    settings: { privacy: { lgpdEnabled: false }, computer: { mode: 'docker' }, plugins: [] },
    sources: { adminOverview: { available: true } }
  });
  assert.ok(off.findings.some(f => f.code === 'LGPD_DISABLED'));

  const on = runX9Scan({
    db: baseDb,
    settings: { privacy: { lgpdEnabled: true }, computer: { mode: 'docker' }, plugins: [] },
    sources: { adminOverview: { available: true } }
  });
  assert.ok(!on.findings.some(f => f.code === 'LGPD_DISABLED'));
});

test('collectX9Sources integra LGPD e admin em enterprise', () => {
  const src = collectX9Sources({
    db: baseDb,
    settings: { computer: { mode: 'docker' }, plugins: [], ui: { mode: 'enterprise' } },
    env: { HOST: '127.0.0.1', RIPPER_TOKEN: 'x' }
  });
  assert.equal(src.lgpd.available, true);
  assert.equal(src.adminOverview.available, true);
  assert.equal(src.audit.available, true);
});
