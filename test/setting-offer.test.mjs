import './helpers/signed-in.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from './helpers/free-port.mjs';

test('Configuração na conversa: o agente oferece o interruptor, nada muda até o clique; ao aprovar, a configuração liga', async () => {
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-setting-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TEST_PROVIDER: 'setting', HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0' }, stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  const post = (path, b, method = 'POST') => fetch(base + path, { method, headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(b) });
  const wait = async (fn, ms = 60_000) => { let v; for (let i = 0; i < ms / 150 && !(v = await fn()); i++) await new Promise(r => setTimeout(r, 150)); return v; };
  const pulse = async () => (await (await fetch(base + '/api/settings')).json()).settings.pulse?.enabled;
  try {
    await wait(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } });
    await post('/api/settings', { pulse: { enabled: false } }, 'PUT');
    const [a] = (await (await fetch(base + '/api/state')).json()).agents;
    const res = post('/api/chat', { agentId: a.id, text: 'quero um resumo todo dia', model: 'claude-sonnet-5-5', effort: 'low' });
    const card = await wait(async () => (await (await fetch(base + '/api/inbox')).json()).items.find(i => i.approval?.kind === 'setting'));
    assert.ok(card, 'o interruptor deveria aparecer');
    assert.equal(card.approval.setting.key, 'pulse.enabled');
    assert.equal(card.approval.setting.proposed, true);
    assert.equal(await pulse(), false, 'nada muda antes do clique');
    assert.equal((await post(`/api/approvals/${card.approval.id}`, { approve: true })).status, 200);
    assert.match(await (await res).text(), /ligado pelo usuário/);
    assert.equal(await pulse(), true, 'depois do clique, ligado');
  } finally { child.kill(); }
});
