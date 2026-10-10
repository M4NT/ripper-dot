// Julia 1 como middleware de decisão: contrato fixo { contexto, pergunta, opções[2..20] } → { escolha, scores }.
// Usada onde o LLM grande erra por custo/latência (triagem, roteamento, notificar vs silenciar),
// nunca para dinheiro, código ou cálculo. Sem Julia no ar, quem chama usa a regra de reserva.

import { appendJuliaDecision } from './julia-events.mjs';
import { lgpdMiddlewareText } from './lgpd-pii.mjs';

let online = null, checkedAt = 0;
const PROBE_TTL_MS = 60_000;

/** Último resultado da sonda de saúde (observável em log e GET /api/julia/status). */
export let juliaStatus = { online: null, reason: null, checkedAt: 0 };

export function resetJuliaProbe() {
  online = null;
  checkedAt = 0;
  juliaStatus = { online: null, reason: null, checkedAt: 0 };
}

function noteStatus(reason, isOnline) {
  juliaStatus = { online: isOnline, reason, checkedAt: Date.now() };
}

function baseUrl(settings) {
  return (settings?.julia?.url || '').replace(/\/$/, '');
}

/**
 * Estimativa honesta de caracteres do prompt de triagem que teriam ido ao modelo grande
 * se Julia não existisse. Fórmula: len(context) + len(question) + soma(len(option)) + 2×n opções (separadores).
 * Omita no evento se o call site não puder medir o texto real.
 */
export function measureTriagePromptChars({ context = '', question, options }) {
  if (!Array.isArray(options)) return null;
  const optsLen = options.reduce((n, o) => n + String(o).length, 0);
  return String(context).length + String(question).length + optsLen + options.length * 2;
}

function recordDecision(startedAt, purpose, optionCount, result, avoidedPromptChars) {
  try {
    appendJuliaDecision({
      at: Date.now(),
      purpose,
      latencyMs: Date.now() - startedAt,
      optionCount,
      ok: result.ok === true,
      reason: result.ok ? null : (result.reason || 'unknown'),
      score: result.ok ? result.score : (result.score ?? null),
      avoidedPromptChars
    });
  } catch (e) {
    console.warn('[julia] telemetry:', e?.message || e);
  }
}

/** A Julia responde? (cache de 60 s para não atrasar cada ação.) */
export async function juliaOnline(settings) {
  if (Date.now() - checkedAt < PROBE_TTL_MS && online !== null) return online;
  checkedAt = Date.now();
  const url = baseUrl(settings);
  if (!url) {
    online = false;
    noteStatus('no_url', false);
    return false;
  }
  try {
    const r = await fetch(url + '/health', { signal: AbortSignal.timeout(1200) });
    if (!r.ok) {
      online = false;
      noteStatus(`health_http_${r.status}`, false);
      return false;
    }
    const body = await r.json().catch(() => ({}));
    online = body.ok === true;
    noteStatus(online ? 'ok' : 'health_not_ok', online);
  } catch (e) {
    online = false;
    noteStatus(e?.name === 'TimeoutError' ? 'health_timeout' : 'health_unreachable', false);
  }
  return online;
}

/**
 * Timeout do /choose no caminho do 1º token (roteamento Auto, orador do grupo).
 * A Julia local responde em dezenas de ms; se atrasar, a reserva entra na hora.
 */
export const JULIA_FAST_TIMEOUT_MS = 400;

/**
 * POST /choose com motivo explícito quando falha (offline, timeout, HTTP, resposta inválida, confiança baixa).
 * Não espera /health: uma ida só ao sidecar. Se a sonda recente já marcou offline, cai na hora.
 * @returns {{ ok: true, best: number, scores: number[], score: number } | { ok: false, reason: string }}
 */
export async function juliaPostChoose(
  settings,
  { context = '', question, options },
  { timeout = 2000, minScore = 0, purpose = 'unknown', avoidedPromptChars = null } = {}
) {
  const startedAt = Date.now();
  const optionCount = Array.isArray(options) ? options.length : 0;
  const finish = (result) => {
    recordDecision(startedAt, purpose, optionCount, result, avoidedPromptChars);
    return result;
  };

  if (!Array.isArray(options) || options.length < 2 || options.length > 20) {
    return finish({ ok: false, reason: 'invalid_options' });
  }
  const url = baseUrl(settings);
  if (!url) {
    online = false;
    checkedAt = Date.now();
    noteStatus('no_url', false);
    console.warn('[julia] fallback: no_url');
    return finish({ ok: false, reason: 'no_url' });
  }
  // Reserva imediata: não gasta o timeout se a Julia já falhou há pouco.
  if (online === false && Date.now() - checkedAt < PROBE_TTL_MS) {
    const reason = juliaStatus.reason || 'offline';
    console.warn('[julia] fallback:', reason);
    return finish({ ok: false, reason });
  }
  try {
    const r = await fetch(url + '/choose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        context: lgpdMiddlewareText(context.slice(-1500), settings),
        question: lgpdMiddlewareText(String(question).slice(0, 1500), settings),
        options
      }),
      signal: AbortSignal.timeout(timeout)
    });
    if (!r.ok) {
      online = false;
      checkedAt = Date.now();
      noteStatus(`choose_http_${r.status}`, false);
      console.warn('[julia] fallback: choose_http_' + r.status);
      return finish({ ok: false, reason: `choose_http_${r.status}` });
    }
    const { best, scores } = await r.json();
    if (!Number.isInteger(best) || !options[best]) {
      console.warn('[julia] fallback: invalid_response');
      return finish({ ok: false, reason: 'invalid_response' });
    }
    const score = Array.isArray(scores) ? scores[best] : 1;
    if (minScore > 0 && score < minScore) {
      console.warn('[julia] fallback: low_score', score);
      return finish({ ok: false, reason: 'low_score', score });
    }
    online = true;
    checkedAt = Date.now();
    noteStatus('ok', true);
    return finish({ ok: true, best, scores: Array.isArray(scores) ? scores : [], score });
  } catch (e) {
    online = false;
    checkedAt = Date.now();
    const reason = e?.name === 'TimeoutError' ? 'choose_timeout' : 'choose_error';
    noteStatus(reason, false);
    console.warn('[julia] fallback:', reason);
    return finish({ ok: false, reason });
  }
}

/**
 * Pergunta à Julia. Devolve { index, score } ou null (fora do ar, resposta inválida ou confiança baixa).
 * minScoreOrOpts: número (confiança mínima) ou { minScore, purpose, avoidedPromptChars }.
 */
export async function juliaChoose(settings, payload, minScoreOrOpts = 0.5) {
  const opts = typeof minScoreOrOpts === 'number'
    ? { minScore: minScoreOrOpts }
    : { minScore: 0.5, ...minScoreOrOpts };
  const r = await juliaPostChoose(settings, payload, { timeout: 2000, ...opts });
  return r.ok ? { index: r.best, score: r.score } : null;
}

export const RISK_OPTIONS = [
  'Rotineiro e reversível: ler, listar, instalar pacote, rodar script local, criar arquivo.',
  'Destrutivo ou irreversível: apaga, sobrescreve, publica, envia, altera algo fora da caixa de areia.',
  'Envolve dinheiro: pagamento, compra, transferência, cobrança.',
  'Expõe dados pessoais ou segredos: senhas, tokens, CPF, dados de clientes.'
];
export const NOTIFY_OPTIONS = [
  'Notificar: há novidade relevante para o usuário.',
  'Silenciar: nada novo ou nada que o usuário precise ver.',
  'Escalar: algo urgente, quebrado ou que exige ação imediata.'
];

/**
 * Sobe o sidecar junto com o Ripper quando os pesos estão instalados em julia/Julia-1
 * e nada responde no endereço local configurado. JULIA_AUTOSTART=0 desliga.
 */
export async function autoStartJulia(settings) {
  if (process.env.JULIA_AUTOSTART === '0') return null;
  const url = baseUrl(settings);
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!['127.0.0.1', 'localhost'].includes(u.hostname)) return null;
  const { existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const modelDir = fileURLToPath(new URL('../julia/Julia-1/', import.meta.url));
  if (!existsSync(modelDir)) return null;
  try { if ((await fetch(url + '/health', { signal: AbortSignal.timeout(1200) })).ok) return null; } catch { /* fora do ar: sobe */ }
  const { spawn } = await import('node:child_process');
  const child = spawn(process.platform === 'win32' ? 'python' : 'python3', [fileURLToPath(new URL('../julia/serve.py', import.meta.url))], {
    env: { ...process.env, JULIA_MODEL_PATH: modelDir, JULIA_PORT: u.port || '8765' },
    stdio: 'ignore',
    windowsHide: true
  });
  child.on('error', e => console.warn('[julia] não subiu:', e.message));
  child.on('exit', () => resetJuliaProbe());
  process.on('exit', () => child.kill());
  resetJuliaProbe();
  console.log('[julia] sidecar iniciado em', url);
  return child;
}

export const MEMORY_OPTIONS = [
  'Fato estável sobre o usuário ou o trabalho dele (preferência, contexto, regra que vale sempre).',
  'Detalhe passageiro desta conversa (tarefa do dia, número pontual, algo que muda logo).'
];

export const REPLY_OPTIONS = [
  'Precisa de resposta: pergunta, pedido, dúvida ou algo que espera retorno.',
  'Não precisa de resposta: agradecimento, "ok", emoji, confirmação ou encerramento.'
];
