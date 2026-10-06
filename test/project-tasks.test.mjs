import './helpers/signed-in.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patchTask, taskPrompt } from '../lib/project-tasks.mjs';

test('patchTask valida título, status e agente', () => {
  const agents = [{ id: 'a' }];
  const t = patchTask({}, { title: ' Post ', note: 'curto', status: 'doing', assigneeId: 'a' }, agents);
  assert.equal(t.title, 'Post'); assert.equal(t.status, 'doing'); assert.equal(t.assigneeId, 'a');
  assert.throws(() => patchTask({}, { title: ' ' }, agents), /título/);
  assert.throws(() => patchTask({}, { status: 'x' }, agents), /Status/);
  assert.throws(() => patchTask({}, { assigneeId: 'z' }, agents), /Agente/);
  assert.equal(patchTask(t, { assigneeId: null }, agents).assigneeId, null);
  assert.equal(taskPrompt({ title: 'A', note: 'B' }), 'Tarefa do quadro do projeto: A\n\nB');
});

test('quadro: criar card, pedir ao agente, termina em Feito com conversa ligada', async () => {
  const http = await import('node:http');
  const { spawn } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-ptask-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TEST_PROVIDER: 'stream', HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0' }, stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  const req = (path, b, method = 'POST') => fetch(base + path, { method, headers: { 'content-type': 'application/json', origin: base }, body: method === 'GET' ? undefined : JSON.stringify(b || {}) });
  const send = (...a) => req(...a).then(r => r.json());
  const wait = async (fn, ms = 60_000) => { let v; for (let i = 0; i < ms / 200 && !(v = await fn()); i++) await new Promise(r => setTimeout(r, 200)); return v; };
  try {
    await wait(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } });
    const [a] = (await (await fetch(base + '/api/state')).json()).agents;
    const p = await send('/api/projects', { name: 'Lançamento' });
    assert.equal((await req(`/api/projects/${p.id}/tasks`, { title: '' })).status, 400);
    assert.equal((await req('/api/projects/nope/tasks', { title: 'x' })).status, 404);
    const t = await send(`/api/projects/${p.id}/tasks`, { title: 'Escrever post', note: 'Tom leve', assigneeId: a.id });
    assert.equal(t.status, 'todo');
    assert.equal((await req(`/api/projects/${p.id}/tasks/nope`, {}, 'PUT')).status, 404);
    const run = await send(`/api/projects/${p.id}/tasks/${t.id}/run`);
    assert.ok(run.chatId);
    const list = () => send(`/api/projects/${p.id}/tasks`, null, 'GET');
    const done = await wait(async () => (await list()).find(x => x.status === 'done' && x.chatId));
    assert.ok(done, 'card deveria ir para Feito');
    assert.equal(done.chatId, run.chatId);
    const c = await (await fetch(base + `/api/chats/${run.chatId}`)).json();
    assert.equal(c.projectId, p.id);
    assert.match(c.messages[0].content, /Escrever post[\s\S]*Tom leve/);
    assert.equal((await req(`/api/projects/${p.id}/tasks/${t.id}`, null, 'DELETE')).status, 200);
    assert.equal((await list()).length, 0);
  } finally { child.kill(); }
});
