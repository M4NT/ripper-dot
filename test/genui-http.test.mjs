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

async function startChat(base, text) {
  const [a] = (await (await fetch(base + '/api/state')).json()).agents;
  const res = await post(base, '/api/chat', {
    agentId: a.id,
    text,
    model: 'claude-sonnet-5-5',
    effort: 'low'
  });
  assert.equal(res.status, 200);
  const events = await readSse(res);
  return { events, chatId: events.find(e => e.chatId)?.chatId, ui: events.find(e => e.ui)?.ui };
}

test('SSE emite o cartão e POST /ui-actions devolve a escolha uma vez só', async () => {
  await withServer(async base => {
    const spec = await (await fetch(base + '/openapi.json')).json();
    assert.ok(spec.paths['/api/chats/{chatId}/ui-actions']?.post);
    assert.ok(spec.paths['/api/chats/{chatId}/ui-parts']?.post);

    const { chatId, ui } = await startChat(base, '[[ripper:test:genui]]');
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
    const copies = (chat.messages || []).flatMap(m => m.steps || []).filter(s => s.id === ui.id);
    assert.equal(copies.length, 1);
    assert.equal(copies[0].state, 'answered');
  });
});

test('rascunho Enviar manda o texto editado; setting aplica; cerca tem id no servidor; HTML não vai inteiro no live', async () => {
  await withServer(async base => {
    const draft = await startChat(base, '[[ripper:test:genui_draft]]');
    assert.equal(draft.ui?.component, 'draft_message');
    const sent = await post(base, `/api/chats/${draft.chatId}/ui-actions`, {
      partId: draft.ui.id,
      action: 'send',
      payload: { body: 'Texto editado pelo usuário na hora.' }
    });
    assert.equal(sent.status, 200);
    const sentBody = await sent.json();
    assert.match(sentBody.text, /Texto editado pelo usuário na hora/);

    const before = await (await fetch(base + '/api/settings')).json();
    assert.equal(!!before.settings?.pulse?.whatsapp, false);
    const setting = await startChat(base, '[[ripper:test:genui_setting]]');
    assert.equal(setting.ui?.component, 'setting');
    const applied = await post(base, `/api/chats/${setting.chatId}/ui-actions`, {
      partId: setting.ui.id,
      action: 'apply'
    });
    assert.equal(applied.status, 200);
    const after = await (await fetch(base + '/api/settings')).json();
    assert.equal(after.settings.pulse.whatsapp, true);

    const fence = await startChat(base, '[[ripper:test:genui_fence]]');
    const chat = await (await fetch(base + `/api/chats/${fence.chatId}`)).json();
    const fencePart = (chat.messages || []).flatMap(m => m.steps || []).find(s => s.kind === 'ui' && s.component === 'question');
    assert.ok(fencePart, 'a cerca deveria virar passo com id do servidor');
    const pick = await post(base, `/api/chats/${fence.chatId}/ui-actions`, {
      partId: fencePart.id,
      action: 'submit',
      payload: { selected: ['a'] }
    });
    assert.equal(pick.status, 200, await pick.text());
    const pickBody = await pick.json();
    assert.equal(pickBody.text, 'Escolhi: Formal');

    const same = await post(base, `/api/chats/${fence.chatId}/ui-parts`, {
      fence: '{"component":"question","props":{"prompt":"Qual tom?","options":[{"id":"a","label":"Formal"},{"id":"b","label":"Leve"}]}}'
    });
    assert.equal(same.status, 200);
    const sameBody = await same.json();
    assert.equal(sameBody.part.id, fencePart.id);

    const html = await startChat(base, '[[ripper:test:genui_html]]');
    assert.equal(html.ui?.component, 'html_preview');
    assert.ok(!html.ui.props?.html || html.ui.slim, 'o evento SSE não deve carregar o HTML inteiro no live');
    const saved = await (await fetch(base + `/api/chats/${html.chatId}`)).json();
    const full = (saved.messages || []).flatMap(m => m.steps || []).find(s => s.component === 'html_preview');
    assert.ok(String(full?.props?.html || '').length > 10_000, 'a mensagem gravada guarda o HTML completo');
  });
});
