/** Intervalo visível de uma lista virtual com altura variável. Sem DOM — dá para testar no Node. */

export function sizeOf(key, measured, estimate) {
  const n = measured.get(key);
  return n > 0 ? n : estimate;
}

/** prefix[i] = pixels antes do item i; prefix[n] = altura total. */
export function prefixHeights(items, getKey, measured, estimate) {
  const prefix = new Array(items.length + 1);
  prefix[0] = 0;
  for (let i = 0; i < items.length; i++) {
    prefix[i + 1] = prefix[i] + sizeOf(getKey(items[i], i), measured, estimate);
  }
  return prefix;
}

export function patchPrefix(prefix, fromIndex, delta) {
  if (!delta || !prefix) return prefix;
  const next = prefix.slice();
  for (let i = fromIndex + 1; i < next.length; i++) next[i] += delta;
  return next;
}

/** Primeiro índice cujo fundo passa de `value` (prefix[i] <= value < prefix[i+1]). */
export function lowerBound(prefix, value) {
  let lo = 0;
  let hi = prefix.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (prefix[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}

export function visibleRange({ items, getKey, measured, estimate, scrollTop, viewport, overscan = 6, prefix: given }) {
  const n = items.length;
  if (!n) return { start: 0, end: 0, total: 0, offset: 0, prefix: given || [0] };
  const prefix = given && given.length === n + 1 ? given : prefixHeights(items, getKey, measured, estimate);
  const total = prefix[n];
  const vh = viewport > 0 ? viewport : estimate * 10;
  const top = Math.max(0, scrollTop);
  const startRaw = lowerBound(prefix, top);
  const endRaw = Math.min(n, lowerBound(prefix, top + vh) + 1);
  const start = Math.max(0, startRaw - overscan);
  const end = Math.min(n, endRaw + overscan);
  return { start, end, total, offset: prefix[start], prefix };
}

export function nearEnd(scrollTop, scrollHeight, clientHeight, threshold = 48) {
  return scrollTop + clientHeight >= scrollHeight - threshold;
}

export function endScrollTop(scrollHeight, clientHeight) {
  return Math.max(0, scrollHeight - clientHeight);
}

/** Se o item medido está acima da janela, o scroll precisa acompanhar o delta. */
export function scrollCompensation(itemTop, scrollTop, delta) {
  if (!delta || itemTop >= scrollTop) return 0;
  return delta;
}

/** Itens novos no topo (mensagens antigas): desloca o scroll pela altura prependida. */
export function prependShift(prevFirstKey, items, getKey, measured, estimate) {
  if (prevFirstKey == null || !items.length) return 0;
  if (getKey(items[0], 0) === prevFirstKey) return 0;
  let shift = 0;
  for (let i = 0; i < items.length; i++) {
    const k = getKey(items[i], i);
    if (k === prevFirstKey) return shift;
    shift += sizeOf(k, measured, estimate);
  }
  return 0;
}

export function liveKeysOf(items, getKey) {
  const s = new Set();
  for (let i = 0; i < items.length; i++) s.add(getKey(items[i], i));
  return s;
}

export function pruneMeasured(measured, liveKeys) {
  for (const k of [...measured.keys()]) {
    if (!liveKeys.has(k)) measured.delete(k);
  }
  return measured;
}

export function indexOfKey(items, getKey, key) {
  for (let i = 0; i < items.length; i++) {
    if (getKey(items[i], i) === key) return i;
  }
  return -1;
}

/** Janela visível + índice focado (se estiver fora). Uma lista só, mesma chave. */
export function pinnedIndices(start, end, pinIdx) {
  const out = [];
  for (let i = start; i < end; i++) out.push(i);
  if (pinIdx >= 0 && (pinIdx < start || pinIdx >= end)) {
    let at = 0;
    while (at < out.length && out[at] < pinIdx) at++;
    out.splice(at, 0, pinIdx);
  }
  return out;
}
