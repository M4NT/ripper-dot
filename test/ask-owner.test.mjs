import './helpers/signed-in.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('"Preciso de você": o agente pausa, a pergunta vai para a Caixa, a resposta volta e ele continua', async () => {
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-ask-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TEST_PROVIDER: 'ask', HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0' }, stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  const post = (path, b) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(b) });
  const wait = async (fn, ms = 15_000) => { let v; for (let i = 0; i < ms / 150 && !(v = await fn()); i++) await new Promise(r => setTimeout(r, 150)); return v; };
  try {
    await wait(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } });
    const [a] = (await (await fetch(base + '/api/state')).json()).agents;
    const res = post('/api/chat', { agentId: a.id, text: 'mande a proposta para a Ana', model: 'claude-sonnet-5-5', effort: 'low' });
    const q = await wait(async () => (await (await fetch(base + '/api/inbox')).json()).items.find(i => i.kind === 'approval' && i.approval.kind === 'question'));
    assert.ok(q, 'a pergunta deveria aparecer na Caixa');
    assert.equal(q.approval.command, 'Qual cliente devo usar?');
    assert.deepEqual(q.approval.options, ['Ana Ltda', 'Ana ME']);
    assert.equal((await post(`/api/approvals/${q.approval.id}`, { answer: 'Ana ME, a do CNPJ novo' })).status, 200);
    const sse = await (await res).text();
    assert.match(sse, /Resposta do usuário: Ana ME, a do CNPJ novo/, 'o agente recebe a resposta e continua');
    const inbox = await (await fetch(base + '/api/inbox')).json();
    assert.ok(!inbox.items.some(i => i.approval?.id === q.approval.id), 'respondida, sai da Caixa');
  } finally { child.kill(); }
});
