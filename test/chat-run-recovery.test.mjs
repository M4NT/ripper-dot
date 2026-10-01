import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { repairChatRunsOnStartup, canResumeChatRun, trimPartialRepliesAfterLastUser } from '../lib/chat-run.mjs';

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

test('repairChatRunsOnStartup marca running como interrupted', () => {
  const chats = [
    { id: 'a', run: { runId: 'r1', status: 'running', lastEventSeq: 3, startedAt: 1 } },
    { id: 'b', run: { runId: 'r2', status: 'done', lastEventSeq: 9, startedAt: 1 } }
  ];
  repairChatRunsOnStartup(chats);
  assert.equal(chats[0].run.status, 'interrupted');
  assert.ok(chats[0].run.finishedAt);
  assert.equal(chats[1].run.status, 'done');
});

test('load() repara runs órfãs ao subir', () =>
  (async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ripper-run-'));
    writeFileSync(join(dir, 'db.json'), JSON.stringify({
      schemaVersion: 2,
      settings: { computer: {} },
      agents: [{ id: 'a1', name: 'Assistente', tools: ['web'], avatar: { type: 'circle' }, createdAt: 1, updatedAt: 1 }],
      chats: [{
        id: 'c1',
        agentId: 'a1',
        title: 'Teste',
        messages: [{ id: 'u1', role: 'user', content: 'oi', at: 1 }],
        createdAt: 1,
        updatedAt: 1,
        run: { runId: 'run-z', status: 'running', lastEventSeq: 2, startedAt: 1 }
      }],
      files: [],
      memories: [],
      routines: [],
      projects: [],
      artifacts: [],
      messages: [],
      approvals: [],
      skills: []
    }));
    const prev = process.env.RIPPER_DATA;
    process.env.RIPPER_DATA = dir;
    const store = await import('../lib/store.mjs');
    store._resetStoreForTests();
    const db = store.load();
    assert.equal(db.chats[0].run.status, 'interrupted');
    store._resetStoreForTests();
    process.env.RIPPER_DATA = prev;
  })());

test('canResumeChatRun só quando interrupted e sem resposta completa', () => {
  const chat = {
    messages: [
      { id: 'u1', role: 'user', content: 'pergunta' },
      { id: 'a1', role: 'assistant', content: '', stopped: true, agentId: 'x' }
    ],
    run: { runId: 'r', status: 'interrupted', lastEventSeq: 1, startedAt: 1 }
  };
  assert.equal(canResumeChatRun(chat).ok, true);
  trimPartialRepliesAfterLastUser(chat);
  assert.equal(chat.messages.length, 1);
});

test('GET /api/conversations/:id expõe run interrompida após boot', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-run-http-'));
  writeFileSync(join(dataDir, 'db.json'), JSON.stringify({
    schemaVersion: 2,
    settings: { computer: {} },
    agents: [{ id: 'a1', name: 'Assistente', tools: ['web'], avatar: { type: 'circle' }, createdAt: 1, updatedAt: 1 }],
    chats: [{
      id: 'c1',
      agentId: 'a1',
      title: 'Queda',
      messages: [{ id: 'u1', role: 'user', content: 'devagar', at: 1 }],
      createdAt: 1,
      updatedAt: 1,
      run: { runId: 'run-orphan', status: 'running', lastEventSeq: 4, startedAt: 1 }
    }],
    files: [],
    memories: [],
    routines: [],
    projects: [],
    artifacts: [],
    messages: [],
    approvals: [],
    skills: []
  }));
  const port = await freePort();
  const env = { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TOKEN: 'tok-run' };
  const child = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: 'Bearer tok-run' };
  try {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(base + '/api/health', { headers: auth });
        if (r.ok) break;
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    const chat = await (await fetch(base + '/api/conversations/c1', { headers: auth })).json();
    assert.equal(chat.interrupted, true);
    assert.equal(chat.run.status, 'interrupted');
    assert.equal(chat.run.lastEventSeq, 4);
    const onDisk = JSON.parse(readFileSync(join(dataDir, 'db.json'), 'utf8'));
    assert.equal(onDisk.chats[0].run.status, 'interrupted');
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('exit', r));
  }
});
