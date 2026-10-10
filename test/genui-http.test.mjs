import './helpers/signed-in.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from './helpers/free-port.mjs';

const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));

async function waitForHealth(base, ms = 60_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(base + '/api/health')).ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('servidor não subiu a tempo');
}

async function readSse(res) {
  const events = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const p of parts) {
        if (!p.startsWith('data: ')) continue;
        events.push(JSON.parse(p.slice(6)));
      }
    }
  } finally {
    reader.releaseLock();
  }
  return events;
}

async function withServer(fn) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-genui-'));
  const port = await freePort();
  const env = {
    ...process.env,
    RIPPER_DATA: dataDir,
    PORT: String(port),
    HOST: '127.0.0.1',
    RIPPER_TEST_PROVIDER: 'genui',
    HOME: dataDir,
    USERPROFILE: dataDir,
    JULIA_AUTOSTART: '0'
  };
  const child = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(base);
    await fn(base);
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('exit', r));
  }
}

const post = (base, path, body) => fetch(base + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: base },
  body: JSON.stringify(body)
});

test('SSE emite o cartão e POST /ui-actions devolve a escolha sem vazar segredo', async () => {
  await withServer(async base => {
    const spec = await (await fetch(base + '/openapi.json')).json();
    assert.ok(spec.paths['/api/chats/{chatId}/ui-actions']?.post);

    const [a] = (await (await fetch(base + '/api/state')).json()).agents;
    const res = await post(base, '/api/chat', {
      agentId: a.id,
      text: '[[ripper:test:genui]]',
      model: 'claude-sonnet-5-5',
      effort: 'low'
    });
    assert.equal(res.status, 200);
    const events = await readSse(res);
    const chatId = events.find(e => e.chatId)?.chatId;
    const ui = events.find(e => e.ui)?.ui;
    assert.ok(chatId);
    assert.ok(ui, 'o provedor de teste deveria emitir e.ui');
    assert.equal(ui.component, 'question');
    assert.equal(ui.state, 'input-available');

    const ok = await post(base, `/api/chats/${chatId}/ui-actions`, {
      partId: ui.id,
      action: 'submit',
      payload: { selected: ['ana'] }
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.text, 'Escolhi: Ana Ltda');
    assert.equal(body.part.state, 'answered');
    assert.equal(body.continue, true);

    const again = await post(base, `/api/chats/${chatId}/ui-actions`, {
      partId: ui.id,
      action: 'submit',
      payload: { selected: ['me'] }
    });
    assert.equal(again.status, 400);

    const missing = await post(base, `/api/chats/${chatId}/ui-actions`, {
      partId: 'nao-existe',
      action: 'submit'
    });
    assert.equal(missing.status, 404);

    const ghost = await post(base, '/api/chats/nao-existe/ui-actions', {
      partId: ui.id,
      action: 'submit'
    });
    assert.equal(ghost.status, 404);

    const chat = await (await fetch(base + `/api/chats/${chatId}`)).json();
    const step = (chat.messages || []).flatMap(m => m.steps || []).find(s => s.id === ui.id);
    assert.equal(step?.state, 'answered');
  });
});
