import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

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
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-sse-'));
  const port = await freePort();
  const env = {
    ...process.env,
    RIPPER_DATA: dataDir,
    PORT: String(port),
    HOST: '127.0.0.1',
    RIPPER_TOKEN: 'test-sse-token',
    RIPPER_TEST_PROVIDER: 'stream',
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

/** Lê eventos SSE até o stream fechar ou até `stopAfter` eventos. */
async function readSse(res, { stopAfter, onEvent, signal } = {}) {
  const events = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      if (signal?.aborted) break;
      let chunk;
      try {
        chunk = await reader.read();
      } catch (e) {
        if (e.name === 'AbortError' || signal?.aborted) break;
        throw e;
      }
      const { value, done } = chunk;
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const p of parts) {
        if (!p.startsWith('data: ')) continue;
        const e = JSON.parse(p.slice(6));
        events.push(e);
        onEvent?.(e);
        if (stopAfter && events.length >= stopAfter) return events;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return events;
}

async function firstAgent(base, auth) {
  const st = await fetch(base + '/api/state', { headers: auth });
  assert.equal(st.status, 200);
  const { agents } = await st.json();
  assert.ok(agents.length >= 1);
  return agents[0];
}

test('POST /api/chat emite SSE com tokens e persiste a resposta', async () => {
  await withServer({}, async (base, auth) => {
    const agent = await firstAgent(base, auth);
    const res = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: agent.id,
        text: 'Olá mundo',
        model: 'claude-sonnet-5-5',
        effort: 'low',
        voice: true
      })
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/event-stream/);

    const events = await readSse(res);
    assert.ok(events.some(e => e.chatId));
    assert.ok(events.some(e => e.route?.model === 'claude-sonnet-5-5'));
    assert.ok(events.some(e => e.speaker === agent.id));
    const tokens = events.filter(e => e.text).map(e => e.text).join('');
    assert.equal(tokens, 'Olá mundo');
    assert.ok(events.some(e => e.turnDone === agent.id));
    assert.ok(events.some(e => e.done === true));

    const chatId = events.find(e => e.chatId).chatId;
    await new Promise(r => setTimeout(r, 250));
    const chatRes = await fetch(base + `/api/chats/${chatId}`, { headers: auth });
    const chat = await chatRes.json();
    const assistant = chat.messages.filter(m => m.role === 'assistant').at(-1);
    assert.equal(assistant?.content, 'Olá mundo');
    assert.equal(assistant?.model, 'claude-sonnet-5-5');
    assert.equal(chat.messages.find(m => m.role === 'user')?.voice, true, 'mensagem ditada fica marcada');
    assert.ok(assistant?.timing?.totalMs >= 0, 'resposta guarda o tempo do turno');
  });
});

test('abortar o cliente interrompe o stream e marca stopped', async () => {
  await withServer({ RIPPER_TEST_PROVIDER: 'slow' }, async (base, auth) => {
    const agent = await firstAgent(base, auth);
    const ac = new AbortController();
    const res = await fetch(base + '/api/chat', {
      method: 'POST',
      signal: ac.signal,
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: agent.id,
        text: 'vai devagar',
        model: 'claude-sonnet-5-5'
      })
    });
    assert.equal(res.status, 200);

    let chatId;
    let events = [];
    try {
      events = await readSse(res, {
        signal: ac.signal,
        onEvent(e) {
          if (e.chatId) chatId = e.chatId;
          if (e.text && !ac.signal.aborted) ac.abort();
        }
      });
    } catch (e) {
      if (e.name !== 'AbortError') throw e;
    }
    assert.ok(events.some(e => e.text));
    assert.ok(chatId);

    await new Promise(r => setTimeout(r, 400));
    const chat = await (await fetch(base + `/api/chats/${chatId}`, { headers: auth })).json();
    const assistant = chat.messages.filter(m => m.role === 'assistant').at(-1);
    assert.equal(assistant?.stopped, true);
    assert.ok((assistant?.content || '').length > 0);
  });
});

test('falha do provedor antes do texto emite warn e grava error (sem fallback em modo teste)', async () => {
  await withServer({ RIPPER_TEST_PROVIDER: 'fail' }, async (base, auth) => {
    const agent = await firstAgent(base, auth);
    const res = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: agent.id,
        text: '[[ripper:test:fail]] deve falhar',
        model: 'claude-sonnet-5-5'
      })
    });
    assert.equal(res.status, 200);
    const events = await readSse(res);
    const warns = events.filter(e => e.warn);
    assert.equal(warns.length, 1);
    assert.match(warns[0].warn, /falhou/i);
    assert.equal(events.some(e => e.handoff), false);
    assert.equal(events.filter(e => e.text).join(''), '');

    const chatId = events.find(e => e.chatId).chatId;
    await new Promise(r => setTimeout(r, 250));
    const chat = await (await fetch(base + `/api/chats/${chatId}`, { headers: auth })).json();
    const assistant = chat.messages.filter(m => m.role === 'assistant').at(-1);
    assert.match(assistant?.error || '', /mock falhou/i);
    assert.equal(assistant?.content || '', '');
  });
});
