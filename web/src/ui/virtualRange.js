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

export function visibleRange({ items, getKey, measured, estimate, scrollTop, viewport, overscan = 6 }) {
  const n = items.length;
  if (!n) return { start: 0, end: 0, total: 0, offset: 0 };
  const prefix = prefixHeights(items, getKey, measured, estimate);
  const total = prefix[n];
  const vh = viewport > 0 ? viewport : estimate * 10;
  const top = Math.max(0, scrollTop);
  const startRaw = lowerBound(prefix, top);
  const endRaw = Math.min(n, lowerBound(prefix, top + vh) + 1);
  const start = Math.max(0, startRaw - overscan);
  const end = Math.min(n, endRaw + overscan);
  return { start, end, total, offset: prefix[start] };
}

export function nearEnd(scrollTop, scrollHeight, clientHeight, threshold = 48) {
  return scrollTop + clientHeight >= scrollHeight - threshold;
}

export function endScrollTop(scrollHeight, clientHeight) {
  return Math.max(0, scrollHeight - clientHeight);
}
