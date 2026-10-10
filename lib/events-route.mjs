/** Canal SSE por usuário: status de trabalho, aprovações e conversas em andamento. */

import { randomUUID } from 'node:crypto';
import { onChatStreamsChange } from './chat-stream.mjs';
import { redactSseEvent } from './redact.mjs';

export const USER_EVENTS_PATH = '/api/events';
const PING_MS = 15_000;
const SNAP_MS = 400;

const clients = new Map(); // id → { userKey, send, res }
let snapTimer = null;
let streamUnsub = null;
let lastJson = '';
let lastParts = null;
let hubDeps = null;

export function userKeyFromAuth() {
  return 'owner';
}

export function subscribeUserEvents(userKey, send, res) {
  const id = randomUUID();
  clients.set(id, { userKey: userKey || 'owner', send, res });
  return () => clients.delete(id);
}

/** Sem userKey (ou `*`) entrega a todos; senão só ao mesmo usuário. */
export function publishUserEvent(userKey, event) {
  for (const c of clients.values()) {
    if (userKey != null && userKey !== '*' && c.userKey !== userKey) continue;
    try { c.send(event); } catch { /* cliente já fechou */ }
  }
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

function emitDiffs(snap) {
  const json = JSON.stringify(snap);
  if (json === lastJson) return;
  const prev = lastParts;
  lastJson = json;
  lastParts = snap;
  if (!prev) {
    publishUserEvent(null, { type: 'snapshot', ...snap });
    return;
  }
  if (JSON.stringify(prev.working) !== JSON.stringify(snap.working))
    publishUserEvent(null, { type: 'working', working: snap.working });
  if (JSON.stringify(prev.approvals) !== JSON.stringify(snap.approvals))
    publishUserEvent(null, { type: 'approvals', approvals: snap.approvals });
  if (JSON.stringify(prev.live) !== JSON.stringify(snap.live))
    publishUserEvent(null, { type: 'chat.live', live: snap.live, chats: snap.live });
  if (JSON.stringify(prev.pendingInbox) !== JSON.stringify(snap.pendingInbox))
    publishUserEvent(null, { type: 'inbox', pendingInbox: snap.pendingInbox });
  if (JSON.stringify(prev.flows) !== JSON.stringify(snap.flows))
    publishUserEvent(null, { type: 'flows', flows: snap.flows });
}

function startHub(deps) {
  hubDeps = deps;
  if (snapTimer) return;
  streamUnsub = onChatStreamsChange(({ chatId, streaming }) => {
    const snap = readSnap(hubDeps);
    const rec = snap.live?.[chatId] || { streaming, live: null };
    publishUserEvent(null, {
      type: streaming ? 'chat.live' : 'chat.done',
      chatId,
      chats: { [chatId]: rec },
      live: { [chatId]: rec }
    });
    if (snap.working) publishUserEvent(null, { type: 'working', working: snap.working });
    lastJson = '';
  });
  snapTimer = setInterval(() => emitDiffs(readSnap(hubDeps)), SNAP_MS);
  if (snapTimer.unref) snapTimer.unref();
}

function stopHub() {
  if (snapTimer) { clearInterval(snapTimer); snapTimer = null; }
  streamUnsub?.();
  streamUnsub = null;
  lastJson = '';
  lastParts = null;
  hubDeps = null;
}

function stopHubIfIdle() {
  if (clients.size === 0) stopHub();
}

/**
 * GET /api/events — stream SSE autenticado. Devolve true se tratou a rota.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} path
 * @param {{ hdr?: Function, userKey?: (req: object) => string, snapshot?: () => object, settings?: () => object }} [deps]
 */
export function handleEventsRoute(req, res, path, deps = {}) {
  if (req.method !== 'GET' || path !== USER_EVENTS_PATH) return false;
  const userKey = deps.userKey?.(req) || userKeyFromAuth();
  const extra = {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  };
  res.writeHead(200, deps.hdr ? deps.hdr(req, extra) : extra);
  const send = event => {
    if (!res.writable) return;
    const settings = typeof deps.settings === 'function' ? deps.settings() : deps.settings;
    res.write(`data: ${JSON.stringify(redactSseEvent(event, settings))}\n\n`);
  };
  startHub(deps);
  const unsub = subscribeUserEvents(userKey, send, res);
  send({ type: 'hello', at: Date.now(), userKey });
  send({ type: 'snapshot', ...readSnap(deps) });
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
  req.on('close', cleanup);
  return true;
}

export function _resetUserEventsForTests() {
  clients.clear();
  stopHub();
}
