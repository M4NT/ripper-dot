/** Streams SSE ativos por conversa — cancelamento explícito sem corromper o histórico. */

const active = new Map();
const changeListeners = new Set();

function notifyChatStreamChange(chatId, phase) {
  const payload = { chatId, phase, streaming: active.has(chatId) };
  for (const fn of changeListeners) {
    try { fn(payload); } catch { /* listener isolado */ }
  }
}

/** Avisa quem acompanha o canal de eventos quando um turno começa ou termina. */
export function onChatStreamsChange(fn) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

/**
 * @param {string} chatId
 * @param {{ signal?: AbortSignal, emit?: (e: object) => void }} opts
 */
export function registerChatStream(chatId, { signal, emit } = {}) {
  const ac = new AbortController();
  const onParentAbort = () => {
    ac.abort('connection'); // aba fechada / rede caiu
    emit?.({ stopped: true });
  };
  if (signal) {
    if (signal.aborted) onParentAbort();
    else signal.addEventListener('abort', onParentAbort, { once: true });
  }
  const entry = { ac, emit, signal: ac.signal };
  active.set(chatId, entry);
  notifyChatStreamChange(chatId, 'start');
  return entry;
}

export function getChatStream(chatId) {
  return active.get(chatId);
}

export function isChatStreaming(chatId) {
  return active.has(chatId);
}

/**
 * Cancela o stream em andamento; retorna false se não havia stream.
 * `reason` fica em signal.reason e é gravado na mensagem cortada (user | tool_loop | …).
 */
export function cancelChatStream(chatId, reason = 'user') {
  const s = active.get(chatId);
  if (!s) return false;
  s.emit?.({ stopped: true, stopReason: reason });
  s.ac.abort(reason);
  return true;
}

export function unregisterChatStream(chatId) {
  const had = active.delete(chatId);
  if (had) notifyChatStreamChange(chatId, 'end');
}

export function listStreamingChatIds() {
  return [...active.keys()];
}

export function activeChatStreamCount() {
  return active.size;
}

export function _resetChatStreamsForTests() {
  active.clear();
  changeListeners.clear();
}
