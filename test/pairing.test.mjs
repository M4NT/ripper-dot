import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pairingInvite, deviceStore, lanAddress, qrSvg, deviceName } from '../lib/pairing.mjs';

test('convite: uso único, expira, gerar outro invalida o anterior', async () => {
  const inv = pairingInvite({ ttlMs: 30 });
  const a = inv.create();
  const b = inv.create();
  assert.equal(inv.consume(a.token), false, 'QR novo invalida o anterior');
  assert.equal(inv.consume(b.token), true);
  assert.equal(inv.consume(b.token), false, 'uso único');
  const c = inv.create();
  await new Promise(r => setTimeout(r, 50));
  assert.equal(inv.consume(c.token), false, 'expirado');
  assert.equal(inv.consume(''), false);
  assert.equal(pairingInvite().ttlMs, 600e3);
});

test('aparelhos: só hash guardado, sobrevive a "reinício", desconectar revoga', () => {
  const list = []; let saves = 0;
  const s = deviceStore(() => list, () => saves++);
  const { token, device } = s.create('iPhone · Safari');
  assert.ok(!JSON.stringify(list).includes(token), 'token não fica em claro');
  assert.equal(s.valid(token).id, device.id);
  const again = deviceStore(() => JSON.parse(JSON.stringify(list)), () => {});
  assert.ok(again.valid(token), 'vale depois de recarregar do disco');
  assert.equal(s.valid('forjado'), null);
  assert.ok(!('tokenHash' in s.list()[0]));
  assert.equal(s.revoke(device.id), true);
  assert.equal(s.valid(token), null, 'desconectado não entra');
  assert.equal(s.revoke(device.id), false);
  assert.equal(saves, 2);
});

test('rede local, QR e nome do aparelho', () => {
  assert.equal(lanAddress({ lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], eth: [{ family: 'IPv4', address: '172.200.0.2', internal: false }], wifi: [{ family: 'IPv4', address: '192.168.0.7', internal: false }] }), '192.168.0.7');
  assert.equal(lanAddress({ 'VirtualBox Host-Only Network': [{ family: 'IPv4', address: '192.168.56.1', internal: false }], 'Wi-Fi': [{ family: 'IPv4', address: '192.168.1.20', internal: false }] }), '192.168.1.20');
  assert.equal(lanAddress({}), null);
  assert.match(qrSvg('http://192.168.0.7:3000/pair?t=x'), /^<svg/);
  assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17.0 Mobile Safari/604.1'), 'iPhone · Safari');
});

test('HTTP: rede desligada por padrão, convite só com rede, /pair cria sessão do aparelho, desconectar derruba', async () => {
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-pair-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_TOKEN: '', RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0' }, stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  const call = (path, method = 'GET', b, cookie = '') => fetch(base + path, { method, redirect: 'manual', headers: { 'content-type': 'application/json', origin: base, cookie }, body: b && JSON.stringify(b) });
  const pathOf = u => { const x = new URL(u); return x.pathname + x.search; };
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 150)); }
    const cookie = (await call('/api/auth/setup', 'POST', { password: 'minha-senha-123' })).headers.get('set-cookie').split(';')[0];
    const st = await (await call('/api/pair', 'GET', null, cookie)).json();
    assert.equal(st.lan.on, false, 'padrão: só localhost');
    assert.equal((await call('/api/pair/invite', 'POST', {}, cookie)).status, 409, 'sem rede ligada, sem convite');
    assert.equal((await call('/pair?t=qualquer')).status, 410);
    const lan = await (await call('/api/pair/lan', 'POST', { on: true }, cookie)).json();
    if (!lan.lan.address || lan.lan.error) return; // máquina sem rede local
    assert.equal(lan.lan.on, true);
    const old = await (await call('/api/pair/invite', 'POST', {}, cookie)).json();
    const inv = await (await call('/api/pair/invite', 'POST', {}, cookie)).json();
    assert.ok(inv.url.startsWith(`http://${lan.lan.address}:${port}/pair?t=`), inv.url);
    assert.match(inv.svg, /<svg/);
    assert.equal((await call(pathOf(old.url))).status, 410, 'QR antigo invalidado');
    const paired = await call(pathOf(inv.url));
    assert.equal(paired.status, 302);
    const dc = paired.headers.get('set-cookie');
    assert.match(dc, /ripper_device=.+HttpOnly; SameSite=Strict/);
    const device = dc.split(';')[0];
    assert.equal((await call(pathOf(inv.url))).status, 410, 'uso único');
    assert.equal((await call('/api/state', 'GET', null, device)).status, 200, 'aparelho entra sem senha');
    const { devices } = await (await call('/api/pair', 'GET', null, cookie)).json();
    assert.equal(devices.length, 1);
    assert.equal((await call(`/api/pair/devices/${devices[0].id}`, 'DELETE', null, cookie)).status, 200);
    assert.equal((await call('/api/state', 'GET', null, device)).status, 401, 'desconectado');
    await call('/api/pair/lan', 'POST', { on: false }, cookie);
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('exit', r));
  }
});
