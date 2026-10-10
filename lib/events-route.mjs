/**
 * Canal SSE da instalação (`GET /api/events`).
 *
 * Ripper é um dono por processo: working, aprovações, inbox e fluxos vão a todas as
 * abas autenticadas (o mesmo recorte de GET /api/approvals e /api/agents/working).
 * Conteúdo parcial da resposta (texto/passos) só segue para quem passou `?watch=<chatId>`.
 *
 * Diff por conexão: snapshot inicial não mexe na base dos outros. `Last-Event-ID` reassume
 * a fila; se o id já saiu do anel, manda snapshot de novo.
 */

import { randomUUID } from 'node:crypto';
import { onChatStreamsChange } from './chat-stream.mjs';
import { redactSseEvent } from './redact.mjs';

export const USER_EVENTS_PATH = '/api/events';
export const MAX_EVENT_CONNECTIONS = 8;
export const EVENT_LOG_MAX = 200;
export const BACKPRESSURE_BYTES = 1_000_000;
const PING_MS = 15_000;
const SNAP_MS = 400;

const clients = new Map(); // id → client
let snapTimer = null;
let streamUnsub = null;
let lastJson = '';
let lastParts = null;
let hubDeps = null;
let seq = 0;
const eventLog = [];

export function userKeyFromAuth() {
  return 'owner';
}

export function parseWatchFromReq(req) {
  try {
    const raw = String(req?.url || '');
    const q = raw.includes('?') ? new URL(raw, 'http://local').searchParams.get('watch') : '';
    return new Set(String(q || '').split(',').map(s => decodeURIComponent(s.trim())).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function subscribeUserEvents(userKey, send, res, extra = {}) {
  const id = randomUUID();
  clients.set(id, {
    userKey: userKey || 'owner',
    send,
    res,
    watch: extra.watch instanceof Set ? extra.watch : new Set(),
    paused: false,
    dropped: false
  });
  return () => clients.delete(id);
}

/** Sem userKey (ou `*`) entrega a todos; senão só ao mesmo usuário. */
export function publishUserEvent(userKey, event) {
  emitHub(event, userKey);
}

export function userEventClientCount(userKey) {
  let n = 0;
  for (const c of clients.values()) if (!userKey || c.userKey === userKey) n++;
  return n;
}

export function closeAllUserEvents() {
  for (const c of clients.values()) {
    try { c.res?.end(); } catch { /* já fechado */ }
  }
  clients.clear();
  stopHub();
}

function emptySnap() {
  return { working: {}, approvals: [], live: {}, pendingInbox: {}, flows: {} };
}

export function normalizeEventsSnapshot(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    working: s.working && typeof s.working === 'object' && !Array.isArray(s.working) ? s.working : {},
    approvals: Array.isArray(s.approvals) ? s.approvals : [],
    live: s.live && typeof s.live === 'object' && !Array.isArray(s.live) ? s.live : {},
    pendingInbox: s.pendingInbox && typeof s.pendingInbox === 'object' && !Array.isArray(s.pendingInbox) ? s.pendingInbox : {},
    flows: s.flows && typeof s.flows === 'object' && !Array.isArray(s.flows) ? s.flows : {}
  };
}

function readSnap(deps) {
  try { return normalizeEventsSnapshot(deps?.snapshot?.()); }
  catch { return emptySnap(); }
}

function pickLive(live, watch) {
  if (!live || typeof live !== 'object') return {};
  if (!watch?.size) return {};
  const out = {};
  for (const id of watch) if (live[id]) out[id] = live[id];
  return out;
}

/** Recorta o evento: texto/passos só para `watch`. */
export function filterEventForWatch(event, watch) {
  if (!event || typeof event !== 'object') return event;
  if (event.type === 'snapshot') {
    const live = pickLive(event.live, watch);
    return { ...event, live, chats: live };
  }
  if (event.type === 'chat.delta' || event.type === 'chat.live') {
    const id = event.chatId;
    if (id && watch?.size && watch.has(id)) return event;
    if (id && (!watch || !watch.size || !watch.has(id))) {
      return { type: event.type === 'chat.delta' ? 'chat.live' : event.type, chatId: id, streaming: event.streaming !== false };
    }
    return { type: 'chat.live', streaming: true };
  }
  return event;
}

function rememberSnap(snap) {
  lastParts = snap;
  lastJson = JSON.stringify(snap);
}

function writeSse(res, id, payload) {
  if (!res?.writable) return 'closed';
  const high = Number(res.writableLength) || 0;
  if (high > BACKPRESSURE_BYTES) return 'drop';
  const line = `id: ${id}\ndata: ${JSON.stringify(payload)}\n\n`;
  return res.write(line) === false ? 'pause' : 'ok';
}

function sendToClient(client, wrapped) {
  if (!client || client.dropped || client.paused) return;
  if (client.userKey && wrapped._userKey && wrapped._userKey !== '*' && client.userKey !== wrapped._userKey) return;
  const { _userKey, ...publicEv } = wrapped;
  const filtered = filterEventForWatch(publicEv, client.watch);
  const settings = typeof client.settings === 'function' ? client.settings() : client.settings;
  const payload = redactSseEvent(filtered, settings);
  const st = writeSse(client.res, wrapped.id, payload);
  if (st === 'drop' || st === 'closed') {
    client.dropped = true;
    try { client.res?.end(); } catch { /* ignore */ }
    return;
  }
  if (st === 'pause' && client.res?.once) {
    client.paused = true;
    client.res.once('drain', () => { client.paused = false; });
  }
}

function pushLog(wrapped) {
  eventLog.push(wrapped);
  if (eventLog.length > EVENT_LOG_MAX) eventLog.shift();
}

function nextWrapped(event, userKey = null) {
  seq += 1;
  return { ...event, id: seq, _userKey: userKey };
}

function emitHub(event, userKey = null) {
  const wrapped = nextWrapped(event, userKey);
  pushLog(wrapped);
  for (const c of clients.values()) sendToClient(c, wrapped);
  return wrapped;
}

function liveDiffEvents(prevLive, nextLive) {
  const out = [];
  const ids = new Set([...Object.keys(prevLive || {}), ...Object.keys(nextLive || {})]);
  for (const id of ids) {
    const a = prevLive?.[id];
    const b = nextLive?.[id];
    if (!b || !b.streaming) {
      if (a) out.push({ type: 'chat.done', chatId: id, streaming: false });
      continue;
    }
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const prevContent = a?.live?.content || '';
    const nextContent = b.live?.content || '';
    const canAppend = nextContent.startsWith(prevContent);
    const prevSteps = a?.live?.steps?.length || 0;
    out.push({
      type: 'chat.delta',
      chatId: id,
      streaming: true,
      agentId: b.live?.agentId || null,
      at: b.live?.at,
      textAppend: canAppend ? nextContent.slice(prevContent.length) : undefined,
      content: canAppend ? undefined : nextContent,
      stepsAppend: (b.live?.steps || []).slice(prevSteps),
      stepsFrom: prevSteps
    });
  }
  return out;
}

function emitDiffs(snap) {
  const json = JSON.stringify(snap);
  if (json === lastJson) return;
  const prev = lastParts;
  rememberSnap(snap);
  if (!prev) {
    emitHub({ type: 'snapshot', ...snap });
    return;
  }
  if (JSON.stringify(prev.working) !== JSON.stringify(snap.working))
    emitHub({ type: 'working', working: snap.working });
  if (JSON.stringify(prev.approvals) !== JSON.stringify(snap.approvals))
    emitHub({ type: 'approvals', approvals: snap.approvals });
  for (const ev of liveDiffEvents(prev.live, snap.live)) emitHub(ev);
  if (JSON.stringify(prev.pendingInbox) !== JSON.stringify(snap.pendingInbox))
    emitHub({ type: 'inbox', pendingInbox: snap.pendingInbox });
  if (JSON.stringify(prev.flows) !== JSON.stringify(snap.flows))
    emitHub({ type: 'flows', flows: snap.flows });
}

function startHub(deps) {
  hubDeps = deps;
  if (snapTimer) return;
  streamUnsub = onChatStreamsChange(() => emitDiffs(readSnap(hubDeps)));
  const pollMs = Number(deps.pollMs) > 0 ? Number(deps.pollMs) : SNAP_MS;
  snapTimer = setInterval(() => emitDiffs(readSnap(hubDeps)), pollMs);
  if (snapTimer.unref) snapTimer.unref();
}

function stopHub() {
  if (snapTimer) { clearInterval(snapTimer); snapTimer = null; }
  streamUnsub?.();
  streamUnsub = null;
  lastJson = '';
  lastParts = null;
  hubDeps = null;
  seq = 0;
  eventLog.length = 0;
}

function stopHubIfIdle() {
  if (clients.size === 0) stopHub();
}

function lastEventIdOf(req) {
  const raw = req?.headers?.['last-event-id'] ?? req?.headers?.['Last-Event-ID'];
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function replayAfter(client, afterId) {
  if (!afterId || !eventLog.length) return false;
  if (eventLog[0].id > afterId + 1) return false;
  let sent = 0;
  for (const ev of eventLog) {
    if (ev.id <= afterId) continue;
    sendToClient(client, ev);
    sent++;
  }
  return sent > 0 || eventLog.some(e => e.id === afterId);
}

/**
 * GET /api/events — stream SSE autenticado. Devolve true se tratou a rota.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} path
 * @param {{ hdr?: Function, userKey?: (req: object) => string, snapshot?: () => object, settings?: () => object, pollMs?: number, maxConnections?: number }} [deps]
 */
export function handleEventsRoute(req, res, path, deps = {}) {
  if (req.method !== 'GET' || path !== USER_EVENTS_PATH) return false;
  const max = Number(deps.maxConnections) > 0 ? Number(deps.maxConnections) : MAX_EVENT_CONNECTIONS;
  if (clients.size >= max) {
    const extra = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
    res.writeHead(429, deps.hdr ? deps.hdr(req, extra) : extra);
    res.end(JSON.stringify({ error: 'Muitas conexões de eventos. Feche uma aba do Ripper.' }));
    return true;
  }
  const userKey = deps.userKey?.(req) || userKeyFromAuth();
  const watch = parseWatchFromReq(req);
  const extra = {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  };
  res.writeHead(200, deps.hdr ? deps.hdr(req, extra) : extra);
  const settings = () => (typeof deps.settings === 'function' ? deps.settings() : deps.settings);
  startHub(deps);
  if (!lastParts) rememberSnap(readSnap(deps));
  const id = randomUUID();
  const client = { userKey, res, watch, settings, paused: false, dropped: false };
  clients.set(id, client);
  const unsub = () => clients.delete(id);
  const replayed = replayAfter(client, lastEventIdOf(req));
  const hello = nextWrapped({ type: 'hello', at: Date.now(), singleOwner: true });
  pushLog(hello);
  sendToClient(client, hello);
  if (!replayed) {
    const snapEv = nextWrapped({ type: 'snapshot', ...readSnap(deps) });
    pushLog(snapEv);
    sendToClient(client, snapEv);
  }
  const ping = setInterval(() => { if (res.writable) res.write(': ping\n\n'); }, PING_MS);
  if (ping.unref) ping.unref();
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(ping);
    unsub();
    stopHubIfIdle();
  };
  res.on('close', cleanup);
  return true;
}

export function _resetUserEventsForTests() {
  clients.clear();
  stopHub();
}

export function _eventLogForTests() {
  return eventLog.map(({ _userKey, ...e }) => e);
}
