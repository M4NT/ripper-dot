import './helpers/signed-in.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBulk, normalizeTag } from '../lib/chat-bulk.mjs';
import { freePort } from './helpers/free-port.mjs';

const fresh = () => [{ id: 'a' }, { id: 'b', tags: ['cliente'] }, { id: 'c' }];

test('arquivar, etiquetar e tirar etiqueta só nas selecionadas', () => {
  let r = applyBulk(fresh(), ['a', 'b'], 'archive');
  assert.deepEqual(r.chats.map(c => !!c.archived), [true, true, false]);
  r = applyBulk(fresh(), ['a', 'b'], 'tag', '  Cliente ');
  assert.deepEqual(r.chats.map(c => c.tags), [['cliente'], ['cliente'], undefined], 'sem duplicar etiqueta');
  r = applyBulk(fresh(), ['b'], 'untag', 'cliente');
  assert.equal(r.chats[1].tags, undefined);
  assert.equal(normalizeTag('  Muito   Importante  '), 'muito importante');
});

test('apagar pula a conversa que está respondendo; ação inválida recusa', () => {
  const r = applyBulk(fresh(), ['a', 'c'], 'delete', null, id => id === 'c');
  assert.deepEqual(r.chats.map(c => c.id), ['b', 'c']);
  assert.equal(r.skipped, 1);
  assert.throws(() => applyBulk(fresh(), ['a'], 'tag', ' '), /etiqueta/);
  assert.throws(() => applyBulk(fresh(), ['a'], 'explodir'), /desconhecida/);
});

test('rota de lote: etiqueta, arquiva, desarquiva e apaga conversas de verdade', async () => {
  const http = await import('node:http');
  const { spawn } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-bulk-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TEST_PROVIDER: 'stream', HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0' }, stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  const post = (path, b) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(b) });
  const state = () => fetch(base + '/api/state').then(r => r.json());
  try {
    for (let i = 0; i < 300; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
    const [a] = (await state()).agents;
    for (const t of ['um', 'dois', 'três']) await (await post('/api/chat', { agentId: a.id, text: t, model: 'claude-sonnet-5-5', effort: 'low' })).text();
    const ids = (await state()).chats.map(c => c.id);
    assert.equal(ids.length, 3);
    assert.equal((await (await post('/api/chats/bulk', { ids: ids.slice(0, 2), action: 'tag', tag: 'Cliente X' })).json()).changed, 2);
    await post('/api/chats/bulk', { ids: [ids[0]], action: 'archive' });
    let s = await state();
    assert.deepEqual(s.chats.find(c => c.id === ids[1]).tags, ['cliente x']);
    assert.equal(s.chats.find(c => c.id === ids[0]).archived, true);
    await post('/api/chats/bulk', { ids: [ids[0]], action: 'unarchive' });
    await post('/api/chats/bulk', { ids: [ids[2]], action: 'delete' });
    s = await state();
    assert.equal(s.chats.length, 2);
    assert.equal(s.chats.find(c => c.id === ids[0]).archived, undefined);
    assert.equal((await post('/api/chats/bulk', { ids: [], action: 'archive' })).status, 400);
  } finally { child.kill(); }
});
