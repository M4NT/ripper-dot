import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePort } from './helpers/free-port.mjs';
import {
  vncClientUrl,
  vncWsPath,
  matchVncProxy,
  vncSecretPath,
  ensureVncSecret,
  parseVncPassword,
  generateVncPassword,
  createCachedLoader,
  serveVncStatic,
  resolveVncStatic,
  vncStaticHeaders,
  pickWsHeaders,
  filterUpgradeHeaders,
  vncOriginAllowed,
  vncEncryptChallenge,
  createRfbAuthFilter,
  writeWsFrame,
  readWsFrame,
  applyVncPasswordForAgent,
  attachVncUpgrade,
  handleVncUpgrade,
  forwardUpgrade,
  proxyVncWebSocket,
  VNC_PASSWORD_CHECK_SCRIPT,
  VNC_PASSWORD_APPLY_SCRIPT,
  VncError
} from '../lib/vnc-proxy.mjs';

const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));

test('vncClientUrl é same-origin, sem senha e sem 127.0.0.1', () => {
  const url = vncClientUrl('ag-1');
  assert.equal(url.startsWith('/api/agents/ag-1/vnc/vnc.html?'), true);
  assert.doesNotMatch(url, /127\.0\.0\.1/);
  assert.doesNotMatch(url, /localhost/);
  assert.doesNotMatch(url, /password=/i);
  const q = new URL(url, 'http://ripper.local').searchParams;
  assert.equal(q.get('path'), vncWsPath('ag-1'));
  assert.equal(q.get('autoconnect'), '1');
});

test('matchVncProxy distingue meta, estáticos, websocket e path traversal', () => {
  assert.deepEqual(matchVncProxy('/api/agents/a1/vnc'), { agentId: 'a1', kind: 'meta' });
  assert.deepEqual(matchVncProxy('/api/agents/a1/vnc/vnc.html'), { agentId: 'a1', kind: 'static', rest: 'vnc.html' });
  assert.equal(matchVncProxy('/api/agents/a1/vnc/websockify').kind, 'ws');
  assert.equal(matchVncProxy('/api/agents/a1/vnc/foo/../bar').kind, 'invalid');
  assert.equal(matchVncProxy('/api/health'), null);
});

test('senha do VNC fica fora do /work e rejeita XSS / lixo', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-vnc-sec-'));
  const prev = process.env.RIPPER_DATA;
  process.env.RIPPER_DATA = dataDir;
  try {
    const p = ensureVncSecret('agente-x');
    assert.equal(parseVncPassword(p), p);
    assert.doesNotMatch(vncSecretPath('agente-x'), /sandbox/);
    assert.match(vncSecretPath('agente-x'), /vnc-secrets/);
    assert.equal(readFileSync(vncSecretPath('agente-x'), 'utf8'), p);
    assert.equal(ensureVncSecret('agente-x'), p);

    writeFileSync(vncSecretPath('agente-x'), '</script><script>alert(1)</script>');
    const again = ensureVncSecret('agente-x');
    assert.notEqual(again, '</script><script>alert(1)</script>');
    assert.equal(parseVncPassword(again), again);

    assert.equal(parseVncPassword('curta'), null);
    assert.equal(parseVncPassword('abc</script>'), null);
    assert.match(generateVncPassword(), /^[A-Za-z0-9]{24}$/);
  } finally {
    if (prev === undefined) delete process.env.RIPPER_DATA;
    else process.env.RIPPER_DATA = prev;
  }
});

test('createCachedLoader reusa o valor dentro do TTL', async () => {
  let n = 0;
  const load = createCachedLoader(async () => ++n, { ttlMs: 80 });
  assert.equal(await load('a'), 1);
  assert.equal(await load('a'), 1);
  await new Promise(r => setTimeout(r, 90));
  assert.equal(await load('a'), 2);
});

test('estáticos vêm do Ripper, com X-Frame-Options e CSP', async () => {
  assert.ok(resolveVncStatic('vnc.html').endsWith('vnc.html'));
  assert.equal(resolveVncStatic('../package.json'), null);
  assert.equal(resolveVncStatic('app/ui.js'), null);
  assert.throws(() => resolveVncStatic('%E0'), e => e instanceof VncError && e.code === 400);
  const headers = vncStaticHeaders('vnc.html');
  assert.equal(headers['x-frame-options'], 'SAMEORIGIN');
  assert.match(headers['content-security-policy'], /frame-ancestors 'self'/);

  const server = createServer((req, res) => {
    const rest = new URL(req.url, 'http://x').pathname.replace(/^.*\/vnc\//, '');
    serveVncStatic(req, res, rest);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  server.unref();
  const port = server.address().port;
  try {
    const html = await fetch(`http://127.0.0.1:${port}/api/agents/ag1/vnc/vnc.html`);
    assert.equal(html.status, 200);
    assert.equal(html.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.match(html.headers.get('content-security-policy'), /script-src 'self'/);
    const body = await html.text();
    assert.match(body, /viewer\.js/);
    assert.doesNotMatch(body, /<script>.*password/i);
    assert.doesNotMatch(body, /password=/);

    const js = await fetch(`http://127.0.0.1:${port}/api/agents/ag1/vnc/viewer.js`);
    assert.equal(js.status, 200);
    assert.doesNotMatch(await js.text(), /password/);

    const miss = await fetch(`http://127.0.0.1:${port}/api/agents/ag1/vnc/core/rfb.js`);
    assert.equal(miss.status, 404);

    const bad = await fetch(`http://127.0.0.1:${port}/api/agents/ag1/vnc/%E0`);
    assert.equal(bad.status, 400);
  } finally {
    server.close();
  }
});

test('pickWsHeaders não repassa cookie, Authorization, Origin nem Referer', () => {
  const h = pickWsHeaders({
    cookie: 'ripper_session=secreto',
    authorization: 'Bearer RIPPER_TOKEN',
    origin: 'https://evil.example',
    referer: 'https://evil.example/x',
    'x-forwarded-for': '1.2.3.4',
    'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
    'sec-websocket-version': '13',
    'user-agent': 'Evil'
  }, 6080);
  assert.equal(h.host, '127.0.0.1:6080');
  assert.equal(h['sec-websocket-key'], 'dGhlIHNhbXBsZSBub25jZQ==');
  assert.equal(h.cookie, undefined);
  assert.equal(h.authorization, undefined);
  assert.equal(h.origin, undefined);
  assert.equal(h.referer, undefined);
  assert.equal(h['x-forwarded-for'], undefined);
  assert.equal(h['user-agent'], undefined);
});

test('filterUpgradeHeaders tira set-cookie da resposta 101', () => {
  const h = filterUpgradeHeaders({
    upgrade: 'websocket',
    connection: 'Upgrade',
    'sec-websocket-accept': 'ok',
    'set-cookie': 'stolen=1',
    'Set-Cookie': 'other=2'
  });
  assert.equal(h.upgrade, 'websocket');
  assert.equal(h['set-cookie'], undefined);
  assert.equal(h['Set-Cookie'], undefined);
});

test('vncOriginAllowed recusa origem cruzada', () => {
  const allow = new Set(['https://ok.example']);
  assert.equal(vncOriginAllowed({ headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' } }, allow), true);
  assert.equal(vncOriginAllowed({ headers: { host: '127.0.0.1:3000', origin: 'https://ok.example' } }, allow), true);
  assert.equal(vncOriginAllowed({ headers: { host: '127.0.0.1:3000', origin: 'https://evil.example' } }, allow), false);
  assert.equal(vncOriginAllowed({ headers: { host: '127.0.0.1:3000' } }, allow), true);
});

test('vncEncryptChallenge é determinístico e 16 bytes', () => {
  const ch = Buffer.alloc(16, 7);
  const a = vncEncryptChallenge(ch, 'abcdefgh');
  assert.equal(a.length, 16);
  assert.deepEqual(a, vncEncryptChallenge(ch, 'abcdefgh'));
  assert.notDeepEqual(a, vncEncryptChallenge(ch, 'aaaaaaaa'));
});

test('filtro RFB autentica no servidor e oferece None ao cliente', () => {
  const password = 'Abcdefgh1234';
  const f = createRfbAuthFilter(password);
  const challenge = Buffer.alloc(16, 3);
  let r = f.pushFromServer(Buffer.from('RFB 003.008\n'));
  assert.equal(r.client.toString(), 'RFB 003.008\n');
  r = f.pushFromClient(Buffer.from('RFB 003.008\n'));
  assert.equal(r.server.toString(), 'RFB 003.008\n');
  r = f.pushFromServer(Buffer.from([2, 1, 2]));
  assert.deepEqual([...r.client], [1, 1]);
  assert.deepEqual([...r.server], [2]);
  r = f.pushFromClient(Buffer.from([1]));
  r = f.pushFromServer(challenge);
  assert.deepEqual(r.server, vncEncryptChallenge(challenge, password));
  r = f.pushFromServer(Buffer.from([0, 0, 0, 0]));
  assert.deepEqual([...r.client], [0, 0, 0, 0]);
  assert.equal(r.done, true);
});

test('filtro RFB recusa servidor só com -nopw', () => {
  const f = createRfbAuthFilter('Abcdefgh1234');
  f.pushFromServer(Buffer.from('RFB 003.008\n'));
  f.pushFromClient(Buffer.from('RFB 003.008\n'));
  const r = f.pushFromServer(Buffer.from([1, 1]));
  assert.equal(r.fail, 'nopw');
});

test('filtro RFB descarta o tipo None do cliente e não espera ele para autenticar', () => {
  const password = 'Abcdefgh1234';
  const f = createRfbAuthFilter(password);
  const challenge = Buffer.alloc(16, 4);
  f.pushFromServer(Buffer.from('RFB 003.008\n'));
  f.pushFromClient(Buffer.from('RFB 003.008\n'));
  f.pushFromServer(Buffer.from([2, 1, 2]));
  const auth = f.pushFromServer(challenge);
  assert.deepEqual(auth.server, vncEncryptChallenge(challenge, password));
  const latePick = f.pushFromClient(Buffer.from([1]));
  assert.equal(latePick.server.length, 0);
  const done = f.pushFromServer(Buffer.from([0, 0, 0, 0]));
  assert.equal(done.done, true);
  assert.equal(done.server.length, 0);
});

test('filtro RFB recusa handshake acima do limite', () => {
  const f = createRfbAuthFilter('Abcdefgh1234');
  const r = f.pushFromServer(Buffer.alloc(70_000, 1));
  assert.equal(r.fail, 'limit');
});

test('applyVncPasswordForAgent não reinicia x11vnc se a senha já vale', async () => {
  const calls = [];
  const docker = async (args) => {
    calls.push(args);
    if (args[0] === 'ps') return { code: 0, out: 'abc123\n', err: '' };
    if (args.includes(VNC_PASSWORD_CHECK_SCRIPT)) return { code: 0, out: 'RIPPER_VNC_OK\n', err: '' };
    throw new Error('não deveria reaplicar a senha');
  };
  assert.equal(await applyVncPasswordForAgent('ag1', 'Abcdefgh1234', { docker }), 'unchanged');
  assert.equal(calls.some(a => a.includes(VNC_PASSWORD_APPLY_SCRIPT)), false);
});

test('applyVncPasswordForAgent recusa contêiner que continua com -nopw', async () => {
  const docker = async (args) => {
    if (args[0] === 'ps') return { code: 0, out: 'abc123\n', err: '' };
    if (args.includes(VNC_PASSWORD_CHECK_SCRIPT)) return { code: 0, out: 'RIPPER_VNC_NEED\n', err: '' };
    if (args.includes(VNC_PASSWORD_APPLY_SCRIPT)) return { code: 1, out: '', err: 'fail' };
    if (args.some(a => String(a).includes('pgrep'))) return { code: 0, out: '99 x11vnc -display :99 -nopw -rfbport 5900\n', err: '' };
    return { code: 1, out: '', err: 'fail' };
  };
  await assert.rejects(
    () => applyVncPasswordForAgent('ag1', 'Abcdefgh1234', { docker }),
    e => e instanceof VncError && e.code === 409 && /sem senha/.test(e.message)
  );
});

test('applyVncPasswordForAgent devolve o erro real se a senha falhar sem -nopw', async () => {
  const docker = async (args) => {
    if (args[0] === 'ps') return { code: 0, out: 'abc123\n', err: '' };
    if (args.includes(VNC_PASSWORD_CHECK_SCRIPT)) return { code: 0, out: 'RIPPER_VNC_NEED\n', err: '' };
    if (args.includes(VNC_PASSWORD_APPLY_SCRIPT)) return { code: 1, out: '', err: 'x11vnc: display :99 not found' };
    if (args.some(a => String(a).includes('pgrep'))) return { code: 0, out: '88 x11vnc -rfbauth /run/ripper-vnc.rfb\n', err: '' };
    return { code: 1, out: '', err: 'fail' };
  };
  await assert.rejects(
    () => applyVncPasswordForAgent('ag1', 'Abcdefgh1234', { docker }),
    e => e instanceof VncError && e.code === 502 && /display :99 not found/.test(e.message)
  );
});

test('handleVncUpgrade recusa sem sessão, origem cruzada e caminho alheio', async () => {
  const collect = () => {
    let written = '';
    return {
      written: () => written,
      socket: {
        destroyed: false,
        write(s) { written += s; return true; },
        end(s) { written += s || ''; this.destroyed = true; },
        destroy() { this.destroyed = true; },
        on() {}
      }
    };
  };

  const denied = collect();
  assert.equal(await handleVncUpgrade(
    { url: '/api/agents/a1/vnc/websockify', headers: {} },
    denied.socket, Buffer.alloc(0),
    { isSignedIn: () => false, resolvePort: async () => 1, resolvePassword: async () => 'Abcdefgh1234' }
  ), true);
  assert.match(denied.written(), /401/);

  const origin = collect();
  assert.equal(await handleVncUpgrade(
    { url: '/api/agents/a1/vnc/websockify', headers: { host: '127.0.0.1:3000', origin: 'https://evil.example' } },
    origin.socket, Buffer.alloc(0),
    { isSignedIn: () => true, resolvePort: async () => 1, resolvePassword: async () => 'Abcdefgh1234' }
  ), true);
  assert.match(origin.written(), /403/);
  assert.match(origin.written(), /Origem não permitida/);

  const other = collect();
  assert.equal(await handleVncUpgrade(
    { url: '/api/health', headers: {} },
    other.socket, Buffer.alloc(0),
    { isSignedIn: () => true, resolvePort: async () => 1 }
  ), false);
  assert.equal(other.written(), '');
  assert.equal(other.socket.destroyed, false);
});

async function listen(server) {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  server.unref();
  return server.address().port;
}

function closeServer(server) {
  try { server.closeAllConnections?.(); } catch {}
  try { server.close(); } catch {}
}

function rfbBackend({ password, setCookie = false } = {}) {
  const seen = { headers: null, frames: [] };
  const server = createServer();
  server.on('upgrade', (req, socket) => {
    seen.headers = { ...req.headers };
    const extra = setCookie ? 'Set-Cookie: stolen=1\r\n' : '';
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: dummy\r\n${extra}\r\n`);
    socket.unref();
    let phase = 'ver';
    let buf = Buffer.alloc(0);
    const challenge = Buffer.alloc(16, 9);
    socket.write(writeWsFrame(Buffer.from('RFB 003.008\n'), { opcode: 2 }));
    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length) {
        const frame = readWsFrame(buf);
        if (!frame) break;
        buf = frame.rest;
        if (frame.opcode !== 2) continue;
        const p = frame.payload;
        seen.frames.push(p);
        if (phase === 'ver' && p.length >= 12) {
          phase = 'sec';
          socket.write(writeWsFrame(Buffer.from([2, 1, 2]), { opcode: 2 }));
        } else if (phase === 'sec' && p[0] === 2) {
          phase = 'ch';
          socket.write(writeWsFrame(challenge, { opcode: 2 }));
        } else if (phase === 'ch') {
          assert.deepEqual(p, vncEncryptChallenge(challenge, password));
          phase = 'ok';
          socket.write(writeWsFrame(Buffer.from([0, 0, 0, 0, ...Buffer.from('pong')]), { opcode: 2 }));
        } else if (phase === 'ok') {
          socket.write(writeWsFrame(p, { opcode: 2 }));
        }
      }
    });
  });
  return { server, seen };
}

test('WebSocket autentica RFB, não vaza set-cookie e ecoa depois do handshake', async () => {
  const password = 'Abcdefgh1234';
  const backend = rfbBackend({ password, setCookie: true });
  const bport = await listen(backend.server);
  const proxy = createServer();
  attachVncUpgrade(proxy, {
    isSignedIn: () => true,
    resolvePort: async () => bport,
    resolvePassword: async () => password
  });
  const pport = await listen(proxy);
  try {
    const ok = request({
      hostname: '127.0.0.1', port: pport, path: '/api/agents/ag1/vnc/websockify',
      headers: {
        connection: 'Upgrade', upgrade: 'websocket',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'sec-websocket-version': '13',
        cookie: 'ripper_session=NAO',
        authorization: 'Bearer NAO'
      }
    });
    const upgradeP = once(ok, 'upgrade');
    ok.end();
    const [res, socket] = await upgradeP;
    assert.equal(res.statusCode, 101);
    assert.equal(res.headers['set-cookie'], undefined);
    assert.equal(backend.seen.headers.cookie, undefined);
    assert.equal(backend.seen.headers.authorization, undefined);

    socket.write(writeWsFrame(Buffer.from('RFB 003.008\n'), { opcode: 2, mask: true }));
    const first = [];
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('handshake lento')), 2000);
      socket.on('data', chunk => {
        first.push(chunk);
        const buf = Buffer.concat(first);
        let rest = buf, texts = [];
        while (rest.length) {
          const f = readWsFrame(rest);
          if (!f) break;
          rest = f.rest;
          if (f.opcode === 2) texts.push(f.payload);
        }
        const all = Buffer.concat(texts);
        if (all.includes(Buffer.from([0, 0, 0, 0]))) { clearTimeout(t); resolve(); }
      });
    });
    socket.write(writeWsFrame(Buffer.from('ping'), { opcode: 2, mask: true }));
    socket.destroy();
  } finally {
    closeServer(proxy);
    closeServer(backend.server);
  }
});

test('proxyVncWebSocket estoura timeout se o backend não faz upgrade', async () => {
  const stuck = createServer();
  stuck.on('upgrade', () => {});
  const bport = await listen(stuck);
  let written = '';
  const socket = {
    destroyed: false,
    write(s) { written += s; return true; },
    end(s) { written += s || ''; this.destroyed = true; },
    destroy() { this.destroyed = true; },
    on() {}
  };
  try {
    await assert.rejects(
      () => proxyVncWebSocket(
        { headers: { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' } },
        socket, Buffer.alloc(0),
        { port: bport, password: 'Abcdefgh1234', connectTimeoutMs: 200 }
      ),
      /timeout/
    );
    assert.match(written, /502/);
  } finally {
    closeServer(stuck);
  }
});

test('forwardUpgrade: ouvinte secundário (LAN/Tailscale) repassa o WebSocket', async () => {
  const password = 'Abcdefgh1234';
  const backend = rfbBackend({ password });
  const bport = await listen(backend.server);
  const main = createServer();
  attachVncUpgrade(main, {
    isSignedIn: () => true,
    resolvePort: async () => bport,
    resolvePassword: async () => password
  });
  const side = createServer((req, res) => main.emit('request', req, res));
  forwardUpgrade(side, main);
  const sport = await listen(side);
  try {
    const ok = request({
      hostname: '127.0.0.1', port: sport, path: '/api/agents/ag1/vnc/websockify',
      headers: { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' }
    });
    const upgradeP = once(ok, 'upgrade');
    ok.end();
    const [res, socket] = await upgradeP;
    assert.equal(res.statusCode, 101);
    socket.destroy();
  } finally {
    closeServer(side);
    closeServer(main);
    closeServer(backend.server);
  }
});

test('rfb.bundle.js reproduz o build de @novnc/novnc', () => {
  assert.match(readFileSync(new URL('../lib/novnc-static/LICENSE', import.meta.url), 'utf8'), /Mozilla Public License/);
  assert.match(readFileSync(new URL('../lib/novnc-static/NOTICE', import.meta.url), 'utf8'), /noVNC/);
  const r = spawn(process.execPath, [fileURLToPath(new URL('../scripts/build-novnc.mjs', import.meta.url)), '--check'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolve, reject) => {
    let err = '';
    r.stderr.on('data', d => { err += d; });
    r.on('error', reject);
    r.on('close', code => {
      try {
        assert.equal(code, 0, err || 'build:novnc --check falhou');
        resolve();
      } catch (e) { reject(e); }
    });
  });
});

test('imagem do agente: xdotool, VNC com senha em /run, sem -nopw no /work', () => {
  const df = readFileSync(new URL('../docker/agent/Dockerfile', import.meta.url), 'utf8');
  const sh = readFileSync(new URL('../docker/agent/start.sh', import.meta.url), 'utf8');
  assert.match(df, /\bxdotool\b/);
  const x11 = sh.split('\n').filter(l => /^\s*x11vnc\b/.test(l));
  assert.ok(x11.length && x11.every(l => !l.includes('-nopw')));
  assert.doesNotMatch(sh, /\/work\/\.ripper\/vnc\.pass/);
  assert.match(sh, /\/run\/ripper-vnc\.pass/);
  assert.match(sh, /-rfbauth/);
  assert.match(sh, /-localhost/);
});

async function withServer(fn) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-vnc-http-'));
  const port = await freePort();
  const token = 'test-vnc-token';
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      RIPPER_DATA: dataDir,
      PORT: String(port),
      HOST: '127.0.0.1',
      RIPPER_TOKEN: token,
      HOME: dataDir,
      USERPROFILE: dataDir,
      JULIA_AUTOSTART: '0',
      RIPPER_TEST_PROVIDER: 'stream'
    },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${token}` };
  try {
    let up = false;
    for (let i = 0; i < 300; i++) {
      try { if ((await fetch(base + '/api/health', { headers: auth })).ok) { up = true; break; } } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    if (!up) throw new Error('servidor não subiu a tempo');
    await fn(base, auth);
  } finally {
    if (child.exitCode == null && child.signalCode == null) {
      child.kill('SIGTERM');
      await Promise.race([
        once(child, 'exit'),
        new Promise(r => setTimeout(() => { child.kill('SIGKILL'); r(); }, 4000))
      ]);
      if (child.exitCode == null && child.signalCode == null) await once(child, 'exit');
    }
  }
}

test('rota /vnc: login, 409 fora do Docker, estáticos próprios sem senha na URL', async () => {
  await withServer(async (base, auth) => {
    const created = await fetch(base + '/api/agents', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Tela' })
    });
    assert.equal(created.status, 200);
    const aid = (await created.json()).id;
    assert.equal((await fetch(`${base}/api/agents/${aid}/vnc`)).status, 401);
    assert.equal((await fetch(`${base}/api/agents/${aid}/vnc/vnc.html`)).status, 401);

    const page = await fetch(`${base}/api/agents/${aid}/vnc/vnc.html`, { headers: auth });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    assert.doesNotMatch(await page.text(), /password=/);

    const r = await fetch(`${base}/api/agents/${aid}/vnc`, { headers: auth });
    assert.equal(r.status, 409);
    const body = await r.json();
    assert.match(body.error, /Docker/);
    assert.equal(JSON.stringify(body).includes('127.0.0.1'), false);
    assert.equal(JSON.stringify(body).includes('password'), false);
  });
});
