import './helpers/signed-in.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from './helpers/free-port.mjs';

test('rascunho antes da ferramenta vira nota nas atividades; a resposta é só o texto final', async () => {
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-notes-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TEST_PROVIDER: 'notes', HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0' }, stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 400; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 150)); }
    const [a] = (await (await fetch(base + '/api/state')).json()).agents;
    const sse = await (await fetch(base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ agentId: a.id, text: 'confira o arquivo', model: 'claude-sonnet-5-5', effort: 'low' }) })).text();
    const chatId = /"chatId":"([^"]+)"/.exec(sse)[1];
    const chat = await (await fetch(base + '/api/chats/' + chatId)).json();
    const m = (chat.messages || chat.chat.messages).at(-1);
    assert.equal(m.content, 'Pronto: o arquivo está certo.');
    assert.ok(m.steps.some(s => s.kind === 'note' && /Now implementing/.test(s.label)), 'o rascunho fica nas atividades');
  } finally { child.kill(); }
});
