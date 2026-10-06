import './helpers/signed-in.mjs';
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

test('automatizar: webhook dispara o fluxo com o evento como pedido; resultado na Caixa; apagar o fluxo apaga a automação', async () => {
  const http = await import('node:http');
  const { spawn } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-flowauto-'));
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
    const flow = await send('/api/flows', { name: 'Triagem', steps: [{ agentId: a.id, instruction: 'Classifique' }, { agentId: b.id, instruction: 'Responda' }] });
    const r = await send('/api/routines', { agentId: a.id, flowId: flow.id, name: 'Triagem de eventos', trigger: 'webhook' });
    assert.equal(r.flowId, flow.id, 'rotina de fluxo não exige "o que fazer"');
    const hook = await fetch(`${base}/api/hooks/${r.hookToken}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cliente: 'Ana', pedido: 'orçamento' }) });
    assert.ok([200, 202].includes(hook.status));
    const done = await wait(async () => {
      const st = await (await fetch(base + '/api/state')).json();
      const c = st.chats.find(x => x.routineId === r.id);
      return c?.flowRun?.status === 'done' && c; // pela lista: abrir a conversa marca como lida
    });
    assert.ok(done, 'o fluxo deveria rodar até o fim');
    const inbox = await (await fetch(base + '/api/inbox')).json();
    assert.ok(inbox.items.some(i => i.kind === 'routine' && i.chatId === done.id), 'resultado chega na Caixa');
    const full = await (await fetch(base + `/api/chats/${done.id}`)).json();
    assert.match(full.messages[0].content, /orçamento/, 'o evento vira o pedido do fluxo');
    assert.equal(full.messages.filter(m => m.role === 'assistant').length, 2);
    await fetch(`${base}/api/flows/${flow.id}`, { method: 'DELETE', headers: { origin: base } });
    assert.equal((await (await fetch(base + '/api/state')).json()).routines.some(x => x.id === r.id), false);
  } finally { child.kill(); }
});

test('ramificação: condição só a partir do 2º passo; "contém" e "não contém"', async () => {
  const { stepRuns } = await import('../lib/flows.mjs');
  const f = normalizeFlow({ steps: [
    { agentId: 'a', instruction: 'Classifique', when: { keywords: 'x' } },
    { agentId: 'b', instruction: 'Cliente', when: { mode: 'has', keywords: 'cliente' } },
    { agentId: 'b', instruction: 'Outro', when: { mode: 'not', keywords: 'cliente' } }
  ] }, agents);
  assert.equal(f.steps[0].when, undefined, 'o 1º passo não tem condição');
  assert.equal(stepRuns(f.steps[1], 'Isto é de um CLIENTE'), true);
  assert.equal(stepRuns(f.steps[2], 'Isto é de um CLIENTE'), false);
  assert.equal(stepRuns(f.steps[2], 'spam'), true);
  assert.equal(stepRuns({ instruction: 'x' }, ''), true, 'sem condição sempre roda');
});

test('rodar com ramificação: o ramo que não bate é pulado', async () => {
  const http = await import('node:http');
  const { spawn } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-flowif-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TEST_PROVIDER: 'stream', HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0' }, stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  const send = (path, b) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(b || {}) }).then(r => r.json());
  const wait = async (fn, ms = 20_000) => { let v; for (let i = 0; i < ms / 200 && !(v = await fn()); i++) await new Promise(r => setTimeout(r, 200)); return v; };
  try {
    await wait(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } });
    const [a] = (await (await fetch(base + '/api/state')).json()).agents;
    const b = await send('/api/agents', { name: 'Vendas' });
    const c2 = await send('/api/agents', { name: 'Suporte' });
    // o provedor de teste devolve o próprio pedido: o passo 1 "diz" CLIENTE
    const flow = await send('/api/flows', { name: 'Triagem', steps: [
      { agentId: a.id, instruction: 'Responda: cliente.' }, // ponto: o provedor de teste cola as linhas
      { agentId: b.id, instruction: 'Atenda o cliente', when: { mode: 'has', keywords: 'cliente' } },
      { agentId: c2.id, instruction: 'Arquive', when: { mode: 'not', keywords: 'cliente' } }
    ] });
    const { chatId } = await send(`/api/flows/${flow.id}/run`, { input: 'mensagem nova' });
    const done = await wait(async () => { const c = (await (await fetch(base + '/api/state')).json()).chats.find(x => x.id === chatId); return c?.flowRun?.status === 'done' && c; });
    assert.ok(done);
    const full = await (await fetch(base + `/api/chats/${chatId}`)).json();
    assert.deepEqual(full.messages.filter(m => m.role === 'assistant').map(m => m.agentId), [a.id, b.id]);
    assert.deepEqual(full.flowRun.skipped, [2]);
  } finally { child.kill(); }
});
