/** Fila de entrada do chat: agrupa envios consecutivos numa janela (debounce) antes de um turno. */

export const DEFAULT_INPUT_QUEUE = { enabled: true, windowMs: 2500 };

export function normalizeInputQueue(settings = {}) {
  const raw = settings.inputQueue || {};
  const enabled = raw.enabled !== false;
  const windowMs = Math.max(0, Math.min(10_000, +raw.windowMs || DEFAULT_INPUT_QUEUE.windowMs));
  return { enabled, windowMs };
}

/**
 * Junta vários envios do composer num payload único.
 * @param {Array<{ text?: string, fileIds?: string[], previews?: object[], mcpSession?: object }>} parts
 */
export function coalesceSendParts(parts) {
  if (!parts?.length) return null;
  if (parts.length === 1) {
    const one = parts[0];
    return {
      text: String(one.text || '').trim(),
      fileIds: [...(one.fileIds || [])],
      ...(one.previews?.length ? { previews: one.previews } : {}),
      ...(one.mcpSession ? { mcpSession: one.mcpSession } : {})
    };
  }
  const texts = parts.map(p => String(p.text || '').trim()).filter(Boolean);
  const fileIds = [...new Set(parts.flatMap(p => p.fileIds || []))];
  const previews = [];
  const seen = new Set();
  for (const p of parts) {
    for (const prev of p.previews || []) {
      if (!prev?.id || seen.has(prev.id)) continue;
      seen.add(prev.id);
      previews.push(prev);
    }
  }
  const last = parts.at(-1);
  return {
    text: texts.join('\n\n'),
    fileIds,
    ...(previews.length ? { previews } : {}),
    ...(last?.mcpSession ? { mcpSession: last.mcpSession } : {})
  };
}

/**
 * @param {object} opts
 * @param {boolean} opts.enabled
 * @param {number} opts.windowMs
 * @param {(batch: object) => void} opts.onFlush
 * @param {() => number} [opts.now]
 * @param {(fn: () => void, ms: number) => unknown} [opts.schedule]
 * @param {(id: unknown) => void} [opts.clearSchedule]
 */
function defaultSchedule(fn, ms) {
  const t = setTimeout(fn, ms);
  if (typeof t?.unref === 'function') t.unref();
  return t;
}

export function createInputQueue({ enabled, windowMs, onFlush, now = () => Date.now(), schedule = defaultSchedule, clearSchedule = clearTimeout }) {
  /** @type {object[]} */
  let parts = [];
  /** @type {unknown} */
  let timer = null;

  function cancelTimer() {
    if (timer != null) {
      clearSchedule(timer);
      timer = null;
    }
  }

  function flush() {
    cancelTimer();
    if (!parts.length) return null;
    const batch = coalesceSendParts(parts);
    parts = [];
    if (batch && (batch.text || batch.fileIds?.length)) onFlush(batch);
    return batch;
  }

  function cancel() {
    cancelTimer();
    parts = [];
  }

  function enqueue(part, { immediate = false } = {}) {
    const piece = {
      text: String(part.text || '').trim(),
      fileIds: [...(part.fileIds || [])],
      ...(part.previews?.length ? { previews: part.previews } : {}),
      ...(part.mcpSession ? { mcpSession: part.mcpSession } : {})
    };
    if (!piece.text && !piece.fileIds.length) return null;

    if (!enabled || windowMs <= 0) {
      onFlush(piece);
      return piece;
    }

    parts.push(piece);
    cancelTimer();
    if (immediate) return flush();
    timer = schedule(() => flush(), windowMs);
    return null;
  }

  function scheduleFlush() {
    if (!parts.length) return null;
    if (!enabled || windowMs <= 0) return flush();
    cancelTimer();
    timer = schedule(() => flush(), windowMs);
    return null;
  }

  return {
    enqueue,
    flush,
    cancel,
    scheduleFlush,
    pendingCount: () => parts.length,
    pendingParts: () => [...parts]
  };
}
