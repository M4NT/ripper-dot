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
  readVncPassword,
  injectVncPassword,
  createCachedLoader,
  proxyVncHttp,
  attachVncUpgrade,
  handleVncUpgrade,
  forwardUpgrade
} from '../lib/vnc-proxy.mjs';

const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));

test('vncClientUrl é same-origin e aponta o WebSocket para o proxy', () => {
  const url = vncClientUrl('ag-1', { password: 's3cret' });
  assert.equal(url.startsWith('/api/agents/ag-1/vnc/vnc.html?'), true);
  assert.doesNotMatch(url, /127\.0\.0\.1/);
  assert.doesNotMatch(url, /localhost/);
  const q = new URL(url, 'http://ripper.local').searchParams;
  assert.equal(q.get('autoconnect'), '1');
  assert.equal(q.get('resize'), 'scale');
  assert.equal(q.get('reconnect'), '1');
  assert.equal(q.get('show_dot'), '1');
  assert.equal(q.get('path'), vncWsPath('ag-1'));
  assert.equal(q.get('password'), 's3cret');
  assert.equal(vncClientUrl('ag-1').includes('password='), false);
});

test('matchVncProxy distingue meta, estáticos, websocket e path traversal', () => {
  assert.deepEqual(matchVncProxy('/api/agents/a1/vnc'), { agentId: 'a1', kind: 'meta' });
  assert.deepEqual(matchVncProxy('/api/agents/a1/vnc/vnc.html'), { agentId: 'a1', kind: 'http', backendPath: '/vnc.html' });
  assert.deepEqual(matchVncProxy('/api/agents/a1/vnc/app/ui.js'), { agentId: 'a1', kind: 'http', backendPath: '/app/ui.js' });
  assert.deepEqual(matchVncProxy('/api/agents/a1/vnc/websockify'), { agentId: 'a1', kind: 'ws', backendPath: '/websockify' });
  assert.equal(matchVncProxy('/api/agents/a1/vnc/foo/../bar').kind, 'invalid');
  assert.equal(matchVncProxy('/api/health'), null);
});

test('readVncPassword lê o arquivo do sandbox e ignora ausência', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-vnc-pw-'));
  const prev = process.env.RIPPER_DATA;
  process.env.RIPPER_DATA = dataDir;
  try {
    assert.equal(readVncPassword('agente-x'), null);
    mkdirSync(join(dataDir, 'sandbox/agente-x/.ripper'), { recursive: true });
    writeFileSync(join(dataDir, 'sandbox/agente-x/.ripper/vnc.pass'), 'abc123\n');
    assert.equal(readVncPassword('agente-x'), 'abc123');
    assert.equal(readVncPassword('agente-x', { readFile: () => '  injetada  ' }), 'injetada');
  } finally {
    if (prev === undefined) delete process.env.RIPPER_DATA;
    else process.env.RIPPER_DATA = prev;
  }
});

test('injectVncPassword recarrega uma vez se a query não tem senha', () => {
  const out = injectVncPassword('<html><head></head><body>x</body></html>', 'pw"1');
  assert.match(out, /<head><script>/);
  assert.match(out, /p\.set\("password","pw\\"1"\)/);
  assert.equal(injectVncPassword('<html><body></body></html>', 'pw'), '<html><body></body></html>');
});

test('createCachedLoader reusa o valor dentro do TTL', async () => {
  let n = 0;
  const load = createCachedLoader(async () => ++n, { ttlMs: 80 });
  assert.equal(await load('a'), 1);
  assert.equal(await load('a'), 1);
  assert.equal(await load('b'), 2);
  await new Promise(r => setTimeout(r, 90));
  assert.equal(await load('a'), 3);
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

function mockNovncBackend() {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url });
    if (req.url.startsWith('/vnc.html')) {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'x-frame-options': 'DENY',
        'content-security-policy': "frame-ancestors 'none'"
      });
      res.end('<html><head></head><body>novnc</body></html>');
      return;
    }
    if (req.url === '/app/ui.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end('/* ui */');
      return;
    }
    res.writeHead(404);
    res.end('nope');
  });
  server.on('upgrade', (req, socket, head) => {
    seen.push({ method: 'UPGRADE', url: req.url });
    socket.unref();
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: dummy\r\n\r\n');
    if (head?.length) socket.write(head);
    socket.on('data', d => socket.write(d));
  });
  return { server, seen };
}

test('proxy HTTP: same-origin, sem X-Frame-Options, injeta senha e serve assets', async () => {
  const backend = mockNovncBackend();
  const bport = await listen(backend.server);
  const proxy = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const m = matchVncProxy(url.pathname);
    if (!m?.backendPath) { res.writeHead(404); res.end(); return; }
    proxyVncHttp(req, res, { port: bport, backendPath: m.backendPath, search: url.search, password: 's3cret' })
      .catch(() => { if (!res.headersSent) { res.writeHead(502); res.end(); } });
  });
  const pport = await listen(proxy);
  try {
    const html = await fetch(`http://127.0.0.1:${pport}/api/agents/ag1/vnc/vnc.html?autoconnect=1`);
    assert.equal(html.status, 200);
    assert.equal(html.headers.get('x-frame-options'), null);
    assert.equal(html.headers.get('content-security-policy'), null);
    const body = await html.text();
    assert.match(body, /novnc/);
    assert.match(body, /s3cret/);

    const js = await fetch(`http://127.0.0.1:${pport}/api/agents/ag1/vnc/app/ui.js`);
    assert.equal(js.status, 200);
    assert.equal(await js.text(), '/* ui */');

    const miss = await fetch(`http://127.0.0.1:${pport}/api/agents/ag1/vnc/missing`);
    assert.equal(miss.status, 404);
  } finally {
    closeServer(proxy);
    closeServer(backend.server);
  }
});

test('proxy HTTP: backend morto responde 502 em português', async () => {
  const proxy = createServer((req, res) => {
    proxyVncHttp(req, res, { port: 1, backendPath: '/vnc.html' });
  });
  const pport = await listen(proxy);
  try {
    const r = await fetch(`http://127.0.0.1:${pport}/x`);
    assert.equal(r.status, 502);
    assert.match((await r.json()).error, /tela ao vivo/);
  } finally {
    closeServer(proxy);
  }
});

test('handleVncUpgrade recusa sem sessão com 401', async () => {
  let written = '';
  const socket = {
    destroyed: false,
    write(s) { written += s; return true; },
    end(s) { written += s || ''; this.destroyed = true; },
    destroy() { this.destroyed = true; },
    on() {}
  };
  const ok = await handleVncUpgrade(
    { url: '/api/agents/a1/vnc/websockify', headers: {} },
    socket,
    Buffer.alloc(0),
    { isSignedIn: () => false, resolvePort: async () => 1 }
  );
  assert.equal(ok, true);
  assert.match(written, /401/);
  assert.match(written, /Entre com a senha/);
});

test('WebSocket autenticado atravessa o proxy', async () => {
  const backend = mockNovncBackend();
  const bport = await listen(backend.server);
  const proxy = createServer();
  attachVncUpgrade(proxy, { isSignedIn: () => true, resolvePort: async () => bport });
  const pport = await listen(proxy);
  try {
    const ok = request({
      hostname: '127.0.0.1', port: pport, path: '/api/agents/ag1/vnc/websockify',
      headers: {
        connection: 'Upgrade', upgrade: 'websocket',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13'
      }
    });
    const upgradeP = once(ok, 'upgrade');
    ok.end();
    const [res, socket] = await upgradeP;
    assert.equal(res.statusCode, 101);
    socket.write('ping');
    const [chunk] = await once(socket, 'data');
    assert.equal(chunk.toString(), 'ping');
    socket.destroy();
    assert.ok(backend.seen.some(s => s.method === 'UPGRADE' && s.url.startsWith('/websockify')));
  } finally {
    closeServer(proxy);
    closeServer(backend.server);
  }
});

test('forwardUpgrade: ouvinte secundário (LAN/Tailscale) repassa o WebSocket', async () => {
  const backend = mockNovncBackend();
  const bport = await listen(backend.server);
  const main = createServer();
  attachVncUpgrade(main, { isSignedIn: () => true, resolvePort: async () => bport });
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

test('handleVncUpgrade ignora URL que não é o WS do noVNC', async () => {
  const req = { url: '/api/health', headers: {} };
  const socket = { destroyed: false, write() {}, destroy() {}, on() {} };
  assert.equal(await handleVncUpgrade(req, socket, Buffer.alloc(0), { isSignedIn: () => true, resolvePort: async () => 1 }), false);
});

test('imagem do agente: xdotool e VNC com senha só em localhost', () => {
  const df = readFileSync(new URL('../docker/agent/Dockerfile', import.meta.url), 'utf8');
  const sh = readFileSync(new URL('../docker/agent/start.sh', import.meta.url), 'utf8');
  assert.match(df, /\bxdotool\b/);
  assert.doesNotMatch(sh, /-nopw/);
  assert.match(sh, /vnc\.pass/);
  assert.match(sh, /-rfbauth/);
  assert.match(sh, /-localhost/);
  assert.match(sh, /storepasswd/);
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

test('rota /vnc: login obrigatório, 409 fora do Docker, URL nunca é 127.0.0.1', async () => {
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

    const r = await fetch(`${base}/api/agents/${aid}/vnc`, { headers: auth });
    assert.equal(r.status, 409);
    const body = await r.json();
    assert.match(body.error, /Docker/);
    assert.equal(JSON.stringify(body).includes('127.0.0.1'), false);
  });
});
