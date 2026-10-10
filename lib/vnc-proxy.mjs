// Tela ao vivo (noVNC) pelo próprio Ripper: URL same-origin + proxy HTTP/WebSocket
// autenticado (sessão ou aparelho pareado). O iframe deixa de apontar para 127.0.0.1.
import { request as httpRequest } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dataUrl } from './store.mjs';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade', 'http2-settings'
]);
// A página do Ripper embute a tela num iframe. Sem isso o noVNC herdaria DENY/CSP do backend.
const STRIP_FROM_BACKEND = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only'
]);

const VNC_PATH = /^\/api\/agents\/([\w-]+)\/vnc(?:\/(.*))?$/;

export function vncWsPath(agentId) {
  return `api/agents/${agentId}/vnc/websockify`;
}

/** URL relativa para o iframe: mesma origem do Ripper (celular, Tailscale, outro PC). */
export function vncClientUrl(agentId, { password } = {}) {
  const q = new URLSearchParams({
    autoconnect: '1',
    resize: 'scale',
    reconnect: '1',
    show_dot: '1',
    path: vncWsPath(agentId)
  });
  if (password) q.set('password', password);
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
    return { agentId, kind: 'ws', backendPath: `/${rest}` };
  }
  return { agentId, kind: 'http', backendPath: `/${rest}` };
}

export function vncPasswordFile(agentId) {
  return fileURLToPath(dataUrl(`sandbox/${agentId}/.ripper/vnc.pass`));
}

/** Senha gerada no start.sh da VM; vazia/ausente = imagem antiga sem senha. */
export function readVncPassword(agentId, { readFile = readFileSync } = {}) {
  try {
    const s = String(readFile(vncPasswordFile(agentId), 'utf8')).trim();
    return s || null;
  } catch {
    return null;
  }
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

/** Se o iframe abriu sem ?password=, o noVNC pede senha. Injeta e recarrega uma vez. */
export function injectVncPassword(html, password) {
  if (!password || typeof html !== 'string' || !/<head/i.test(html)) return html;
  const script = `<script>(function(){var p=new URLSearchParams(location.search);if(!p.get("password")){p.set("password",${JSON.stringify(password)});location.replace(location.pathname+"?"+p);}})();</script>`;
  return html.replace(/<head([^>]*)>/i, `<head$1>${script}`);
}

function copyBackendHeaders(src, { host } = {}) {
  const out = {};
  if (host) out.host = host;
  for (const [k, v] of Object.entries(src || {})) {
    if (v == null) continue;
    const key = k.toLowerCase();
    if (HOP_BY_HOP.has(key) || key === 'host') continue;
    out[k] = v;
  }
  return out;
}

function filterResponseHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const key = k.toLowerCase();
    if (STRIP_FROM_BACKEND.has(key) || HOP_BY_HOP.has(key)) continue;
    out[k] = v;
  }
  return out;
}

function isVncHtml(backendPath) {
  const path = String(backendPath || '').split('?')[0];
  return path === '/vnc.html' || path.endsWith('/vnc.html');
}

function gather(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/** Repassa GET/HEAD do noVNC (vnc.html, JS, CSS) para a porta publicada em 127.0.0.1. */
export function proxyVncHttp(req, res, { port, backendPath, search = '', password } = {}) {
  const path = `${backendPath || '/'}${search || ''}`;
  const headers = copyBackendHeaders(req.headers, { host: `127.0.0.1:${port}` });
  return new Promise(resolve => {
    const fail = () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: 'A tela ao vivo não respondeu.' }));
      } else res.end();
      resolve();
    };
    const up = httpRequest({
      hostname: '127.0.0.1',
      port,
      path,
      method: req.method,
      headers
    }, async incoming => {
      try {
        const outHeaders = filterResponseHeaders(incoming.headers);
        const html = isVncHtml(backendPath)
          && password
          && req.method !== 'HEAD'
          && !incoming.headers['content-encoding']
          && /text\/html/i.test(incoming.headers['content-type'] || 'text/html');
        const status = incoming.statusCode || 200;
        if (html) {
          const body = injectVncPassword((await gather(incoming)).toString('utf8'), password);
          const buf = Buffer.from(body);
          delete outHeaders['content-length'];
          outHeaders['content-length'] = String(buf.length);
          res.writeHead(status, outHeaders);
          res.end(buf);
          resolve();
          return;
        }
        res.writeHead(status, outHeaders);
        if (req.method === 'HEAD') { incoming.resume(); res.end(); resolve(); return; }
        incoming.pipe(res);
        incoming.on('end', resolve);
        incoming.on('error', fail);
      } catch {
        fail();
      }
    });
    up.on('error', fail);
    up.end();
  });
}

/** WebSocket do noVNC → websockify da VM (RFB por trás). */
export function proxyVncWebSocket(req, socket, head, { port, backendPath = '/websockify' } = {}) {
  const q = req.url && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const headers = copyBackendHeaders(req.headers, { host: `127.0.0.1:${port}` });
  headers.connection = 'Upgrade';
  headers.upgrade = 'websocket';
  return new Promise((resolve, reject) => {
    const up = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: `${backendPath}${q}`,
      method: 'GET',
      headers
    });
    up.on('upgrade', (incoming, remote, remoteHead) => {
      const lines = ['HTTP/1.1 101 Switching Protocols'];
      for (const [k, v] of Object.entries(incoming.headers)) {
        if (Array.isArray(v)) for (const item of v) lines.push(`${k}: ${item}`);
        else lines.push(`${k}: ${v}`);
      }
      try { socket.write(`${lines.join('\r\n')}\r\n\r\n`); } catch { remote.destroy(); resolve(); return; }
      if (head?.length) remote.write(head);
      if (remoteHead?.length) socket.write(remoteHead);
      remote.pipe(socket);
      socket.pipe(remote);
      remote.unref?.();
      socket.unref?.();
      const done = () => { try { remote.destroy(); } catch {} try { socket.destroy(); } catch {} resolve(); };
      remote.on('close', done);
      socket.on('close', done);
      remote.on('error', () => socket.destroy());
      socket.on('error', () => remote.destroy());
    });
    up.on('error', err => {
      if (!socket.destroyed) {
        try { socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); } catch {}
        socket.destroy();
      }
      reject(err);
    });
    up.on('response', incoming => {
      if (socket.destroyed) { incoming.resume(); resolve(); return; }
      try { socket.write(`HTTP/1.1 ${incoming.statusCode} ${incoming.statusMessage || ''}\r\nConnection: close\r\n\r\n`); } catch {}
      incoming.pipe(socket);
      incoming.on('end', resolve);
    });
    up.end();
  });
}

function writeSocketHttp(socket, status, message, body) {
  const payload = typeof body === 'string' ? body : JSON.stringify({ error: message });
  const reason = status === 401 ? 'Unauthorized' : status === 409 ? 'Conflict' : status === 503 ? 'Service Unavailable' : status === 404 ? 'Not Found' : 'Error';
  try {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
  } catch { try { socket.destroy(); } catch {} }
}

function upgradeStatus(err) {
  const n = typeof err?.code === 'number' ? err.code : typeof err?.status === 'number' ? err.status : 0;
  return n >= 400 && n < 600 ? n : 502;
}

/** Trata um upgrade: false se a URL não é o WS do noVNC (outros handlers podem seguir). */
export async function handleVncUpgrade(req, socket, head, { isSignedIn, resolvePort }) {
  let pathname = '';
  try { pathname = new URL(req.url, 'http://127.0.0.1').pathname; } catch { return false; }
  const match = matchVncProxy(pathname);
  if (!match || match.kind !== 'ws') return false;
  socket.on('error', () => {});
  if (!isSignedIn(req)) {
    writeSocketHttp(socket, 401, 'Entre com a senha do Ripper.');
    return true;
  }
  let port;
  try { port = await resolvePort(match.agentId); }
  catch (e) {
    writeSocketHttp(socket, upgradeStatus(e), e.message || 'A tela ao vivo não respondeu.');
    return true;
  }
  try {
    await proxyVncWebSocket(req, socket, head, { port, backendPath: match.backendPath });
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

/** LAN/Tailscale só encaminhavam `request`; sem `upgrade` o WebSocket morre fora do localhost. */
export function forwardUpgrade(from, to) {
  from.on('upgrade', (req, socket, head) => to.emit('upgrade', req, socket, head));
}
