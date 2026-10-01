/** Cache assíncrono com TTL fixo (uma entrada). */
export function memoAsync(fn, ttlMs) {
  let value;
  let expires = 0;
  let inflight;
  return async (...args) => {
    const now = Date.now();
    if (value !== undefined && now < expires) return value;
    if (inflight) return inflight;
    inflight = fn(...args).then(r => {
      value = r;
      expires = Date.now() + ttlMs;
      inflight = undefined;
      return r;
    }).catch(e => {
      inflight = undefined;
      throw e;
    });
    return inflight;
  };
}

/** Cache síncrono com TTL fixo. */
export function memoSync(fn, ttlMs) {
  let value;
  let expires = 0;
  return (...args) => {
    const now = Date.now();
    if (value !== undefined && now < expires) return value;
    value = fn(...args);
    expires = now + ttlMs;
    return value;
  };
}
