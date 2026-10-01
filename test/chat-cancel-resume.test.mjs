import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { cancelChatStream, registerChatStream, unregisterChatStream, _resetChatStreamsForTests } from '../lib/chat-stream.mjs';

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

async function withServer(envExtra, fn) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-cancel-'));
  const port = await freePort();
  const env = {
    ...process.env,
    RIPPER_DATA: dataDir,
    PORT: String(port),
    HOST: '127.0.0.1',
    RIPPER_TOKEN: 'test-cancel-token',
    RIPPER_TEST_PROVIDER: 'slow',
    ...envExtra
  };
  const child = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${env.RIPPER_TOKEN}` };
  try {
    await waitFor(base + '/api/health', env.RIPPER_TOKEN, 15_000);
    await fn(base, auth);
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('exit', r));
  }
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

async function readSseUntil(res, predicate, { timeoutMs = 20_000 } = {}) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + timeoutMs;
  const events = [];
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
        if (predicate(e)) return { events, e };
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { events, e: null };
}

test('registerChatStream propaga abort e emit stopped', () => {
  _resetChatStreamsForTests();
  const parent = new AbortController();
  const seen = [];
  const { signal } = registerChatStream('c1', { signal: parent.signal, emit: e => seen.push(e) });
  parent.abort();
  assert.equal(signal.aborted, true);
  assert.ok(seen.some(e => e.stopped));
  unregisterChatStream('c1');
});

test('cancelChatStream aborta stream ativo', () => {
  _resetChatStreamsForTests();
  const parent = new AbortController();
  const { signal } = registerChatStream('c2', { signal: parent.signal });
  assert.equal(cancelChatStream('c2'), true);
  assert.equal(signal.aborted, true);
  unregisterChatStream('c2');
});

test('cancel via API e retomar nova mensagem sem 409', async () => {
  await withServer({}, async (base, auth) => {
    const st = await fetch(base + '/api/state', { headers: auth });
    const { agents } = await st.json();
    const agent = agents[0];

    let chatId;
    const res = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: agent.id, text: 'devagar', model: 'claude-sonnet-5-5' })
    });
    assert.equal(res.status, 200);

    let cancelled = false;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done || cancelled) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const p of parts) {
        if (!p.startsWith('data: ')) continue;
        const ev = JSON.parse(p.slice(6));
        if (ev.chatId) chatId = ev.chatId;
        if (ev.text && chatId && !cancelled) {
          cancelled = true;
          const cancel = await fetch(base + `/api/chats/${chatId}/cancel`, { method: 'POST', headers: auth });
          assert.equal(cancel.status, 200);
          reader.cancel().catch(() => {});
        }
      }
    }
    reader.releaseLock();
    assert.ok(chatId);

    await new Promise(r => setTimeout(r, 450));

    // A mensagem cortada guarda o motivo (a UI mostra "Você interrompeu a resposta.").
    const saved = await (await fetch(base + `/api/chats/${chatId}`, { headers: auth })).json();
    const cut = saved.messages.filter(m => m.role === 'assistant').at(-1);
    assert.equal(cut?.stopped, true);
    assert.equal(cut?.stopReason, 'user');

    const res2 = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: agent.id, chatId, text: 'segunda', model: 'claude-sonnet-5-5' })
    });
    assert.equal(res2.status, 200);
    const { events } = await readSseUntil(res2, ev => ev.done === true, { timeoutMs: 25_000 });
    assert.ok(events.some(ev => ev.done));

    const chat = await (await fetch(base + `/api/chats/${chatId}`, { headers: auth })).json();
    const users = chat.messages.filter(m => m.role === 'user');
    assert.equal(users.length, 2);
    assert.equal(users[1].content, 'segunda');
  });
});
