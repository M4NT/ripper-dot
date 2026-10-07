import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import {
  _resetIdempotencyForTests,
  beginIdempotency,
  completeIdempotency,
  hashRequestBody,
  idempotencyScopeKey,
  readIdempotencyKey,
  releaseIdempotency,
  replayIdempotentResponse
} from '../lib/idempotency.mjs';
import { _resetStoreForTests } from '../lib/store.mjs';
import { freePort } from './helpers/free-port.mjs';

const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));

function withDataDir(fn) {
  const prev = process.env.RIPPER_DATA;
  const dir = mkdtempSync(join(tmpdir(), 'ripper-idem-'));
  process.env.RIPPER_DATA = dir;
  _resetStoreForTests();
  _resetIdempotencyForTests();
  return fn(dir).finally(() => {
    process.env.RIPPER_DATA = prev;
    _resetStoreForTests();
    _resetIdempotencyForTests();
  });
}

test('readIdempotencyKey valida formato', () => {
  assert.throws(() => readIdempotencyKey({ headers: { 'idempotency-key': 'curta' } }), /inválida/);
  assert.equal(readIdempotencyKey({ headers: { 'idempotency-key': 'abcd1234' } }), 'abcd1234');
  assert.equal(readIdempotencyKey({ headers: {} }), null);
});

test('begin/complete/replay e conflito de corpo', () =>
  withDataDir(async () => {
    const scope = idempotencyScopeKey('tok', 'POST', '/api/chat', 'key-req-01');
    const h1 = hashRequestBody(Buffer.from('{"a":1}'));
    const h2 = hashRequestBody(Buffer.from('{"a":2}'));
    assert.deepEqual(beginIdempotency(scope, h1), { kind: 'proceed' });
    assert.deepEqual(beginIdempotency(scope, h2), { kind: 'conflict' });
    assert.deepEqual(beginIdempotency(scope, h1), { kind: 'in_progress' });
    completeIdempotency(scope, h1, {
      statusCode: 200,
      responseHeaders: { 'content-type': 'text/plain' },
      responseBody: Buffer.from('ok')
    });
    const replay = beginIdempotency(scope, h1);
    assert.equal(replay.kind, 'replay');
    assert.equal(replay.record.responseBody.toString(), 'ok');
    releaseIdempotency(scope);
  }));

test('replayIdempotentResponse envia cabeçalho idempotency-replayed', () =>
  withDataDir(async () => {
    const chunks = [];
    const res = {
      writeHead(code, hdrs) {
        this.statusCode = code;
        this.headers = hdrs;
      },
      end(buf) {
        chunks.push(buf);
      }
    };
    replayIdempotentResponse(res, {
      statusCode: 201,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: Buffer.from('{}'),
      bodyFingerprint: 'abc'
    }, { 'x-test': '1', 'idempotency-replayed': 'true' });
    assert.equal(res.statusCode, 201);
    assert.equal(res.headers['idempotency-replayed'], 'true');
    assert.equal(res.headers['x-test'], '1');
    assert.equal(Buffer.concat(chunks).toString(), '{}');
  }));


async function withServer(envExtra, fn) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-idem-http-'));
  const port = await freePort();
  const env = {
    ...process.env,
    RIPPER_DATA: dataDir,
    PORT: String(port),
    HOST: '127.0.0.1',
    RIPPER_TOKEN: 'test-idem-token',
    RIPPER_TEST_PROVIDER: 'stream',
    RIPPER_IDEMPOTENCY_TTL_MS: '3600000',
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

async function drainSse(res) {
  const text = await res.text();
  const events = [];
  for (const block of text.split('\n\n')) {
    if (!block.startsWith('data: ')) continue;
    events.push(JSON.parse(block.slice(6)));
  }
  return events;
}

test('POST /api/chat: replay idempotente não duplica mensagem', async () => {
  await withServer({}, async (base, auth) => {
    const st = await (await fetch(base + '/api/state', { headers: auth })).json();
    const agent = st.agents[0];
    const body = JSON.stringify({ agentId: agent.id, text: 'idem-once', model: 'claude-sonnet-5-5', effort: 'low' });
    const headers = { ...auth, 'content-type': 'application/json', 'idempotency-key': 'replay-chat-01' };

    const r1 = await fetch(base + '/api/chat', { method: 'POST', headers, body });
    assert.equal(r1.status, 200);
    assert.notEqual(r1.headers.get('idempotency-replayed'), 'true');
    const ev1 = await drainSse(r1);
    const chatId = ev1.find(e => e.chatId)?.chatId;
    assert.ok(chatId);
    assert.ok(ev1.some(e => e.done));

    await new Promise(r => setTimeout(r, 200));

    const r2 = await fetch(base + '/api/chat', { method: 'POST', headers, body });
    assert.equal(r2.status, 200);
    assert.equal(r2.headers.get('idempotency-replayed'), 'true');
    const ev2 = await drainSse(r2);
    assert.equal(ev2.find(e => e.chatId)?.chatId, chatId);

    const chat = await (await fetch(base + `/api/chats/${chatId}`, { headers: auth })).json();
    assert.equal(chat.messages.filter(m => m.role === 'user').length, 1);
  });
});

test('POST /api/chat: mesma chave e corpo diferente → 409', async () => {
  await withServer({}, async (base, auth) => {
    const st = await (await fetch(base + '/api/state', { headers: auth })).json();
    const agent = st.agents[0];
    const headers = { ...auth, 'content-type': 'application/json', 'idempotency-key': 'conflict-key-1' };
    const r1 = await fetch(base + '/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({ agentId: agent.id, text: 'primeira', model: 'claude-sonnet-5-5' })
    });
    await drainSse(r1);

    const r2 = await fetch(base + '/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({ agentId: agent.id, text: 'segunda', model: 'claude-sonnet-5-5' })
    });
    assert.equal(r2.status, 409);
    const err = await r2.json();
    assert.match(err.error, /Idempotency-Key/);
  });
});

test('POST /api/chat com chatId existente respeita idempotência', async () => {
  await withServer({}, async (base, auth) => {
    const st = await (await fetch(base + '/api/state', { headers: auth })).json();
    const agent = st.agents[0];
    const open = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: agent.id, text: 'abrir', model: 'claude-sonnet-5-5' })
    });
    const chatId = (await drainSse(open)).find(e => e.chatId)?.chatId;
    assert.ok(chatId);

    const body = JSON.stringify({ agentId: agent.id, chatId, text: 'continuar', model: 'claude-sonnet-5-5' });
    const headers = { ...auth, 'content-type': 'application/json', 'idempotency-key': 'chatid-idem-01' };
    await drainSse(await fetch(base + '/api/chat', { method: 'POST', headers, body }));
    await drainSse(await fetch(base + '/api/chat', { method: 'POST', headers, body }));

    const chat = await (await fetch(base + `/api/chats/${chatId}`, { headers: auth })).json();
    assert.equal(chat.messages.filter(m => m.role === 'user' && m.content === 'continuar').length, 1);
  });
});

test('413 por http-budget ocorre antes da idempotência; replay ecoa X-Request-Id', async () => {
  await withServer({ RIPPER_MAX_BODY_BYTES: '64' }, async (base, auth) => {
    const stRes = await fetch(base + '/api/state', { headers: auth });
    assert.equal(stRes.status, 200);
    const st = await stRes.json();
    const agent = st.agents[0];
    const huge = JSON.stringify({ agentId: agent.id, text: 'x'.repeat(200), model: 'claude-sonnet-5-5' });
    const headers = {
      ...auth,
      'content-type': 'application/json',
      'idempotency-key': 'budget-before-1',
      'x-request-id': 'req-413-test-01'
    };
    const denied = await fetch(base + '/api/chat', { method: 'POST', headers, body: huge });
    assert.equal(denied.status, 413);

    const okBody = JSON.stringify({ agentId: agent.id, text: 'a' });
    const okHeaders = { ...auth, 'content-type': 'application/json', 'idempotency-key': 'budget-before-1' };
    const r1 = await fetch(base + '/api/chat', { method: 'POST', headers: okHeaders, body: okBody });
    assert.equal(r1.status, 200);
    assert.ok(r1.headers.get('x-request-id'));
    await drainSse(r1);

    const r2 = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { ...okHeaders, 'x-request-id': 'req-replay-02' },
      body: okBody
    });
    assert.equal(r2.status, 200);
    assert.equal(r2.headers.get('idempotency-replayed'), 'true');
    assert.equal(r2.headers.get('x-request-id'), 'req-replay-02');
    await drainSse(r2);
  });
});

test('"Tentar de novo" com a mesma chave não roda o turno duas vezes', async () => {
  await withServer({ RIPPER_TEST_PROVIDER: 'slow' }, async (base, auth) => {
    const st = await (await fetch(base + '/api/state', { headers: auth })).json();
    const body = JSON.stringify({ agentId: st.agents[0].id, text: 'retry-once', model: 'claude-sonnet-5-5' });
    const headers = { ...auth, 'content-type': 'application/json', 'idempotency-key': 'retry-same-01' };
    // 1º envio: o servidor recebeu, o cliente desiste (como o retry do Chat.jsx)
    const ac = new AbortController();
    await fetch(base + '/api/chat', { method: 'POST', headers, body, signal: ac.signal });
    ac.abort();
    await new Promise(r => setTimeout(r, 300));
    // retry com a mesma chave e corpo: replay ou 409 "em processamento" — nunca um segundo turno
    for (let i = 0; i < 50; i++) {
      const r2 = await fetch(base + '/api/chat', { method: 'POST', headers, body });
      if (r2.status === 409) { await r2.text(); await new Promise(r => setTimeout(r, 200)); continue; }
      await drainSse(r2);
      break;
    }
    const chats = (await (await fetch(base + '/api/state', { headers: auth })).json()).chats || [];
    let users = 0;
    for (const c of chats) {
      const full = await (await fetch(base + `/api/chats/${c.id}`, { headers: auth })).json();
      users += (full.messages || []).filter(m => m.role === 'user' && m.content === 'retry-once').length;
    }
    assert.equal(users, 1);
  });
});

test('"<Agente> precisa de você" sai da Caixa quando você responde na conversa', async () => {
  await withServer({}, async (base, auth) => {
    const st = await (await fetch(base + '/api/state', { headers: auth })).json();
    const headers = { ...auth, 'content-type': 'application/json' };
    const blocked = async () => (await (await fetch(base + '/api/inbox', { headers: auth })).json()).items.filter(i => /precisa de você/.test(i.title || ''));
    const r1 = await fetch(base + '/api/chat', { method: 'POST', headers, body: JSON.stringify({ agentId: st.agents[0].id, text: 'BLOQUEADO: preciso que você me passe a senha.', model: 'claude-sonnet-5-5' }) });
    const chatId = (await drainSse(r1)).find(e => e.chatId)?.chatId;
    assert.equal((await blocked()).length, 1);
    await drainSse(await fetch(base + '/api/chat', { method: 'POST', headers, body: JSON.stringify({ agentId: st.agents[0].id, chatId, text: 'tá aqui', model: 'claude-sonnet-5-5' }) }));
    assert.equal((await blocked()).length, 0);
  });
});
