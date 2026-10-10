/**
 * Canal SSE da instalação (`GET /api/events`) com fallback para polling.
 * Cookie de sessão / `ripper_token` (via `?token=`) autentica o EventSource; Bearer
 * vale nos testes com fetch. Uma aba líder segura o socket; as outras ouvem no
 * BroadcastChannel. Conteúdo ao vivo só chega se a aba pediu `watchUserChat`.
 */
import { useEffect, useState } from 'react';

const BC_NAME = 'ripper.user-events';
const LOCK_NAME = 'ripper.user-events';
const WATCHDOG_MS = 2500;
const SAFETY_LIVE_MS = 15_000;

let source = null;
let status = 'idle'; // idle | connecting | open | fallback
const statusFns = new Set();
const eventFns = new Set();
const localWatches = new Set();
const remoteWatches = new Map(); // tabId → Set(chatId)
const tabId = Math.random().toString(36).slice(2);
let bc = null;
let leader = false;
let stopLeader = null;
let electTimer = null;
let backoffMs = 500;
let lastUrl = '';

export function eventsUrl(watchIds) {
  const w = [...new Set((watchIds || []).filter(Boolean))].map(encodeURIComponent);
  return w.length ? `/api/events?watch=${w.join(',')}` : '/api/events';
}

export function applyChatDelta(prev, ev) {
  if (!ev || ev.streaming === false || ev.type === 'chat.done') return { streaming: false };
  const prevContent = prev?.content || '';
  const content = ev.content != null ? ev.content : prevContent + (ev.textAppend || '');
  const from = ev.stepsFrom != null ? ev.stepsFrom : (prev?.steps || []).length;
  const steps = [...(prev?.steps || []).slice(0, from), ...(ev.stepsAppend || ev.steps || [])];
  return {
    streaming: true,
    live: {
      agentId: ev.agentId || ev.live?.agentId || prev?.agentId,
      content: ev.live?.content ?? content,
      steps: ev.live?.steps || steps,
      at: ev.at || ev.live?.at || Date.now()
    }
  };
}

/** Snapshot/hello sem a conversa em `live` encerra o acompanhamento. */
export function liveRecordForChat(ev, chatId) {
  if (!ev || !chatId) return null;
  if (ev.type === 'chat.done' && ev.chatId === chatId) return { streaming: false };
  if (ev.type === 'chat.delta' && ev.chatId === chatId) return applyChatDelta(null, ev);
  if (ev.type === 'chat.live' && ev.chatId === chatId && ev.live) return { streaming: ev.streaming !== false, live: ev.live };
  if (ev.type === 'snapshot' || ev.type === 'hello') {
    const rec = ev.live?.[chatId] || ev.chats?.[chatId];
    if (!rec || rec.streaming === false) return { streaming: false };
    return rec;
  }
  if ((ev.type === 'chat.live' || ev.type === 'snapshot') && (ev.live?.[chatId] || ev.chats?.[chatId]))
    return ev.live?.[chatId] || ev.chats?.[chatId];
  return null;
}

function setStatus(next) {
  if (status === next) return;
  status = next;
  for (const fn of statusFns) {
    try { fn(status); } catch { /* listener isolado */ }
  }
}

function emit(ev) {
  for (const fn of eventFns) {
    try { fn(ev); } catch { /* listener isolado */ }
  }
}

function allWatchIds() {
  const ids = new Set(localWatches);
  for (const set of remoteWatches.values()) for (const id of set) ids.add(id);
  return [...ids];
}

function announceWatches() {
  bc?.postMessage({ kind: 'watch', tabId, chats: [...localWatches] });
  if (leader) syncLeaderUrl();
}

function onBc(msg) {
  const data = msg?.data;
  if (!data || data.tabId === tabId) return;
  if (data.kind === 'event') {
    setStatus('open');
    emit(data.ev);
  }
  if (data.kind === 'watch') {
    remoteWatches.set(data.tabId, new Set(data.chats || []));
    if (leader) syncLeaderUrl();
  }
  if (data.kind === 'tick' && !leader) setStatus('open');
}

function closeSource() {
  try { source?.close(); } catch { /* ignore */ }
  source = null;
  lastUrl = '';
}

function openEventSource(url) {
  if (typeof EventSource === 'undefined') {
    setStatus('fallback');
    return;
  }
  if (source && lastUrl === url && source.readyState !== 2) return;
  closeSource();
  lastUrl = url;
  setStatus(status === 'open' ? 'open' : 'connecting');
  const es = new EventSource(url);
  source = es;
  let hello = false;
  const watchdog = setTimeout(() => { if (!hello) setStatus('fallback'); }, WATCHDOG_MS);
  es.onmessage = e => {
    hello = true;
    backoffMs = 500;
    clearTimeout(watchdog);
    setStatus('open');
    try {
      const ev = JSON.parse(e.data);
      emit(ev);
      bc?.postMessage({ kind: 'event', tabId, ev });
    } catch { /* evento malformado */ }
  };
  es.onerror = () => {
    setStatus('fallback');
    if (es.readyState === 2) {
      source = null;
      const wait = backoffMs;
      backoffMs = Math.min(8_000, backoffMs * 2);
      setTimeout(() => { if (leader || !bc) connectDirect(url); }, wait);
    }
  };
}

function connectDirect(url) {
  openEventSource(url || eventsUrl(allWatchIds()));
}

function syncLeaderUrl() {
  connectDirect(eventsUrl(allWatchIds()));
}

function becomeLeader() {
  leader = true;
  announceWatches();
  connectDirect();
  const tick = setInterval(() => bc?.postMessage({ kind: 'tick', tabId }), 2000);
  return () => { clearInterval(tick); leader = false; closeSource(); };
}

function tryElect() {
  if (leader || typeof navigator === 'undefined' || !navigator.locks?.request) {
    if (!source) connectDirect();
    return;
  }
  navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async lock => {
    if (!lock) return;
    const stop = becomeLeader();
    await new Promise(resolve => { stopLeader = () => { stop(); resolve(); }; });
  });
}

function startTransport() {
  if (typeof BroadcastChannel !== 'undefined' && !bc) {
    bc = new BroadcastChannel(BC_NAME);
    bc.onmessage = onBc;
  }
  tryElect();
  if (electTimer) clearInterval(electTimer);
  electTimer = setInterval(() => { if (!leader && !source) tryElect(); }, 1500);
  setTimeout(() => { if (status !== 'open') setStatus('fallback'); }, WATCHDOG_MS);
}

export function userEventsStatus() {
  return status;
}

export const USER_EVENTS_SAFETY_MS = SAFETY_LIVE_MS;

export function subscribeUserEvents(fn) {
  eventFns.add(fn);
  startTransport();
  return () => eventFns.delete(fn);
}

export function watchUserEventsStatus(fn) {
  statusFns.add(fn);
  fn(status);
  startTransport();
  return () => statusFns.delete(fn);
}

/** Esta aba quer o conteúdo ao vivo desta conversa (`?watch=`). */
export function watchUserChat(chatId) {
  if (!chatId) return () => {};
  localWatches.add(chatId);
  startTransport();
  announceWatches();
  return () => {
    localWatches.delete(chatId);
    announceWatches();
  };
}

export function useUserEventsConnected() {
  const [s, setS] = useState(status);
  useEffect(() => watchUserEventsStatus(setS), []);
  return s === 'open';
}

/** Polling só enquanto o SSE não está aberto. `load` deve ser estável (ou o efeito reinicia). */
export function useEventsFallback(load, ms, enabled = true) {
  const open = useUserEventsConnected();
  useEffect(() => {
    if (!enabled) return undefined;
    if (open) return undefined;
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), ms);
    return () => clearInterval(t);
  }, [enabled, open, ms, load]);
  return open;
}

export function _resetUserEventsClientForTests() {
  try { source?.close(); } catch { /* ignore */ }
  try { stopLeader?.(); } catch { /* ignore */ }
  try { bc?.close(); } catch { /* ignore */ }
  source = null;
  bc = null;
  leader = false;
  stopLeader = null;
  if (electTimer) clearInterval(electTimer);
  electTimer = null;
  status = 'idle';
  lastUrl = '';
  backoffMs = 500;
  statusFns.clear();
  eventFns.clear();
  localWatches.clear();
  remoteWatches.clear();
}
