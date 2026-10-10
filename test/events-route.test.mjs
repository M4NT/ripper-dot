import './helpers/signed-in.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePort } from './helpers/free-port.mjs';
import {
  handleEventsRoute,
  publishUserEvent,
  subscribeUserEvents,
  userEventClientCount,
  normalizeEventsSnapshot,
  _resetUserEventsForTests,
  USER_EVENTS_PATH
} from '../lib/events-route.mjs';
import {
  registerChatStream,
  unregisterChatStream,
  onChatStreamsChange,
  listStreamingChatIds,
  _resetChatStreamsForTests
} from '../lib/chat-stream.mjs';

test.afterEach(() => {
  _resetUserEventsForTests();
  _resetChatStreamsForTests();
});

function mockRes() {
  const res = new EventEmitter();
  res.writable = true;
  res.chunks = [];
  res.status = 0;
  res.headers = {};
  res.writeHead = (code, h) => { res.status = code; res.headers = h; };
  res.write = chunk => { res.chunks.push(String(chunk)); return true; };
  res.end = () => { res.writable = false; res.emit('close'); };
  return res;
}

function parsed(res) {
  return res.chunks
    .filter(c => c.startsWith('data: '))
    .map(c => JSON.parse(c.slice(6).trim()));
}

test('normalizeEventsSnapshot preenche chaves e ignora lixo', () => {
  assert.deepEqual(normalizeEventsSnapshot(null), { working: {}, approvals: [], live: {}, pendingInbox: {}, flows: {} });
  const n = normalizeEventsSnapshot({ working: { a: { tool: 'x' } }, approvals: [{ id: '1' }], extra: 1 });
  assert.equal(n.working.a.tool, 'x');
  assert.equal(n.approvals[0].id, '1');
  assert.deepEqual(n.live, {});
});

test('handleEventsRoute só atende GET /api/events', () => {
  const res = mockRes();
  assert.equal(handleEventsRoute({ method: 'POST' }, res, USER_EVENTS_PATH), false);
  assert.equal(handleEventsRoute({ method: 'GET' }, res, '/api/state'), false);
  assert.equal(res.status, 0);
});

test('GET /api/events abre SSE com hello e snapshot por usuário', () => {
  const req = new EventEmitter();
  req.method = 'GET';
  const res = mockRes();
  const snap = { working: { ag1: { chatId: 'c1', tool: 'think' } }, approvals: [{ id: 'ap1', chatId: 'c1', status: 'pending' }] };
  assert.equal(handleEventsRoute(req, res, USER_EVENTS_PATH, { userKey: () => 'owner', snapshot: () => snap }), true);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/event-stream/);
  const ev = parsed(res);
  assert.equal(ev[0].type, 'hello');
  assert.equal(ev[0].userKey, 'owner');
  assert.equal(ev[1].type, 'snapshot');
  assert.equal(ev[1].working.ag1.chatId, 'c1');
  assert.equal(ev[1].approvals[0].id, 'ap1');
  res.end();
});

test('publishUserEvent isola clientes de usuários diferentes', () => {
  const a = [];
  const b = [];
  const unA = subscribeUserEvents('ana', ev => a.push(ev));
  const unB = subscribeUserEvents('bia', ev => b.push(ev));
  publishUserEvent('ana', { type: 'working', working: { x: 1 } });
  publishUserEvent('bia', { type: 'approvals', approvals: [1] });
  publishUserEvent(null, { type: 'snapshot', working: {} });
  assert.deepEqual(a.map(e => e.type), ['working', 'snapshot']);
  assert.deepEqual(b.map(e => e.type), ['approvals', 'snapshot']);
  unA();
  unB();
  assert.equal(userEventClientCount(), 0);
});

test('onChatStreamsChange avisa início e fim do turno', () => {
  const seen = [];
  const off = onChatStreamsChange(e => seen.push(e));
  registerChatStream('chat-1', {});
  assert.deepEqual(listStreamingChatIds(), ['chat-1']);
  unregisterChatStream('chat-1');
  off();
  assert.deepEqual(seen, [
    { chatId: 'chat-1', phase: 'start', streaming: true },
    { chatId: 'chat-1', phase: 'end', streaming: false }
  ]);
});

const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));

async function waitFor(url, token, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('servidor não subiu a tempo');
}

async function readSse(res, { stopAfter, match, signal } = {}) {
  const events = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      if (signal?.aborted) break;
      let chunk;
      try { chunk = await reader.read(); }
      catch (e) {
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
        if (match && match(e)) return events;
        if (stopAfter && events.length >= stopAfter) return events;
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return events;
}

async function withServer(envExtra, fn) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-events-'));
  const port = await freePort();
  const env = {
    ...process.env,
    RIPPER_DATA: dataDir,
    PORT: String(port),
    HOST: '127.0.0.1',
    RIPPER_TOKEN: 'test-events-token',
    RIPPER_TEST_PROVIDER: 'slow',
    JULIA_AUTOSTART: '0',
    ...envExtra
  };
  const child = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${env.RIPPER_TOKEN}` };
  try {
    await waitFor(base + '/api/health', env.RIPPER_TOKEN, 60_000);
    await fn(base, auth);
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('exit', r));
  }
}

test('GET /api/events exige autenticação', async () => {
  await withServer({}, async base => {
    const r = await fetch(base + '/api/events', { headers: { authorization: 'Bearer errado' } });
    assert.equal(r.status, 401);
  });
});

test('GET /api/events emite working enquanto o agente responde', async () => {
  await withServer({}, async (base, auth) => {
    const ac = new AbortController();
    const evRes = await fetch(base + '/api/events', { headers: auth, signal: ac.signal });
    assert.equal(evRes.status, 200);
    assert.match(evRes.headers.get('content-type') || '', /text\/event-stream/);
    setTimeout(() => ac.abort(), 15_000);
    const st = await (await fetch(base + '/api/state', { headers: auth })).json();
    const agent = st.agents[0];
    const chatP = fetch(base + '/api/chat', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ agentId: agent.id, text: 'oi eventos', model: 'claude-sonnet-5-5', effort: 'low' })
    });
    const events = await readSse(evRes, {
      signal: ac.signal,
      match: e => e.working && Object.keys(e.working).length > 0
    });
    ac.abort();
    await chatP.then(r => r.text()).catch(() => {});
    assert.ok(events.some(e => e.type === 'hello'));
    assert.ok(events.some(e => e.type === 'snapshot'));
    const work = events.find(e => e.type === 'working' && Object.keys(e.working || {}).length);
    assert.ok(work, 'deveria emitir working com o agente ocupado');
    assert.ok(work.working[agent.id]?.chatId);
  });
});
