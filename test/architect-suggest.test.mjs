import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { architectSuggest } from '../lib/architect-suggest.mjs';
import { freePort } from './helpers/free-port.mjs';

test('architectSuggest exige goal', () => {
  assert.throws(() => architectSuggest({ goal: '  ' }), /Informe goal/);
});

test('architectSuggest mapeia objetivo de software para engenheiro', () => {
  const plan = architectSuggest({ goal: 'Time para revisar PRs e corrigir bugs no GitHub' });
  assert.equal(plan.templateId, 'architect');
  assert.ok(plan.agents.some(a => a.id === 'dev'));
  assert.ok(plan.agents.every(a => a.tools.every(t => ['web', 'computer', 'browser', 'memory', 'routines', 'files', 'plugins'].includes(t))));
  assert.ok(plan.tradeoffs.length >= 2);
  assert.ok(!JSON.stringify(plan).match(/\$\d|USD|billing/i));
});

test('architectSuggest detecta modo enterprise por palavra-chave', () => {
  const plan = architectSuggest({ goal: 'Governança e auditoria para equipe enterprise com conectores MCP' });
  assert.equal(plan.ripperMode, 'enterprise');
  assert.equal(plan.coordination.id, 'hub');
});

test('architectSuggest respeita maxAgents', () => {
  const plan = architectSuggest({
    goal: 'pesquisa web, dados, código, atendimento, vendas e automação',
    constraints: { maxAgents: 3 }
  });
  assert.equal(plan.agents.length, 3);
});

const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));


async function withServer(fn) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-architect-'));
  const port = await freePort();
  const env = { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TOKEN: 'architect-test-token' };
  const child = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(base + '/api/health', { headers: { authorization: 'Bearer architect-test-token' } });
        if (r.ok) break;
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    await fn(base);
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('exit', r));
  }
}

test('POST /api/architect/suggest exige auth e devolve scaffold', async () => {
  await withServer(async base => {
    const denied = await fetch(base + '/api/architect/suggest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'Automatizar suporte ao cliente' })
    });
    assert.equal(denied.status, 401);

    const r = await fetch(base + '/api/architect/suggest', {
      method: 'POST',
      headers: { authorization: 'Bearer architect-test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'Automatizar suporte ao cliente com FAQ' })
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(body.agents.some(a => a.id === 'support'));
    assert.equal(body.goal, 'Automatizar suporte ao cliente com FAQ');
  });
});
