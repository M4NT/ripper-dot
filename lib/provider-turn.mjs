import { MODELS } from './router.mjs';
import { mayFallback } from './agent-flow.mjs';
import { isRetryableProviderError, providerRetryDelayMs, sleepMs, normalizeProviderRetry } from './provider-retry.mjs';

/**
 * Ordem de modelos quando o provedor primário falha (Claude ↔ Codex).
 * Exportado para testes sem subir o servidor.
 */
export function providerAttemptOrder(primaryModel, codexInstalled) {
  const provider = MODELS[primaryModel]?.provider;
  if (provider === 'codex') return [primaryModel, 'claude-sonnet-5-5'];
  return codexInstalled ? [primaryModel, 'codex'] : [primaryModel];
}

async function runModelOnce(m, { runModel, emit, signal, steps }) {
  let attempt = '';
  try {
    for await (const ev of runModel(m)) {
      if (ev.text) attempt += ev.text;
      if (ev.tool) steps.push({ tool: ev.tool, detail: ev.detail, at: Date.now() });
      emit(ev);
    }
  } catch (e) {
    if (attempt && !e.streamedAttempt) e.streamedAttempt = attempt;
    throw e;
  }
  if (signal?.aborted) throw Object.assign(new Error('aborted'), { aborted: true, streamedAttempt: attempt });
  return attempt;
}

function applyStreamedAttempt(attempt, out, e) {
  const partial = e?.streamedAttempt || '';
  if (!partial || attempt.endsWith(partial)) return { attempt, out };
  return { attempt: attempt + partial, out: out + partial };
}

/**
 * Executa o loop de tentativa/fallback entre provedores.
 *
 * `runModel(model)` — async generator que emite `{ text?, tool?, detail? }` ou lança erro.
 * `onAttemptFailed` — chamado após cada falha (quota, warn, etc. ficam no caller).
 * `retry` — opções de backoff em rate limit antes de trocar de provedor.
 * Retorna `{ ok, model?, out, steps, error?, aborted? }`.
 */
export async function runProviderAttemptLoop({
  order,
  signal,
  mayFallback: mayFallbackFn = mayFallback,
  runModel,
  emit = () => {},
  onSuccess,
  onAttemptFailed,
  retry: retryOpts
}) {
  const retry = normalizeProviderRetry({ providerRetry: retryOpts || {} });
  let out = '';
  const steps = [];
  for (const m of order) {
    let attempt = '';
    let rateTry = 0;
    for (;;) {
      try {
        const chunk = await runModelOnce(m, { runModel, emit, signal, steps });
        attempt += chunk;
        out += chunk;
        await onSuccess?.({ model: m, out, steps });
        return { ok: true, model: m, out, steps };
      } catch (e) {
        ({ attempt, out } = applyStreamedAttempt(attempt, out, e));
        if (signal?.aborted || e.aborted) {
          await onAttemptFailed?.({ model: m, error: e, aborted: true, attempt, out, steps });
          return { ok: false, aborted: true, model: m, out, steps };
        }
        const retryable = isRetryableProviderError(e) && !attempt && rateTry < retry.maxAttempts - 1;
        if (retryable) {
          rateTry++;
          const delayMs = providerRetryDelayMs(e, rateTry, retry) ?? retry.baseDelayMs;
          emit({ providerRetry: { model: m, attempt: rateTry + 1, maxAttempts: retry.maxAttempts, waitMs: delayMs } });
          try {
            await sleepMs(delayMs, signal);
          } catch {
            await onAttemptFailed?.({ model: m, error: e, aborted: true, attempt, out, steps });
            return { ok: false, aborted: true, model: m, out, steps };
          }
          continue;
        }
        const isLast = m === order.at(-1);
        const canFallback = mayFallbackFn(attempt, isLast);
        await onAttemptFailed?.({ model: m, error: e, aborted: false, attempt, canFallback, out, steps });
        if (!canFallback) {
          return { ok: false, model: m, error: e.message, out, steps };
        }
        const next = order[order.indexOf(m) + 1];
        if (next) emit({ handoff: next, from: m });
        break;
      }
    }
  }
  return { ok: false, out, steps };
}
