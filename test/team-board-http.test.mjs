import './helpers/signed-in.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from './helpers/free-port.mjs';

const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));

async function readSseUntilDone(res, timeoutMs = 25_000) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const events = [];
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      if (Date.now() > deadline) throw new Error('timeout SSE');
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const p of parts) {
        if (!p.startsWith('data: ')) continue;
        const e = JSON.parse(p.slice(6));
        events.push(e);
        if (e.done) return events;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return events;
}

test('quadro do time: API cria tarefa, board e cancel em cascata', async () => {
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-team-board-'));
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TEST_PROVIDER: 'stream', HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0' },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  const req = (path, b, method = 'POST') => fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', origin: base },
    body: method === 'GET' ? undefined : JSON.stringify(b || {})
  });
  const wait = async (fn, ms = 60_000) => {
    let v;
    for (let i = 0; i < ms / 200 && !(v = await fn()); i++) await new Promise(r => setTimeout(r, 200));
    return v;
  };
  try {
    await wait(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } });
    const [a] = (await (await fetch(base + '/api/state')).json()).agents;
    const sse = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ agentId: a.id, text: 'oi-quadro', model: 'claude-sonnet-5-5' })
    });
    const events = await readSseUntilDone(sse);
    const chatId = events.find(e => e.chatId)?.chatId;
    assert.ok(chatId, 'conversa criada');

    const created = await (await req('/api/team-tasks', {
      ownerId: a.id, title: 'Pesquisar concorrentes', chatId, note: '3 nomes'
    })).json();
    assert.equal(created.title, 'Pesquisar concorrentes');
    assert.equal(created.status, 'todo');
    assert.equal(created.ownerId, a.id);

    const listed = await (await req(`/api/team-tasks?chatId=${chatId}`, null, 'GET')).json();
    assert.equal(listed.items.length, 1);

    const board = await (await req(`/api/chats/${chatId}/team-board`, null, 'GET')).json();
    assert.equal(board.tasks[0].title, 'Pesquisar concorrentes');
    assert.ok(board.members.some(m => m.agentId === a.id));

    const patched = await (await fetch(base + `/api/team-tasks/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ status: 'doing', progress: { percent: 30, note: 'listando' } })
    })).json();
    assert.equal(patched.status, 'doing');
    assert.equal(patched.progress.percent, 30);

    const later = await (await req('/api/team-tasks', {
      ownerId: a.id, title: 'Montar tabela', chatId, deps: [created.id]
    })).json();
    assert.equal(later.status, 'blocked');
    const cycle = await fetch(base + `/api/team-tasks/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ deps: [later.id] })
    });
    assert.equal(cycle.status, 400);

    const other = await (await req('/api/agents', { name: 'Pesquisador Extra' })).json();
    const forbidden = await fetch(base + `/api/team-tasks/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ status: 'done', agentId: other.id })
    });
    assert.equal(forbidden.status, 403);

    const short = await fetch(base + `/api/team-tasks/${created.id.slice(0, 8)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ progress: { percent: 50, note: 'meio' } })
    });
    assert.equal(short.status, 200);
    assert.equal((await short.json()).progress.percent, 50);

    const self = await req(`/api/agents/${a.id}/delegate`, {
      ownerId: a.id, originChatId: chatId, title: 'auto', prompt: 'não'
    });
    assert.equal(self.status, 400);

    const del = await req(`/api/agents/${other.id}/delegate`, {
      ownerId: a.id, originChatId: chatId, title: 'Isolada', prompt: 'resuma em uma linha', isolated: true
    });
    assert.equal(del.status, 200);
    const delegated = await del.json();
    assert.equal(delegated.task.assigneeId, other.id);
    assert.ok(delegated.childChatId);

    const cancel = await req(`/api/chats/${chatId}/cancel`, {});
    assert.equal(cancel.status, 200);
    const after = await (await req(`/api/team-tasks?chatId=${chatId}`, null, 'GET')).json();
    assert.ok(after.items.some(t => t.id === created.id && t.status === 'cancelled'));
    assert.ok(!after.items.some(t => t.status === 'doing'));
  } finally {
    child.kill();
  }
});
