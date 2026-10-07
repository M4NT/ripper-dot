import { MODELS } from './router.mjs';
import { mayFallback } from './agent-flow.mjs';
import { isRetryableProviderError, providerRetryDelayMs, sleepMs, normalizeProviderRetry } from './provider-retry.mjs';
import { getProviderCircuitBreaker } from './circuit-breaker.mjs';

function providerForModel(model) {
  return MODELS[model]?.provider ?? null;
}

/**
 * Ordem de modelos quando o provedor primário falha (Claude ↔ Codex).
 * Exportado para testes sem subir o servidor.
 */
export function providerAttemptOrder(primaryModel, codexInstalled) {
  const provider = MODELS[primaryModel]?.provider;
  if (['codex', 'openrouter', 'openai', 'gemini', 'ollama'].includes(provider)) return [primaryModel, 'claude-sonnet-5-5'];
  const claude = CLAUDE_BACKUP[primaryModel] ? [primaryModel, CLAUDE_BACKUP[primaryModel]] : [primaryModel];
  return codexInstalled ? [...claude, 'codex'] : claude;
}

// Modelo que a assinatura pode não cobrir (exige créditos de uso): reserva Claude que ela cobre.
const CLAUDE_BACKUP = { 'claude-fable-5-1': 'claude-opus-5-5' };

/** Erro de "este modelo exige créditos de uso" (assinatura sem o modelo): não adianta tentar de novo. */
export const needsUsageCredits = e => /usage credits/i.test(String(e?.message || e || ''));

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
  retry: retryOpts,
  getCircuitBreaker = getProviderCircuitBreaker
}) {
  const retry = normalizeProviderRetry({ providerRetry: retryOpts || {} });
  let out = '';
  const steps = [];
  for (const m of order) {
    const prov = providerForModel(m);
    const cb = prov ? getCircuitBreaker(prov) : null;
    if (cb) {
      const gate = cb.allow();
      if (!gate.allowed) {
        const snap = cb.snapshot();
        emit({
          circuitBreaker: {
            provider: prov,
            state: snap.state,
            model: m,
            retryAfterMs: gate.retryAfterMs
          }
        });
        const isLast = m === order.at(-1);
        if (isLast) {
          return {
            ok: false,
            model: m,
            out,
            steps,
            error: `Circuit breaker aberto (${prov})`,
            circuitOpen: true
          };
        }
        const next = order[order.indexOf(m) + 1];
        if (next) emit({ handoff: next, from: m, reason: 'circuit_open' });
        continue;
      }
      if (gate.probing) emit({ circuitBreaker: { provider: prov, state: 'half_open', model: m, probe: true } });
    }

    let attempt = '';
    let rateTry = 0;
    for (;;) {
      try {
        const chunk = await runModelOnce(m, { runModel, emit, signal, steps });
        attempt += chunk;
        out += chunk;
        cb?.recordSuccess();
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
        if (!needsUsageCredits(e)) cb?.recordFailure(); // modelo fora da assinatura não é o provedor caído: não abre o disjuntor
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
