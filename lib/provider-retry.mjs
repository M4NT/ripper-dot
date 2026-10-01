import { parseProviderLimitFromError } from './usage.mjs';

/** Limites padrão de nova tentativa após rate limit (sem inventar cota do provedor). */
export const DEFAULT_PROVIDER_RETRY = { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 60_000 };

export function normalizeProviderRetry(settings = {}) {
  const raw = settings.providerRetry || {};
  const maxAttempts = Math.max(1, Math.min(6, +raw.maxAttempts || DEFAULT_PROVIDER_RETRY.maxAttempts));
  const baseDelayMs = Math.max(200, Math.min(30_000, +raw.baseDelayMs || DEFAULT_PROVIDER_RETRY.baseDelayMs));
  const maxDelayMs = Math.max(baseDelayMs, Math.min(120_000, +raw.maxDelayMs || DEFAULT_PROVIDER_RETRY.maxDelayMs));
  return { maxAttempts, baseDelayMs, maxDelayMs };
}

/** Erro de limite/429 do provedor — candidato a backoff antes de fallback. */
export function isRetryableProviderError(err) {
  return !!parseProviderLimitFromError(err);
}

/**
 * Espera honesta: usa retry-after/reset do erro quando existir; senão backoff exponencial.
 * Nunca devolve um reset inventado.
 */
export function providerRetryDelayMs(err, attempt, opts = {}) {
  const { baseDelayMs, maxDelayMs } = { ...DEFAULT_PROVIDER_RETRY, ...opts };
  const sig = parseProviderLimitFromError(err);
  if (!sig) return null;
  const now = Date.now();
  if (sig.resetAt && sig.resetAt > now) return Math.min(sig.resetAt - now, maxDelayMs);
  return Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt - 1)));
}

export async function sleepMs(ms, signal) {
  if (!ms || ms <= 0) return;
  if (signal?.aborted) throw new Error('aborted');
  await new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    const onAbort = () => { clearTimeout(t); reject(new Error('aborted')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
