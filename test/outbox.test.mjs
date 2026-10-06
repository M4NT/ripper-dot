import './helpers/signed-in.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.RIPPER_DATA = mkdtempSync(join(tmpdir(), 'ripper-outbox-'));
const ob = await import('../lib/outbox.mjs');

test('o que é temporário (tenta de novo) e o que é permanente', () => {
  for (const e of ['fetch failed', 'connect ECONNREFUSED 127.0.0.1:18080', 'ETIMEDOUT', 'Evolution respondeu 503', 'HTTP 429', { message: 'x', status: 502 }])
    assert.equal(ob.isTransient(typeof e === 'string' ? new Error(e) : e), true, String(e.message || e));
  for (const e of ['HTTP 400 número inválido', 'Invalid login: 535 auth failed', { message: 'x', status: 401 }])
    assert.equal(ob.isTransient(typeof e === 'string' ? new Error(e) : e), false, String(e.message || e));
});

test('espera crescente e esgota em "morto"; reenviar e descartar', () => {
  const t0 = 1_000_000;
  const id = ob.enqueue({ kind: 'email', payload: { to: 'a@b.c' }, target: 'a@b.c', error: 'fetch failed', now: t0 });
  assert.equal(ob.get(id).status, 'pending');
  assert.equal(ob.get(id).nextAt, t0 + 60_000);
  assert.deepEqual(ob.due(t0 + 59_000), []);
  assert.equal(ob.due(t0 + 60_000)[0].id, id);
  const waits = [];
  for (let i = 0; i < 4; i++) { ob.markFailed(id, new Error('ETIMEDOUT'), t0); waits.push(ob.get(id).nextAt - t0); }
  assert.deepEqual(waits.map(w => w / 60_000), [5, 15, 60, 240]);
  assert.equal(ob.markFailed(id, new Error('ETIMEDOUT'), t0), 'dead', 'esgotou as tentativas');
  assert.equal(ob.counts().dead, 1);
  assert.equal(ob.retryNow(id, t0), true);
  assert.equal(ob.get(id).status, 'pending');
  assert.equal(ob.markFailed(id, Object.assign(new Error('x'), { status: 401 }), t0), 'dead', 'erro permanente morre na hora');
  assert.equal(ob.discard(id), true);
  assert.equal(ob.get(id).status, 'discarded');
  const ok = ob.enqueue({ kind: 'email', payload: {}, error: 'fetch failed', now: t0 });
  ob.markSent(ok);
  assert.equal(ob.get(ok).status, 'sent');
});

test('de ponta a ponta: WhatsApp fora do ar → resposta vai para a fila → sai quando volta, registrada uma vez', async () => {
  const http = await import('node:http');
  const { spawn } = await import('node:child_process');
  const { readFileSync, mkdtempSync: mk } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  let down = true; const sent = [];
  const evo = http.createServer((req, res) => {
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
      if (!req.url.startsWith('/message/sendText')) return res.end('{}');
      if (down) { res.statusCode = 503; return res.end('{"error":"fora"}'); }
      sent.push(JSON.parse(b)); res.end('{}');
    });
  });
  await new Promise(r => evo.listen(0, '127.0.0.1', r));
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const dataDir = mk(join(tmpdir(), 'ripper-outbox-e2e-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TEST_PROVIDER: 'stream', HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0', RIPPER_OUTBOX_TICK_MS: '300', EVOLUTION_URL: `http://127.0.0.1:${evo.address().port}` }, stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  const wait = async (fn, ms = 20_000) => { let v; for (let i = 0; i < ms / 200 && !(v = await fn()); i++) await new Promise(r => setTimeout(r, 200)); return v; };
  const put = b => fetch(base + '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(b) });
  try {
    await wait(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } });
    const st = await (await fetch(base + '/api/state')).json();
    await put({ ui: { mode: 'enterprise' } });
    await put({ whatsappWeb: { enabled: true, agentId: st.agents[0].id, allowlist: ['5511988887777'] } });
    await fetch(base + '/api/channels/whatsapp-web/' + 'f'.repeat(48), { method: 'POST', body: '{}' });
    const { hookToken } = (await import('./helpers/evolution-secrets.mjs')).readEvolutionSecrets(dataDir);
    await fetch(base + '/api/channels/whatsapp-web/' + hookToken, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ripper-token': hookToken },
      body: JSON.stringify({ event: 'messages.upsert', data: { key: { id: 'm1', remoteJid: '5511988887777@s.whatsapp.net', fromMe: false }, pushName: 'Ana', message: { conversation: 'oi, tudo bem?' }, messageTimestamp: Math.floor(Date.now() / 1000) } }) });
    const queued = await wait(async () => (await (await fetch(base + '/api/outbox')).json()).items[0]);
    assert.ok(queued, 'a resposta deveria ir para a fila');
    assert.equal(queued.status, 'pending');
    assert.equal(sent.length, 0);
    down = false;
    await fetch(base + `/api/outbox/${queued.id}/retry`, { method: 'POST', headers: { origin: base } });
    assert.ok(await wait(async () => sent.length === 1), 'deveria sair quando o WhatsApp voltar');
    assert.equal(sent[0].number, '5511988887777');
    assert.ok(await wait(async () => !(await (await fetch(base + '/api/outbox')).json()).items.length), 'sai da fila depois de enviado');
    await new Promise(r => setTimeout(r, 1000));
    assert.equal(sent.length, 1, 'não envia duas vezes');
  } finally { child.kill(); evo.close(); }
});
