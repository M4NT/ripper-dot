import { MODELS } from './router.mjs';
import { mayFallback } from './agent-flow.mjs';

/**
 * Ordem de modelos quando o provedor primário falha (Claude ↔ Codex).
 * Exportado para testes sem subir o servidor.
 */
export function providerAttemptOrder(primaryModel, codexInstalled) {
  const provider = MODELS[primaryModel]?.provider;
  if (provider === 'codex') return [primaryModel, 'claude-sonnet-5-5'];
  return codexInstalled ? [primaryModel, 'codex'] : [primaryModel];
}

/**
 * Executa o loop de tentativa/fallback entre provedores.
 *
 * `runModel(model)` — async generator que emite `{ text?, tool?, detail? }` ou lança erro.
 * `onAttemptFailed` — chamado após cada falha (quota, warn, etc. ficam no caller).
 * Retorna `{ ok, model?, out, steps, error?, aborted? }`.
 */
export async function runProviderAttemptLoop({
  order,
  signal,
  mayFallback: mayFallbackFn = mayFallback,
  runModel,
  emit = () => {},
  onSuccess,
  onAttemptFailed
}) {
  let out = '';
  const steps = [];
  for (const m of order) {
    let attempt = '';
    try {
      for await (const ev of runModel(m)) {
        if (ev.text) {
          attempt += ev.text;
          out += ev.text;
        }
        if (ev.tool) steps.push({ tool: ev.tool, detail: ev.detail, at: Date.now() });
        emit(ev);
      }
      if (signal?.aborted) {
        await onAttemptFailed?.({ model: m, error: new Error('aborted'), aborted: true, attempt, out, steps });
        return { ok: false, aborted: true, model: m, out, steps };
      }
      await onSuccess?.({ model: m, out, steps });
      return { ok: true, model: m, out, steps };
    } catch (e) {
      if (signal?.aborted) {
        await onAttemptFailed?.({ model: m, error: e, aborted: true, attempt, out, steps });
        return { ok: false, aborted: true, model: m, out, steps };
      }
      const isLast = m === order.at(-1);
      const canFallback = mayFallbackFn(attempt, isLast);
      await onAttemptFailed?.({ model: m, error: e, aborted: false, attempt, canFallback, out, steps });
      if (!canFallback) {
        return { ok: false, model: m, error: e.message, out, steps };
      }
      emit({ handoff: order[1] });
    }
  }
  return { ok: false, out, steps };
}
