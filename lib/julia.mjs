// Julia 1 como middleware de decisão: contrato fixo { contexto, pergunta, opções[2..20] } → { escolha, scores }.
// Usada onde o LLM grande erra por custo/latência (triagem, roteamento, notificar vs silenciar),
// nunca para dinheiro, código ou cálculo. Sem Julia no ar, quem chama usa a regra de reserva.

let online = null, checkedAt = 0;

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

/** A Julia responde? (cache de 60 s para não atrasar cada ação.) */
export async function juliaOnline(settings) {
  if (Date.now() - checkedAt < 60_000 && online !== null) return online;
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
 * POST /choose com motivo explícito quando falha (offline, timeout, HTTP, resposta inválida, confiança baixa).
 * @returns {{ ok: true, best: number, scores: number[], score: number } | { ok: false, reason: string }}
 */
export async function juliaPostChoose(settings, { context = '', question, options }, { timeout = 2000, minScore = 0 } = {}) {
  if (!Array.isArray(options) || options.length < 2 || options.length > 20) {
    return { ok: false, reason: 'invalid_options' };
  }
  if (!(await juliaOnline(settings))) {
    const reason = juliaStatus.reason || 'offline';
    console.warn('[julia] fallback:', reason);
    return { ok: false, reason };
  }
  const url = baseUrl(settings);
  try {
    const r = await fetch(url + '/choose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        context: context.slice(-1500),
        question: String(question).slice(0, 1500),
        options
      }),
      signal: AbortSignal.timeout(timeout)
    });
    if (!r.ok) {
      online = false;
      noteStatus(`choose_http_${r.status}`, false);
      console.warn('[julia] fallback: choose_http_' + r.status);
      return { ok: false, reason: `choose_http_${r.status}` };
    }
    const { best, scores } = await r.json();
    if (!Number.isInteger(best) || !options[best]) {
      console.warn('[julia] fallback: invalid_response');
      return { ok: false, reason: 'invalid_response' };
    }
    const score = Array.isArray(scores) ? scores[best] : 1;
    if (minScore > 0 && score < minScore) {
      console.warn('[julia] fallback: low_score', score);
      return { ok: false, reason: 'low_score', score };
    }
    return { ok: true, best, scores: Array.isArray(scores) ? scores : [], score };
  } catch (e) {
    online = false;
    const reason = e?.name === 'TimeoutError' ? 'choose_timeout' : 'choose_error';
    noteStatus(reason, false);
    console.warn('[julia] fallback:', reason);
    return { ok: false, reason };
  }
}

/**
 * Pergunta à Julia. Devolve { index, score } ou null (fora do ar, resposta inválida ou confiança baixa).
 * minScore: abaixo disso a decisão é considerada incerta e quem chama cai na regra de reserva.
 */
export async function juliaChoose(settings, payload, minScore = 0.5) {
  const r = await juliaPostChoose(settings, payload, { timeout: 2000, minScore });
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
