// Tela ao vivo: noVNC empacotado pelo Ripper + proxy só do WebSocket, autenticado.
// Os arquivos do contêiner nunca entram na origem do Ripper.
import { request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import forge from 'node-forge';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataUrl } from './store.mjs';
import { classifyRequestOrigin } from './security-headers.mjs';

export const VNC_PASSWORD_RE = /^[A-Za-z0-9]{8,64}$/;
export const WS_HEADER_ALLOW = new Set([
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-protocol',
  'sec-websocket-extensions'
]);
export const UPGRADE_HEADER_ALLOW = new Set([
  'upgrade',
  'connection',
  'sec-websocket-accept',
  'sec-websocket-protocol',
  'sec-websocket-extensions'
]);

const UPSTREAM_TIMEOUT_MS = 8_000;
const WS_IDLE_MS = 180_000;
const MAX_HANDSHAKE = 65_536;
const MAX_STATIC_BYTES = 2_000_000;
const MAX_WS_PER_AGENT = 4;
const VNC_PATH = /^\/api\/agents\/([\w-]+)\/vnc(?:\/(.*))?$/;
const STATIC_DIR = fileURLToPath(new URL('./novnc-static/', import.meta.url));
const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};
const VNC_PAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'";
const APPLY_SCRIPT = `
set -e
read PASS
printf '%s' "$PASS" > /run/ripper-vnc.pass
chmod 600 /run/ripper-vnc.pass
x11vnc -storepasswd "$PASS" /run/ripper-vnc.rfb >/dev/null 2>&1
chmod 600 /run/ripper-vnc.rfb
pkill x11vnc || true
sleep 0.3
x11vnc -display :99 -forever -shared -rfbauth /run/ripper-vnc.rfb -localhost -quiet -rfbport 5900 >/tmp/x11vnc.log 2>&1 &
sleep 0.2
pgrep -a x11vnc | grep -q -- rfbauth
`.trim();

const wsByAgent = new Map();

export class VncError extends Error {
  constructor(status, message) {
    super(message);
    this.code = status;
  }
}

export function vncWsPath(agentId) {
  return `api/agents/${agentId}/vnc/websockify`;
}

/** URL relativa do iframe. Sem senha na query. */
export function vncClientUrl(agentId) {
  const q = new URLSearchParams({
    autoconnect: '1',
    resize: 'scale',
    reconnect: '1',
    show_dot: '1',
    path: vncWsPath(agentId)
  });
  return `/api/agents/${agentId}/vnc/vnc.html?${q}`;
}

export function matchVncProxy(pathname) {
  const m = VNC_PATH.exec(pathname || '');
  if (!m) return null;
  const agentId = m[1];
  const rest = m[2] == null ? '' : m[2];
  if (rest === '') return { agentId, kind: 'meta' };
  if (rest.includes('..')) return { agentId, kind: 'invalid' };
  if (rest === 'websockify' || rest.startsWith('websockify/')) {
    return { agentId, kind: 'ws', backendPath: `/${rest.split('?')[0]}` };
  }
  return { agentId, kind: 'static', rest };
}

export function vncSecretPath(agentId) {
  return fileURLToPath(dataUrl(`vnc-secrets/${agentId}`));
}

export function generateVncPassword(bytes = randomBytes(24)) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(bytes, b => chars[b % 62]).join('');
}

export function parseVncPassword(raw) {
  const s = String(raw || '').trim();
  return VNC_PASSWORD_RE.test(s) ? s : null;
}

/** Senha gerada e guardada pelo Ripper, fora do /work do agente. */
export function ensureVncSecret(agentId, { readFile = readFileSync, writeFile = writeFileSync, mkdir = mkdirSync } = {}) {
  const p = vncSecretPath(agentId);
  try {
    const ok = parseVncPassword(readFile(p, 'utf8'));
    if (ok) return ok;
  } catch { /* cria */ }
  const password = generateVncPassword();
  mkdir(dirname(p), { recursive: true, mode: 0o700 });
  writeFile(p, password, { mode: 0o600 });
  return password;
}

export function createCachedLoader(load, { ttlMs = 4000 } = {}) {
  const cache = new Map();
  return async key => {
    const hit = cache.get(key);
    if (hit && hit.exp > Date.now()) return hit.value;
    const value = await load(key);
    cache.set(key, { value, exp: Date.now() + ttlMs });
    return value;
  };
}

export function vncStaticHeaders(file = '') {
  const html = file.endsWith('.html');
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'SAMEORIGIN',
    'content-security-policy': VNC_PAGE_CSP,
    'cache-control': html ? 'private, no-store' : 'private, max-age=3600'
  };
}

export function resolveVncStatic(rest) {
  const rel = decodeURIComponent(String(rest || '')).replace(/^\/+/, '').split('?')[0];
  if (!rel || rel.includes('..') || rel.includes('\0') || rel.includes('/') || rel.includes('\\')) return null;
  if (!['vnc.html', 'viewer.js', 'viewer.css', 'rfb.bundle.js'].includes(rel)) return null;
  return join(STATIC_DIR, rel);
}

export async function serveVncStatic(req, res, rest, { readFile = readFileSync, stat = statSync } = {}) {
  const file = resolveVncStatic(rest);
  const jsonHead = { 'content-type': 'application/json; charset=utf-8', ...vncStaticHeaders(), 'x-frame-options': 'DENY' };
  if (!file) {
    res.writeHead(404, jsonHead);
    res.end(JSON.stringify({ error: 'Não encontrado.' }));
    return;
  }
  try {
    if (stat(file).size > MAX_STATIC_BYTES) {
      res.writeHead(413, jsonHead);
      res.end(JSON.stringify({ error: 'Arquivo grande demais.' }));
      return;
    }
    const data = readFile(file);
    const headers = {
      ...vncStaticHeaders(file),
      'content-type': STATIC_MIME[extname(file)] || 'application/octet-stream',
      'content-length': String(data.length)
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    res.end(data);
  } catch {
    res.writeHead(404, jsonHead);
    res.end(JSON.stringify({ error: 'Não encontrado.' }));
  }
}

export function pickWsHeaders(src, port) {
  const out = { host: `127.0.0.1:${port}`, connection: 'Upgrade', upgrade: 'websocket' };
  for (const [k, v] of Object.entries(src || {})) {
    if (v == null) continue;
    if (WS_HEADER_ALLOW.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

export function filterUpgradeHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (UPGRADE_HEADER_ALLOW.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

export function vncOriginAllowed(req, allowlist = new Set()) {
  const kind = classifyRequestOrigin(req, allowlist).kind;
  return kind === 'same-host' || kind === 'allowlisted' || kind === 'none';
}

/** DES do VNC: bits de cada byte da senha invertidos; desafio de 16 bytes. */
export function vncEncryptChallenge(challenge, password) {
  const key = Buffer.alloc(8);
  const pw = Buffer.from(String(password), 'utf8');
  for (let i = 0; i < 8; i++) {
    const b = i < pw.length ? pw[i] : 0;
    let r = 0;
    for (let bit = 0; bit < 8; bit++) r = (r << 1) | ((b >> bit) & 1);
    key[i] = r;
  }
  const raw = challenge.subarray(0, 16);
  const blocks = [];
  for (let i = 0; i < 16; i += 8) {
    const cipher = forge.cipher.createCipher('DES-ECB', String.fromCharCode(...key));
    cipher.start();
    cipher.mode.pad = false;
    cipher.update(forge.util.createBuffer(raw.subarray(i, i + 8).toString('binary')));
    if (!cipher.finish(false)) throw new Error('Falha ao cifrar o desafio VNC.');
    blocks.push(Buffer.from(cipher.output.getBytes(), 'binary'));
  }
  return Buffer.concat(blocks);
}

export function readWsFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    const big = buf.readBigUInt64BE(2);
    if (big > BigInt(MAX_HANDSHAKE)) return { opcode, payload: null, rest: buf.subarray(buf.length), overflow: true };
    len = Number(big);
    off = 10;
  }
  if (masked) off += 4;
  if (buf.length < off + len) return null;
  let payload = buf.subarray(off, off + len);
  if (masked) {
    const mask = buf.subarray(off - 4, off);
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  }
  return { opcode, payload, rest: buf.subarray(off + len) };
}

export function writeWsFrame(payload, { opcode = 2, mask = false } = {}) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;
  if (data.length < 126) {
    header = Buffer.alloc(2);
    header[1] = data.length;
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  header[0] = 0x80 | opcode;
  if (!mask) return Buffer.concat([header, data]);
  header[1] |= 0x80;
  const m = randomBytes(4);
  const masked = Buffer.from(data);
  for (let i = 0; i < masked.length; i++) masked[i] ^= m[i & 3];
  return Buffer.concat([header, m, masked]);
}

/**
 * Autentica o RFB no servidor (VncAuth) e oferece None ao navegador.
 * A senha nunca chega no cliente.
 */
export function createRfbAuthFilter(password) {
  let phase = 'srv-ver';
  let srv = Buffer.alloc(0);
  let cli = Buffer.alloc(0);
  let fail = null;
  let sawClientPick = false;
  const outC = [];
  const outS = [];

  function take(side, n) {
    if (side.length < n) return null;
    const chunk = side.subarray(0, n);
    if (side === srv) srv = srv.subarray(n);
    else cli = cli.subarray(n);
    return chunk;
  }

  /** O cliente manda 0x01 (None); o servidor espera a resposta VncAuth. */
  function eatClientPick() {
    if (!sawClientPick && cli.length) {
      take(cli, 1);
      sawClientPick = true;
    }
  }

  function process() {
    if (fail || phase === 'splice') return;
    if (phase === 'srv-ver') {
      const v = take(srv, 12);
      if (!v) return;
      outC.push(v);
      phase = 'cli-ver';
    }
    if (phase === 'cli-ver') {
      const v = take(cli, 12);
      if (!v) return;
      outS.push(v);
      phase = 'srv-sec';
    }
    if (phase === 'srv-sec') {
      if (!srv.length) return;
      const n = srv[0];
      if (n === 0) { fail = 'auth'; return; }
      if (srv.length < 1 + n) return;
      const types = [...take(srv, 1 + n).subarray(1)];
      if (!types.includes(2)) { fail = 'nopw'; return; }
      outC.push(Buffer.from([1, 1]));
      outS.push(Buffer.from([2]));
      phase = 'auth';
    }
    if (phase === 'auth') {
      eatClientPick();
      const ch = take(srv, 16);
      if (!ch) return;
      outS.push(vncEncryptChallenge(ch, password));
      phase = 'result';
    }
    if (phase === 'result') {
      eatClientPick();
      const r = take(srv, 4);
      if (!r) return;
      if (r.readUInt32BE(0) !== 0) { fail = 'auth'; return; }
      outC.push(r);
      phase = 'splice';
      if (srv.length) outC.push(srv);
      srv = Buffer.alloc(0);
      cli = Buffer.alloc(0);
    }
  }

  function flush() {
    const client = outC.length ? Buffer.concat(outC) : Buffer.alloc(0);
    const server = outS.length ? Buffer.concat(outS) : Buffer.alloc(0);
    outC.length = 0;
    outS.length = 0;
    return { client, server, fail, done: phase === 'splice' };
  }

  return {
    pushFromServer(bytes) {
      if (phase === 'splice') return { client: bytes, server: Buffer.alloc(0), fail, done: true };
      srv = Buffer.concat([srv, bytes]);
      if (srv.length + cli.length > MAX_HANDSHAKE) { fail = 'limit'; return flush(); }
      process();
      return flush();
    },
    pushFromClient(bytes) {
      if (phase === 'splice') {
        if (!sawClientPick && bytes.length && bytes[0] === 1) {
          sawClientPick = true;
          bytes = bytes.subarray(1);
        }
        return { client: Buffer.alloc(0), server: bytes, fail, done: true };
      }
      cli = Buffer.concat([cli, bytes]);
      if (srv.length + cli.length > MAX_HANDSHAKE) { fail = 'limit'; return flush(); }
      process();
      return flush();
    }
  };
}

function defaultDocker(args, { timeout = 15_000, input } = {}) {
  return new Promise(resolve => {
    const p = spawn('docker', args, { windowsHide: true });
    let out = '', err = '';
    const t = setTimeout(() => p.kill(), timeout);
    p.stdout.on('data', d => { if (out.length < 20_000) out += d; });
    p.stderr.on('data', d => { if (err.length < 8_000) err += d; });
    p.on('error', e => { clearTimeout(t); resolve({ code: -1, out: '', err: e.message }); });
    p.on('close', code => { clearTimeout(t); resolve({ code, out, err }); });
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

/** Aplica a senha do servidor no x11vnc (fora do /work). Recusa imagem antiga com -nopw. */
export async function applyVncPasswordForAgent(agentId, password, { docker = defaultDocker } = {}) {
  if (!parseVncPassword(password)) throw new VncError(500, 'Senha de VNC inválida.');
  const listed = await docker(['ps', '-q', '--filter', `label=ripper.agent=${agentId}`]);
  const id = listed.out.trim().split(/\s+/).filter(Boolean)[0];
  if (!id) throw new VncError(503, 'A tela ainda não subiu. Tente de novo em alguns segundos.');
  const applied = await docker(['exec', '-i', id, 'sh', '-c', APPLY_SCRIPT], { input: `${password}\n`, timeout: 20_000 });
  if (applied.code !== 0) {
    throw new VncError(409, 'Este computador ainda usa VNC sem senha. Reconstrua a imagem em Configurações → Computador.');
  }
  const check = await docker(['exec', id, 'sh', '-c', 'pgrep -a x11vnc || true']);
  if (/\s-nopw(?:\s|$)/.test(check.out)) {
    throw new VncError(409, 'Este computador ainda usa VNC sem senha. Reconstrua a imagem em Configurações → Computador.');
  }
  return 'ok';
}

function writeSocketHttp(socket, status, message) {
  const payload = JSON.stringify({ error: message });
  const reason = status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : status === 404 ? 'Not Found' : status === 409 ? 'Conflict' : status === 429 ? 'Too Many Requests' : status === 503 ? 'Service Unavailable' : 'Error';
  try {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
  } catch { try { socket.destroy(); } catch {} }
}

function upgradeStatus(err) {
  const n = typeof err?.code === 'number' ? err.code : 0;
  return n >= 400 && n < 600 ? n : 502;
}

function trackWs(agentId, socket) {
  const set = wsByAgent.get(agentId) || new Set();
  if (set.size >= MAX_WS_PER_AGENT) return false;
  set.add(socket);
  wsByAgent.set(agentId, set);
  const drop = () => { set.delete(socket); if (!set.size) wsByAgent.delete(agentId); };
  socket.on('close', drop);
  socket.on('end', drop);
  return true;
}

function attachIdle(a, b, ms) {
  let t;
  const bump = () => {
    clearTimeout(t);
    t = setTimeout(() => { try { a.destroy(); } catch {} try { b.destroy(); } catch {} }, ms);
    t.unref?.();
  };
  a.on('data', bump);
  b.on('data', bump);
  bump();
  const stop = () => clearTimeout(t);
  a.on('close', stop);
  b.on('close', stop);
}

function sendBinary(socket, payload, { mask = false } = {}) {
  if (!payload?.length || socket.destroyed) return;
  try { socket.write(writeWsFrame(payload, { opcode: 2, mask })); } catch { socket.destroy(); }
}

/** WebSocket do navegador → websockify da VM. Só headers permitidos; RFB autenticado aqui. */
export function proxyVncWebSocket(req, socket, head, { port, backendPath = '/websockify', password, idleMs = WS_IDLE_MS, connectTimeoutMs = UPSTREAM_TIMEOUT_MS } = {}) {
  const headers = pickWsHeaders(req.headers, port);
  return new Promise((resolve, reject) => {
    const up = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: backendPath,
      method: 'GET',
      headers
    });
    const timer = setTimeout(() => { up.destroy(); if (!socket.destroyed) writeSocketHttp(socket, 502, 'A tela ao vivo não respondeu.'); reject(new Error('timeout')); }, connectTimeoutMs);
    timer.unref?.();
    up.on('upgrade', (incoming, remote, remoteHead) => {
      clearTimeout(timer);
      const allowed = filterUpgradeHeaders(incoming.headers);
      const lines = ['HTTP/1.1 101 Switching Protocols'];
      for (const [k, v] of Object.entries(allowed)) {
        if (Array.isArray(v)) for (const item of v) lines.push(`${k}: ${item}`);
        else lines.push(`${k}: ${v}`);
      }
      try { socket.write(`${lines.join('\r\n')}\r\n\r\n`); } catch { remote.destroy(); resolve(); return; }
      const filter = createRfbAuthFilter(password);
      const fail = reason => {
        try { remote.destroy(); } catch {}
        try { socket.destroy(); } catch {}
        resolve();
        void reason;
      };
      const onFromRemote = chunk => {
        let buf = Buffer.concat([remoteHead || Buffer.alloc(0), chunk]);
        remoteHead = Buffer.alloc(0);
        while (buf.length) {
          const frame = readWsFrame(buf);
          if (!frame) { remoteHead = buf; return; }
          buf = frame.rest;
          if (frame.overflow) return fail('limit');
          if (frame.opcode === 8) { socket.destroy(); remote.destroy(); return; }
          if (frame.opcode === 9) { try { remote.write(writeWsFrame(frame.payload || Buffer.alloc(0), { opcode: 10, mask: true })); } catch {} continue; }
          if (frame.opcode !== 0 && frame.opcode !== 1 && frame.opcode !== 2) continue;
          const { client, server, fail: f } = filter.pushFromServer(frame.payload || Buffer.alloc(0));
          if (f) return fail(f);
          sendBinary(socket, client, { mask: false });
          sendBinary(remote, server, { mask: true });
        }
        remoteHead = buf;
      };
      let clientBuf = head?.length ? Buffer.from(head) : Buffer.alloc(0);
      const onFromClient = chunk => {
        clientBuf = Buffer.concat([clientBuf, chunk]);
        while (clientBuf.length) {
          const frame = readWsFrame(clientBuf);
          if (!frame) break;
          clientBuf = frame.rest;
          if (frame.overflow) return fail('limit');
          if (frame.opcode === 8) { socket.destroy(); remote.destroy(); return; }
          if (frame.opcode === 9) { try { socket.write(writeWsFrame(frame.payload || Buffer.alloc(0), { opcode: 10, mask: false })); } catch {} continue; }
          if (frame.opcode !== 0 && frame.opcode !== 1 && frame.opcode !== 2) continue;
          const { client, server, fail: f } = filter.pushFromClient(frame.payload || Buffer.alloc(0));
          if (f) return fail(f);
          sendBinary(socket, client, { mask: false });
          sendBinary(remote, server, { mask: true });
        }
      };
      if (remoteHead?.length) onFromRemote(Buffer.alloc(0));
      if (clientBuf.length) onFromClient(Buffer.alloc(0));
      remote.on('data', onFromRemote);
      socket.on('data', onFromClient);
      attachIdle(socket, remote, idleMs);
      remote.unref?.();
      socket.unref?.();
      const done = () => { try { remote.destroy(); } catch {} try { socket.destroy(); } catch {} resolve(); };
      remote.on('close', done);
      socket.on('close', done);
      remote.on('error', () => socket.destroy());
      socket.on('error', () => remote.destroy());
    });
    up.on('error', err => {
      clearTimeout(timer);
      if (!socket.destroyed) writeSocketHttp(socket, 502, 'A tela ao vivo não respondeu.');
      reject(err);
    });
    up.on('response', incoming => {
      clearTimeout(timer);
      incoming.resume();
      if (!socket.destroyed) writeSocketHttp(socket, incoming.statusCode || 502, 'A tela ao vivo não respondeu.');
      resolve();
    });
    up.end();
  });
}

export async function handleVncUpgrade(req, socket, head, { isSignedIn, resolvePort, resolvePassword, allowlist = new Set() } = {}) {
  let pathname = '';
  try { pathname = new URL(req.url, 'http://127.0.0.1').pathname; } catch {
    writeSocketHttp(socket, 400, 'Pedido inválido.');
    return true;
  }
  const match = matchVncProxy(pathname);
  if (!match || match.kind !== 'ws') {
    writeSocketHttp(socket, 404, 'Rota não encontrada.');
    return true;
  }
  socket.on('error', () => {});
  if (!vncOriginAllowed(req, allowlist)) {
    writeSocketHttp(socket, 403, 'Origem não permitida.');
    return true;
  }
  if (!isSignedIn?.(req)) {
    writeSocketHttp(socket, 401, 'Entre com a senha do Ripper.');
    return true;
  }
  if (!trackWs(match.agentId, socket)) {
    writeSocketHttp(socket, 429, 'Muitas telas abertas neste agente.');
    return true;
  }
  let port, password;
  try {
    port = await resolvePort(match.agentId);
    password = resolvePassword ? await resolvePassword(match.agentId) : null;
  } catch (e) {
    writeSocketHttp(socket, upgradeStatus(e), e.message || 'A tela ao vivo não respondeu.');
    return true;
  }
  if (!parseVncPassword(password)) {
    writeSocketHttp(socket, 409, 'Este computador ainda usa VNC sem senha. Reconstrua a imagem em Configurações → Computador.');
    return true;
  }
  try {
    await proxyVncWebSocket(req, socket, head, { port, backendPath: match.backendPath, password });
  } catch {
    if (!socket.destroyed) socket.destroy();
  }
  return true;
}

export function attachVncUpgrade(server, hooks) {
  server.on('upgrade', (req, socket, head) => {
    handleVncUpgrade(req, socket, head, hooks).catch(() => { if (!socket.destroyed) socket.destroy(); });
  });
}

export function forwardUpgrade(from, to) {
  from.on('upgrade', (req, socket, head) => to.emit('upgrade', req, socket, head));
}
