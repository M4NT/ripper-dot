import './helpers/signed-in.mjs';
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
    for (let i = 0; i < 300; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
    await send('/api/settings', { email: { enabled: true, user: 'eu@empresa.test', pass: 'senha-secreta-123', imapHost: '127.0.0.1', imapPort: 1, smtpHost: '127.0.0.1', smtpPort: 1 } }, 'PUT');
    const st = await (await fetch(base + '/api/state')).json();
    assert.equal(st.settings.email.pass, '••••');
    await send('/api/settings', { email: { pass: '••••' } }, 'PUT'); // salvar de novo com a máscara não apaga a senha
    let disk = ''; // espera o db.json ser gravado (máquina carregada pode demorar mais que 400 ms)
    for (let i = 0; i < 100 && !/"pass":"enc:v1:/.test(disk); i++) { await new Promise(r => setTimeout(r, 100)); try { disk = readFileSync(join(dataDir, 'db.json'), 'utf8'); } catch {} }
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

test('anexos: nome seguro, texto direto de CSV/HTML, dica de leitura para PDF/Word/Excel', async () => {
  const { safeName, attachmentText, readHint } = await import('../lib/email.mjs');
  assert.equal(safeName('../../etc/passwd'), 'passwd');
  assert.equal(safeName('Relatório final (v2).pdf'), 'Relatório final (v2).pdf');
  assert.equal(safeName('.bashrc'), 'bashrc');
  assert.equal(attachmentText('a.csv', Buffer.from('nome;valor\nana;10')), 'nome;valor\nana;10');
  assert.equal(attachmentText('a.html', Buffer.from('<style>x{}</style><p>Olá <b>mundo</b></p>')), 'Olá mundo');
  assert.equal(attachmentText('a.pdf', Buffer.from('%PDF')), null);
  assert.match(readHint('/work/anexos/a.pdf'), /pypdf\.PdfReader\('\/work\/anexos\/a\.pdf'\)/);
  assert.match(readHint('/work/anexos/a.xlsx'), /read_excel/);
  for (const f of ['pdf', 'docx', 'pptx', 'xlsx']) assert.ok(!readHint(`/work/anexos/a.${f}`).includes('\n'), `comando de ${f} numa linha só (quebra real derruba o python -c)`);
  assert.equal(readHint('/work/anexos/a.zip'), null);
});

test('envio com anexo: o arquivo chega no SMTP como anexo de verdade', async () => {
  const net = await import('node:net');
  const { sendEmail } = await import('../lib/email.mjs');
  const { writeFileSync } = await import('node:fs');
  let raw = '';
  const srv = net.createServer(sock => {
    let data = false;
    sock.write('220 ok\r\n');
    sock.on('data', d => {
      const s = d.toString();
      if (data) { raw += s; if (raw.includes('\r\n.\r\n')) { data = false; sock.write('250 ok\r\n'); } return; }
      for (const line of s.split('\r\n').filter(Boolean)) {
        if (/^EHLO/i.test(line)) sock.write('250-oi\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (/^AUTH/i.test(line)) sock.write('235 ok\r\n');
        else if (/^DATA/i.test(line)) { data = true; sock.write('354 go\r\n'); }
        else if (/^QUIT/i.test(line)) { sock.write('221 tchau\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'ripper-att-'));
  writeFileSync(join(dir, 'proposta.pdf'), '%PDF-1.4 conteúdo de teste');
  try {
    await sendEmail({ user: 'eu@empresa.test', pass: 'x', smtpHost: '127.0.0.1', smtpPort: srv.address().port },
      { to: 'cliente@x.test', subject: 'Proposta', text: 'Segue.', attachments: [{ filename: 'proposta.pdf', path: join(dir, 'proposta.pdf') }] });
    assert.match(raw, /Content-Disposition: attachment; filename=proposta\.pdf/);
    assert.match(raw, new RegExp(Buffer.from('%PDF-1.4 conteúdo de teste').toString('base64').slice(0, 20)));
  } finally { srv.close(); }
});
