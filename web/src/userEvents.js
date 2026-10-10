/** Canal SSE por usuário (`GET /api/events`) com fallback para polling. */
import { useEffect, useState } from 'react';

let source = null;
let status = 'idle'; // idle | connecting | open | fallback
const statusFns = new Set();
const eventFns = new Set();

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

function connect() {
  if (typeof EventSource === 'undefined') {
    setStatus('fallback');
    return;
  }
  if (source) return;
  setStatus(status === 'open' ? 'open' : 'connecting');
  const es = new EventSource('/api/events');
  source = es;
  let hello = false;
  const watchdog = setTimeout(() => { if (!hello) setStatus('fallback'); }, 2500);
  es.onmessage = e => {
    hello = true;
    clearTimeout(watchdog);
    setStatus('open');
    try { emit(JSON.parse(e.data)); } catch { /* evento malformado */ }
  };
  es.onerror = () => {
    // EventSource reconecta sozinho; enquanto isso a UI volta ao polling.
    setStatus('fallback');
  };
}

export function userEventsStatus() {
  return status;
}

export function subscribeUserEvents(fn) {
  eventFns.add(fn);
  connect();
  return () => eventFns.delete(fn);
}

export function watchUserEventsStatus(fn) {
  statusFns.add(fn);
  fn(status);
  connect();
  return () => statusFns.delete(fn);
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
  source = null;
  status = 'idle';
  statusFns.clear();
  eventFns.clear();
}
