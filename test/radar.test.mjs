import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Radar: rotina em dias úteis, rodar agora e relatório vai para o e-mail do dono', async () => {
  let raw = '', rcpt = '';
  const smtp = net.createServer(sock => {
    let data = false;
    sock.write('220 ok\r\n');
    sock.on('data', d => {
      const s = d.toString();
      if (data) { raw += s; if (raw.includes('\r\n.\r\n')) { data = false; sock.write('250 ok\r\n'); } return; }
      for (const line of s.split('\r\n').filter(Boolean)) {
        if (/^EHLO/i.test(line)) sock.write('250-oi\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (/^AUTH/i.test(line)) sock.write('235 ok\r\n');
        else if (/^RCPT/i.test(line)) { rcpt += line; sock.write('250 ok\r\n'); }
        else if (/^DATA/i.test(line)) { data = true; sock.write('354 go\r\n'); }
        else if (/^QUIT/i.test(line)) { sock.write('221 tchau\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
  });
  await new Promise(r => smtp.listen(0, '127.0.0.1', r));
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-radar-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TEST_PROVIDER: 'stream', HOME: dataDir, USERPROFILE: dataDir, RIPPER_SECRET_KEY_FILE: join(dataDir, 'k'), JULIA_AUTOSTART: '0' },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  const send = (path, b, method = 'POST') => fetch(base + path, { method, headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(b) });
  try {
    for (let i = 0; i < 300; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
    await send('/api/settings', { email: { enabled: true, user: 'dono@empresa.test', pass: 'x', imapHost: '127.0.0.1', imapPort: 1, smtpHost: '127.0.0.1', smtpPort: smtp.address().port } }, 'PUT');
    const st = await (await fetch(base + '/api/state')).json();
    const r = await (await send('/api/routines', { agentId: st.agents[0].id, name: 'Radar', prompt: 'Vigie licitação.', dailyAt: '07:00', weekdays: true, quiet: true, deliver: { email: true, whatsapp: true } })).json();
    assert.equal(r.weekdays, true);
    assert.deepEqual(r.deliver, { email: true, whatsapp: true });
    assert.equal((await send('/api/routines/nao-existe/run', {})).status, 404);
    assert.equal((await send(`/api/routines/${r.id}/run`, {})).status, 200);
    for (let i = 0; i < 50 && !raw.includes('\r\n.\r\n'); i++) await new Promise(res => setTimeout(res, 200));
    assert.match(rcpt, /dono@empresa\.test/);
    assert.match(raw, /Radar/);
  } finally { child.kill(); smtp.close(); }
});
