/** Streams SSE ativos por conversa — cancelamento explícito sem corromper o histórico. */

const active = new Map();

/**
 * @param {string} chatId
 * @param {{ signal?: AbortSignal, emit?: (e: object) => void }} opts
 */
export function registerChatStream(chatId, { signal, emit } = {}) {
  const ac = new AbortController();
  const onParentAbort = () => {
    ac.abort();
    emit?.({ stopped: true });
  };
  if (signal) {
    if (signal.aborted) onParentAbort();
    else signal.addEventListener('abort', onParentAbort, { once: true });
  }
  const entry = { ac, emit, signal: ac.signal };
  active.set(chatId, entry);
  return entry;
}

export function getChatStream(chatId) {
  return active.get(chatId);
}

export function isChatStreaming(chatId) {
  return active.has(chatId);
}

/** Cancela o stream em andamento; retorna false se não havia stream. */
export function cancelChatStream(chatId) {
  const s = active.get(chatId);
  if (!s) return false;
  s.emit?.({ stopped: true });
  s.ac.abort();
  return true;
}

export function unregisterChatStream(chatId) {
  active.delete(chatId);
}

export function _resetChatStreamsForTests() {
  active.clear();
}
