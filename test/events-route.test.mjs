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
  normalizeEventsSnapshot,
  filterEventForWatch,
  parseWatchFromReq,
  _resetUserEventsForTests,
  USER_EVENTS_PATH,
  MAX_EVENT_CONNECTIONS
} from '../lib/events-route.mjs';
import {
  registerChatStream,
  unregisterChatStream,
  onChatStreamsChange,
  listStreamingChatIds,
  _resetChatStreamsForTests
} from '../lib/chat-stream.mjs';
import { applyChatDelta, liveRecordForChat, eventsUrl } from '../web/src/userEvents.js';

test.afterEach(() => {
  _resetUserEventsForTests();
  _resetChatStreamsForTests();
});

function mockReq(url = USER_EVENTS_PATH, headers = {}) {
  const req = new EventEmitter();
  req.method = 'GET';
  req.url = url;
  req.headers = headers;
  return req;
}

function mockRes() {
  const res = new EventEmitter();
  res.writable = true;
  res.writableLength = 0;
  res.chunks = [];
  res.status = 0;
  res.headers = {};
  res.writeHead = (code, h) => { res.status = code; res.headers = h; };
  res.write = chunk => { res.chunks.push(String(chunk)); return true; };
  res.end = (chunk) => { if (chunk) res.chunks.push(String(chunk)); res.writable = false; res.emit('close'); };
  return res;
}

function parsed(res) {
  return res.chunks.flatMap(c => {
    const data = String(c).split('\n').find(l => l.startsWith('data: '));
    if (!data) return [];
    try { return [JSON.parse(data.slice(6).trim())]; } catch { return []; }
  });
}

test('normalizeEventsSnapshot preenche chaves e ignora lixo', () => {
  assert.deepEqual(normalizeEventsSnapshot(null), { working: {}, approvals: [], live: {}, pendingInbox: {}, flows: {} });
  const n = normalizeEventsSnapshot({ working: { a: { tool: 'x' } }, approvals: [{ id: '1' }], extra: 1 });
  assert.equal(n.working.a.tool, 'x');
  assert.equal(n.approvals[0].id, '1');
  assert.deepEqual(n.live, {});
});

test('parseWatchFromReq e filterEventForWatch recortam live', () => {
  assert.deepEqual([...parseWatchFromReq({ url: '/api/events?watch=c1,c2' })], ['c1', 'c2']);
  const snap = filterEventForWatch({
    type: 'snapshot',
    live: { c1: { streaming: true, live: { content: 'segredo' } }, c2: { streaming: true, live: { content: 'b' } } }
  }, new Set(['c1']));
  assert.equal(snap.live.c1.live.content, 'segredo');
  assert.equal(snap.live.c2, undefined);
  const hidden = filterEventForWatch({ type: 'chat.delta', chatId: 'c1', textAppend: 'segredo' }, new Set(['c2']));
  assert.equal(hidden.textAppend, undefined);
  assert.equal(hidden.chatId, 'c1');
});

test('handleEventsRoute só atende GET /api/events', () => {
  const res = mockRes();
  assert.equal(handleEventsRoute({ method: 'POST' }, res, USER_EVENTS_PATH), false);
  assert.equal(handleEventsRoute({ method: 'GET' }, res, '/api/state'), false);
  assert.equal(res.status, 0);
});

test('GET /api/events abre SSE com hello e snapshot (instalação de um dono)', () => {
  const res = mockRes();
  const snap = { working: { ag1: { chatId: 'c1', tool: 'think' } }, approvals: [{ id: 'ap1', chatId: 'c1', status: 'pending' }] };
  assert.equal(handleEventsRoute(mockReq(), res, USER_EVENTS_PATH, { userKey: () => 'owner', snapshot: () => snap }), true);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/event-stream/);
  const ev = parsed(res);
  assert.equal(ev[0].type, 'hello');
  assert.equal(ev[0].singleOwner, true);
  assert.ok(ev[0].id);
  assert.equal(ev[1].type, 'snapshot');
  assert.equal(ev[1].working.ag1.chatId, 'c1');
  assert.equal(ev[1].approvals[0].id, 'ap1');
  res.end();
});

test('isolamento por userKey passa pela rota real', () => {
  const a = mockRes();
  const b = mockRes();
  handleEventsRoute(mockReq(), a, USER_EVENTS_PATH, { userKey: () => 'ana', snapshot: () => ({}) });
  handleEventsRoute(mockReq(), b, USER_EVENTS_PATH, { userKey: () => 'bia', snapshot: () => ({}) });
  publishUserEvent('ana', { type: 'working', working: { x: 1 } });
  assert.ok(parsed(a).some(e => e.type === 'working' && e.working.x === 1));
  assert.ok(!parsed(b).some(e => e.type === 'working' && e.working.x === 1));
  a.end();
  b.end();
});

test('mudança no snapshot depois do hello vira evento working', async () => {
  const res = mockRes();
  let working = {};
  assert.equal(handleEventsRoute(mockReq(), res, USER_EVENTS_PATH, {
    userKey: () => 'owner',
    snapshot: () => ({ working }),
    pollMs: 20
  }), true);
  mockReq().emit('close');
  working = { ag1: { chatId: 'c1', tool: 'think' } };
  await new Promise(r => setTimeout(r, 80));
  const ev = parsed(res);
  assert.equal(ev[0].type, 'hello');
  assert.equal(ev[1].type, 'snapshot');
  assert.deepEqual(ev[1].working, {});
  const work = ev.find(e => e.type === 'working' && e.working.ag1?.chatId === 'c1');
  assert.ok(work, 'poll deve emitir working, não outro snapshot');
  res.end();
});

test('segunda conexão não apaga o diff da primeira (working + aprovação)', async () => {
  let snap = { working: {}, approvals: [], live: {} };
  const deps = { snapshot: () => snap, pollMs: 25 };
  const a = mockRes();
  const b = mockRes();
  handleEventsRoute(mockReq(), a, USER_EVENTS_PATH, deps);
  snap = {
    working: { ag: { chatId: 'c1' } },
    approvals: [{ id: 'ap1', command: 'ls', reason: 'ver' }],
    live: { c1: { streaming: true, live: { agentId: 'ag', content: 'oi', steps: [] } } }
  };
  handleEventsRoute(mockReq('/api/events?watch=c1'), b, USER_EVENTS_PATH, deps);
  await new Promise(r => setTimeout(r, 90));
  const evA = parsed(a);
  assert.ok(evA.some(e => e.type === 'working' && e.working.ag?.chatId === 'c1'), 'aba já aberta recebe working');
  assert.ok(evA.some(e => e.type === 'approvals' && e.approvals[0]?.id === 'ap1'), 'aprovação no início do turno não some');
  const evB = parsed(b);
  assert.ok(evB.some(e => e.type === 'snapshot' && e.working.ag?.chatId === 'c1'));
  a.end();
  b.end();
});

test('live de uma conversa não vai para quem não assiste (rota real)', async () => {
  let live = { 'chat-a': { streaming: true, live: { agentId: 'x', content: 'segredo-alpha', steps: [] } } };
  const deps = { snapshot: () => ({ live, working: {}, approvals: [] }), pollMs: 20 };
  const a = mockRes();
  const b = mockRes();
  handleEventsRoute(mockReq('/api/events?watch=chat-a'), a, USER_EVENTS_PATH, deps);
  handleEventsRoute(mockReq('/api/events?watch=chat-b'), b, USER_EVENTS_PATH, deps);
  const snapB = parsed(b).find(e => e.type === 'snapshot');
  assert.equal(snapB.live['chat-a'], undefined);
  assert.ok(!JSON.stringify(parsed(b)).includes('segredo-alpha'));
  live = { 'chat-a': { streaming: true, live: { agentId: 'x', content: 'segredo-alpha mais', steps: [] } } };
  await new Promise(r => setTimeout(r, 80));
  assert.ok(JSON.stringify(parsed(a)).includes('segredo-alpha'));
  assert.ok(!JSON.stringify(parsed(b)).includes('segredo-alpha'));
  a.end();
  b.end();
});

test('Last-Event-ID reenvia a fila; snapshot some a conversa que acabou', () => {
  let live = { c1: { streaming: true, live: { agentId: 'x', content: 'a', steps: [] } } };
  const deps = { snapshot: () => ({ live, working: {}, approvals: [] }), pollMs: 10_000 };
  const a = mockRes();
  handleEventsRoute(mockReq('/api/events?watch=c1'), a, USER_EVENTS_PATH, deps);
  const first = parsed(a);
  const lastId = first.at(-1).id;
  live = {};
  registerChatStream('c1');
  unregisterChatStream('c1');
  const after = parsed(a).filter(e => e.id > lastId);
  assert.ok(after.some(e => e.type === 'chat.done' && e.chatId === 'c1'));
  const b = mockRes();
  handleEventsRoute(mockReq('/api/events?watch=c1', { 'last-event-id': String(lastId) }), b, USER_EVENTS_PATH, deps);
  const replay = parsed(b);
  assert.ok(replay.some(e => e.type === 'hello'));
  assert.ok(replay.some(e => e.type === 'chat.done' && e.chatId === 'c1') || replay.some(e => e.type === 'snapshot' && !e.live?.c1));
  a.end();
  b.end();
});

test('limite de conexões rejeita a seguinte', () => {
  const deps = { snapshot: () => ({}), maxConnections: 2, pollMs: 10_000 };
  const a = mockRes();
  const b = mockRes();
  const c = mockRes();
  assert.equal(handleEventsRoute(mockReq(), a, USER_EVENTS_PATH, deps), true);
  assert.equal(a.status, 200);
  assert.equal(handleEventsRoute(mockReq(), b, USER_EVENTS_PATH, deps), true);
  assert.equal(handleEventsRoute(mockReq(), c, USER_EVENTS_PATH, deps), true);
  assert.equal(c.status, 429);
  assert.match(c.chunks.join(''), /Muitas conexões/);
  a.end();
  b.end();
});

test('backpressure alto encerra o cliente lento', async () => {
  let working = {};
  const deps = { snapshot: () => ({ working }), pollMs: 20 };
  const res = mockRes();
  handleEventsRoute(mockReq(), res, USER_EVENTS_PATH, deps);
  res.writableLength = 2_000_000;
  working = { ag: { chatId: 'c1' } };
  await new Promise(r => setTimeout(r, 80));
  assert.equal(res.writable, false);
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

test('applyChatDelta e liveRecordForChat reconciliam snapshot sem a conversa', () => {
  assert.equal(eventsUrl(['c1', 'c1']), '/api/events?watch=c1');
  const rec = applyChatDelta({ content: 'oi', steps: [] }, { type: 'chat.delta', textAppend: '!', stepsFrom: 0, stepsAppend: [], agentId: 'a' });
  assert.equal(rec.live.content, 'oi!');
  assert.deepEqual(liveRecordForChat({ type: 'snapshot', live: {} }, 'c1'), { streaming: false });
  assert.equal(liveRecordForChat({ type: 'chat.done', chatId: 'c1' }, 'c1').streaming, false);
});

test('MAX_EVENT_CONNECTIONS é o teto padrão', () => {
  assert.equal(MAX_EVENT_CONNECTIONS, 8);
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
        const dataLine = p.split('\n').find(l => l.startsWith('data: '));
        if (!dataLine) continue;
        const e = JSON.parse(dataLine.slice(6));
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
    await fn(base, auth, env.RIPPER_TOKEN);
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

test('GET /api/events aceita cookie ripper_token (EventSource do navegador)', async () => {
  await withServer({}, async (base, _auth, token) => {
    const r = await fetch(base + '/api/events', {
      headers: { authorization: '', cookie: `ripper_token=${token}` }
    });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /text\/event-stream/);
    const ev = await readSse(r, { stopAfter: 1 });
    assert.equal(ev[0].type, 'hello');
    r.body.cancel();
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
    assert.ok(work, 'deveria emitir evento working (não só snapshot)');
    assert.ok(work.working[agent.id]?.chatId);
  });
});

test('dois clientes HTTP: o primeiro ainda recebe working depois do segundo conectar', async () => {
  await withServer({}, async (base, auth) => {
    const ac1 = new AbortController();
    const ac2 = new AbortController();
    const first = await fetch(base + '/api/events', { headers: auth, signal: ac1.signal });
    const second = await fetch(base + '/api/events', { headers: auth, signal: ac2.signal });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const st = await (await fetch(base + '/api/state', { headers: auth })).json();
    const agent = st.agents[0];
    const chatP = fetch(base + '/api/chat', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ agentId: agent.id, text: 'oi dois', model: 'claude-sonnet-5-5', effort: 'low' })
    });
    setTimeout(() => ac1.abort(), 15_000);
    const events = await readSse(first, {
      signal: ac1.signal,
      match: e => e.type === 'working' && e.working?.[agent.id]
    });
    ac1.abort();
    ac2.abort();
    await chatP.then(r => r.text()).catch(() => {});
    await second.body.cancel().catch(() => {});
    assert.ok(events.some(e => e.type === 'working' && e.working[agent.id]?.chatId));
  });
});
