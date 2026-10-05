import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emailConfig, emailReady } from '../lib/email.mjs';

test('servidores conhecidos se preenchem sozinhos; empresa usa imap./smtp. do domínio', () => {
  assert.equal(emailConfig({ user: 'a@gmail.com' }).imapHost, 'imap.gmail.com');
  assert.equal(emailConfig({ user: 'a@hotmail.com' }).smtpHost, 'smtp.office365.com');
  assert.equal(emailConfig({ user: 'a@minhaempresa.com.br' }).imapHost, 'imap.minhaempresa.com.br');
  assert.equal(emailConfig({ user: 'a@x.com', imapHost: 'mail.x.com' }).imapHost, 'mail.x.com');
  assert.equal(emailReady({ enabled: true, user: 'a@x.com', pass: '' }), false);
});

test('senha mascarada na API, cifrada no disco; teste de conexão falha com mensagem; gatilho de e-mail', async () => {
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-email-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TEST_PROVIDER: 'stream', HOME: dataDir, USERPROFILE: dataDir, RIPPER_SECRET_KEY_FILE: join(dataDir, 'k'), JULIA_AUTOSTART: '0' },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  const send = (path, b, method = 'POST') => fetch(base + path, { method, headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(b) });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
    await send('/api/settings', { email: { enabled: true, user: 'eu@empresa.test', pass: 'senha-secreta-123', imapHost: '127.0.0.1', imapPort: 1, smtpHost: '127.0.0.1', smtpPort: 1 } }, 'PUT');
    const st = await (await fetch(base + '/api/state')).json();
    assert.equal(st.settings.email.pass, '••••');
    await send('/api/settings', { email: { pass: '••••' } }, 'PUT'); // salvar de novo com a máscara não apaga a senha
    await new Promise(r => setTimeout(r, 400));
    const disk = readFileSync(join(dataDir, 'db.json'), 'utf8');
    assert.ok(!disk.includes('senha-secreta-123'), 'senha não fica em texto puro');
    assert.match(disk, /"pass":"enc:v1:/);
    const t = await send('/api/email/test', {});
    assert.equal(t.status, 400);
    assert.match((await t.json()).error, /Não conectou/);
    const r = await (await send('/api/routines', { agentId: st.agents[0].id, prompt: 'Resuma.', trigger: 'email', keywords: 'fatura, banco.com' })).json();
    assert.equal(r.trigger, 'email');
    assert.deepEqual(r.keywords, ['fatura', 'banco.com']);
  } finally { child.kill(); }
});
