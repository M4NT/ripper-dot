import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authed, hashPassword, verifyPassword, loginLimiter, sessionStore, passwordProblem } from '../lib/auth.mjs';

test('senha: scrypt com sal, confere só a certa; sessão presa ao hash; bloqueio após erros', async () => {
  const h = await hashPassword('senha-boa-123');
  assert.match(h, /^scrypt\$/);
  assert.notEqual(h, await hashPassword('senha-boa-123'));
  assert.equal(await verifyPassword('senha-boa-123', h), true);
  assert.equal(await verifyPassword('senha-ruim', h), false);
  assert.equal(await verifyPassword('x', 'lixo'), false);
  assert.ok(passwordProblem('curta'));
  const s = sessionStore(); const t = s.create('h1');
  assert.equal(s.valid(t, 'h1'), true);
  assert.equal(s.valid(t, 'h2'), false, 'trocar a senha derruba a sessão');
  const l = loginLimiter({ max: 3, lockMs: 60e3 });
  l.fail('ip'); l.fail('ip'); assert.equal(l.retryAfter('ip'), 0);
  l.fail('ip'); assert.ok(l.retryAfter('ip') > 0);
});

test('HTTP: criar senha, login, cookie HttpOnly/Strict, contêiner sem senha não entra, CSRF, bloqueio, sair', async () => {
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-auth-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_TOKEN: '', RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0' }, stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  const post = (path, b, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, ...headers }, body: JSON.stringify(b) });
  // como um contêiner chega: por loopback, mas com Host host.docker.internal
  const fromContainer = (path, method = 'GET', body) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: { host: `host.docker.internal:${port}`, 'content-type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    r.on('error', reject); r.end(body ? JSON.stringify(body) : undefined);
  });
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 150)); }
    assert.equal((await fetch(base + '/api/state')).status, 401, 'sem senha criada, nada passa');
    assert.deepEqual(await (await fetch(base + '/api/auth/status')).json(), { configured: false, authed: false, canSetup: true });
    assert.equal(await fromContainer('/api/auth/setup', 'POST', { password: 'do-conteiner-123' }), 403, 'contêiner não cria a senha');
    assert.equal((await post('/api/auth/setup', { password: 'curta' })).status, 400);
    const setup = await post('/api/auth/setup', { password: 'minha-senha-123' });
    assert.equal(setup.status, 200);
    const cookieHdr = setup.headers.get('set-cookie');
    assert.match(cookieHdr, /HttpOnly/); assert.match(cookieHdr, /SameSite=Strict/); assert.doesNotMatch(cookieHdr, /Secure/);
    const cookie = cookieHdr.split(';')[0];
    assert.equal((await fetch(base + '/api/state', { headers: { cookie } })).status, 200);
    assert.equal((await post('/api/auth/setup', { password: 'outra-senha-123' })).status, 409, 'senha só se cria uma vez');
    assert.equal(await fromContainer('/api/state'), 401, 'contêiner sem sessão não entra');
    assert.equal((await fetch(base + '/api/state', { headers: { cookie: 'ripper_session=forjado' } })).status, 401);
    assert.equal((await post('/api/auth/logout', {}, { cookie, origin: 'https://evil.example' })).status, 403, 'CSRF: outro site é recusado');
    assert.equal((await post('/api/auth/logout', {}, { cookie, origin: '', 'sec-fetch-site': 'cross-site' })).status, 403, 'CSRF sem Origin');
    const login = await post('/api/auth/login', { password: 'minha-senha-123' });
    assert.equal(login.status, 200);
    assert.equal((await fetch(base + '/api/state', { headers: { cookie: login.headers.get('set-cookie').split(';')[0] } })).status, 200);
    for (let i = 0; i < 5; i++) assert.equal((await post('/api/auth/login', { password: 'errada-123' })).status, 401);
    const locked = await post('/api/auth/login', { password: 'minha-senha-123' });
    assert.equal(locked.status, 429, 'bloqueado mesmo com a senha certa'); assert.ok(+locked.headers.get('retry-after') > 0);
    assert.equal((await post('/api/auth/logout', {}, { cookie })).status, 200);
    assert.equal((await fetch(base + '/api/state', { headers: { cookie } })).status, 401, 'sair derruba a sessão');
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('exit', r));
  }
});

const req = (headers = {}) => ({ headers });

test('sem token configurado, qualquer requisição passa', () => {
  assert.equal(authed(req(), ''), true);
  assert.equal(authed(req({ authorization: 'Bearer x' }), ''), true);
});

test('com token, exige Bearer ou cookie ripper_token', () => {
  const secret = 'ripper-test-secret';
  assert.equal(authed(req(), secret), false);
  assert.equal(authed(req({ authorization: 'Bearer wrong' }), secret), false);
  assert.equal(authed(req({ authorization: 'Bearer ripper-test-secret' }), secret), true);
  assert.equal(authed(req({ cookie: 'other=1; ripper_token=ripper-test-secret' }), secret), true);
  assert.equal(authed(req({ cookie: 'ripper_token=ripper-test-secret%21' }), 'ripper-test-secret!'), true);
});

test('comparação é segura em tamanho (timingSafeEqual)', () => {
  const secret = 'abcd';
  assert.equal(authed(req({ authorization: 'Bearer abc' }), secret), false);
  assert.equal(authed(req({ authorization: 'Bearer abcde' }), secret), false);
});
