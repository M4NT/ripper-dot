import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

async function withDataDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-audit-'));
  const prev = process.env.RIPPER_DATA;
  process.env.RIPPER_DATA = dir;
  const { _resetStoreForTests } = await import('../lib/store.mjs');
  try {
    await fn(dir);
  } finally {
    _resetStoreForTests();
    process.env.RIPPER_DATA = prev;
  }
}

test('appendAuditTrail é append-only (triggers bloqueiam UPDATE e DELETE)', () =>
  withDataDir(async () => {
    const {
      appendAuditTrail,
      countAuditTrail,
      _testMutateAuditTrail
    } = await import('../lib/audit-trail.mjs');
    appendAuditTrail({ category: 'security', action: 'test.seed', detail: { n: 1 } });
    assert.equal(countAuditTrail(), 1);
    assert.throws(() => _testMutateAuditTrail('update'), /immutable/i);
    assert.throws(() => _testMutateAuditTrail('delete'), /immutable/i);
    assert.equal(countAuditTrail(), 1);
  }));

test('recordCorporateAudit só grava com modo enterprise', () =>
  withDataDir(async () => {
    const { recordCorporateAudit, auditAgentLifecycle } = await import('../lib/corporate-audit.mjs');
    const { countAuditTrail } = await import('../lib/audit-trail.mjs');
    const settings = { enterprise: { enabled: false } };
    recordCorporateAudit(settings, auditAgentLifecycle('create', { id: 'a1', name: 'Bot' }));
    assert.equal(countAuditTrail(), 0);
    settings.enterprise.enabled = true;
    recordCorporateAudit(settings, auditAgentLifecycle('create', { id: 'a2', name: 'Corp' }));
    assert.equal(countAuditTrail(), 1);
  }));

test('isEnterpriseMode respeita RIPPER_ENTERPRISE_MODE', async () => {
  const { isEnterpriseMode } = await import('../lib/enterprise.mjs');
  const prev = process.env.RIPPER_ENTERPRISE_MODE;
  process.env.RIPPER_ENTERPRISE_MODE = '1';
  assert.equal(isEnterpriseMode({ enterprise: { enabled: false } }), true);
  delete process.env.RIPPER_ENTERPRISE_MODE;
  assert.equal(isEnterpriseMode({ enterprise: { enabled: false } }), false);
  process.env.RIPPER_ENTERPRISE_MODE = prev;
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

test('GET /api/audit-trail exige enterprise e lista eventos imutáveis', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-audit-http-'));
  const port = await freePort();
  const env = {
    ...process.env,
    RIPPER_DATA: dataDir,
    PORT: String(port),
    HOST: '127.0.0.1',
    RIPPER_TOKEN: 'audit-trail-token'
  };
  const child = spawn(process.execPath, [serverPath], { env, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: 'Bearer audit-trail-token', 'content-type': 'application/json' };
  try {
    await waitFor(base + '/api/health', env.RIPPER_TOKEN, 15_000);
    const denied = await fetch(base + '/api/audit-trail', { headers: auth });
    assert.equal(denied.status, 403);

    const enable = await fetch(base + '/api/settings', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ ui: { mode: 'enterprise' } })
    });
    assert.equal(enable.status, 200);

    const create = await fetch(base + '/api/agents', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'Auditor', description: 'teste' })
    });
    assert.equal(create.status, 200);

    const list = await fetch(base + '/api/audit-trail?limit=20', { headers: auth });
    assert.equal(list.status, 200);
    const body = await list.json();
    assert.equal(body.enterprise, true);
    assert.ok(body.entries.some(e => e.action === 'agent.create' && e.agentName === 'Auditor'));
    assert.ok(body.entries.some(e => e.action === 'settings.patch'));
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise(r => child.on('exit', r)),
      new Promise(r => setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
        child.on('exit', r);
      }, 8000))
    ]);
  }
});
