import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFlow, stepPrompt } from '../lib/flows.mjs';

const agents = [{ id: 'a' }, { id: 'b' }];

test('valida passos: agente existente, instrução e limite', () => {
  const f = normalizeFlow({ name: ' Post ', steps: [{ agentId: 'a', instruction: 'Pesquise', approve: 'sim' }, { agentId: 'b', instruction: 'Escreva', approve: true }] }, agents);
  assert.equal(f.name, 'Post');
  assert.deepEqual(f.steps.map(s => s.approve), [false, true], 'só true liga a aprovação');
  assert.throws(() => normalizeFlow({ steps: [] }, agents), /pelo menos um passo/);
  assert.throws(() => normalizeFlow({ steps: [{ agentId: 'x', instruction: 'a' }] }, agents), /Passo 1: escolha um agente/);
  assert.throws(() => normalizeFlow({ steps: [{ agentId: 'a', instruction: ' ' }] }, agents), /Passo 1: diga o que/);
  assert.throws(() => normalizeFlow({ steps: Array(11).fill({ agentId: 'a', instruction: 'x' }) }, agents), /No máximo 10/);
});

test('cada passo recebe a instrução, o pedido e o resultado anterior', () => {
  const f = { name: 'Post', steps: [{ instruction: 'Pesquise' }, { instruction: 'Escreva' }] };
  const p1 = stepPrompt(f, 0, 'IA em 2026', null);
  assert.match(p1, /passo 1 de 2/);
  assert.match(p1, /Pedido original: IA em 2026/);
  assert.doesNotMatch(p1, /passo anterior/);
  const p2 = stepPrompt(f, 1, 'IA em 2026', 'achados…');
  assert.match(p2, /Resultado do passo anterior:\nachados…/);
  assert.match(p2, /último passo/);
});

test('rodar: passo 1 → pausa para aprovação → passo 2; recusar para o fluxo', async () => {
  const http = await import('node:http');
  const { spawn } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-flow-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TEST_PROVIDER: 'stream', HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0' }, stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  const send = (path, b, method = 'POST') => fetch(base + path, { method, headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(b || {}) }).then(r => r.json());
  const wait = async (fn, ms = 20_000) => { let v; for (let i = 0; i < ms / 200 && !(v = await fn()); i++) await new Promise(r => setTimeout(r, 200)); return v; };
  try {
    await wait(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } });
    const [a] = (await (await fetch(base + '/api/state')).json()).agents;
    const b = await send('/api/agents', { name: 'Redatora' });
    const flow = await send('/api/flows', { name: 'Post', steps: [{ agentId: a.id, instruction: 'Pesquise', approve: true }, { agentId: b.id, instruction: 'Escreva' }] });
    assert.equal(flow.steps.length, 2);
    const bad = await fetch(base + '/api/flows', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ steps: [] }) });
    assert.equal(bad.status, 400);

    const chatOf = async id => (await (await fetch(base + `/api/chats/${id}`)).json());
    const pending = () => fetch(base + '/api/approvals').then(r => r.json()).then(j => j.pending.find(p => p.kind === 'flow'));

    const { chatId } = await send(`/api/flows/${flow.id}/run`, { input: 'IA em 2026' });
    const ap = await wait(pending);
    assert.ok(ap, 'deveria pausar pedindo aprovação');
    assert.match(ap.command, /passo 1 de 2/);
    assert.equal((await chatOf(chatId)).flowRun.status, 'waiting');
    await send(`/api/approvals/${ap.id}`, { approve: true });
    const done = await wait(async () => { const c = await chatOf(chatId); return c.flowRun?.status === 'done' && c; });
    assert.ok(done, 'fluxo deveria terminar');
    assert.deepEqual(done.messages.filter(m => m.role === 'assistant').map(m => m.agentId), [a.id, b.id]);

    const run2 = await send(`/api/flows/${flow.id}/run`, { input: 'outro' });
    const ap2 = await wait(pending);
    await send(`/api/approvals/${ap2.id}`, { approve: false });
    const stopped = await wait(async () => { const c = await chatOf(run2.chatId); return c.flowRun?.status === 'stopped' && c; });
    assert.ok(stopped, 'recusar deveria parar o fluxo');
    assert.equal(stopped.messages.filter(m => m.role === 'assistant').length, 1);
  } finally { child.kill(); }
});
