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

test('status ao vivo: agente aparece trabalhando durante a resposta e some ao terminar; duplicar copia só a configuração', async () => {
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-live-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TEST_PROVIDER: 'slow', HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0' }, stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  const post = (path, b) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(b || {}) });
  const wait = async (fn, ms = 60_000) => { let v; for (let i = 0; i < ms / 100 && !(v = await fn()); i++) await new Promise(r => setTimeout(r, 100)); return v; };
  try {
    await wait(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } });
    const [a] = (await (await fetch(base + '/api/state')).json()).agents;
    const working = () => fetch(base + '/api/agents/working').then(r => r.json()).then(j => j.working);
    assert.deepEqual(await working(), {});
    const res = await post('/api/chat', { agentId: a.id, text: 'oi', model: 'claude-sonnet-5-5', effort: 'low' });
    const live = await wait(async () => (await working())[a.id]);
    assert.ok(live?.chatId, 'deveria aparecer trabalhando, com a conversa');
    await res.text(); // espera a resposta terminar
    assert.ok(await wait(async () => !(await working())[a.id]), 'deveria sumir ao terminar');

    await post('/api/routines', { agentId: a.id, name: 'R', prompt: 'x', dailyAt: '08:00' });
    const copy = await (await post(`/api/agents/${a.id}/duplicate`)).json();
    assert.notEqual(copy.id, a.id);
    assert.match(copy.name, /\(cópia\)$/);
    assert.deepEqual(copy.tools, a.tools);
    assert.equal(copy.instructions, a.instructions);
    assert.equal(copy.vmId, null);
    const st = await (await fetch(base + '/api/state')).json();
    assert.equal(st.routines.filter(r => r.agentId === copy.id).length, 0, 'rotinas não vão junto');
  } finally { child.kill(); }
});
