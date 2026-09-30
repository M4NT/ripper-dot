// Julia 1 como middleware de decisão: contrato fixo { contexto, pergunta, opções[2..20] } → { escolha, scores }.
// Usada onde o LLM grande erra por custo/latência (triagem, roteamento, notificar vs silenciar),
// nunca para dinheiro, código ou cálculo. Sem Julia no ar, quem chama usa a regra de reserva.

let online = null, checkedAt = 0;

/** A Julia responde? (cache de 60 s para não atrasar cada ação.) */
export async function juliaOnline(settings) {
  if (Date.now() - checkedAt < 60_000 && online !== null) return online;
  checkedAt = Date.now();
  try {
    const r = await fetch(settings.julia.url + '/choose', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context: '', question: 'ping', options: ['sim', 'não'] }),
      signal: AbortSignal.timeout(1200)
    });
    online = r.ok;
  } catch { online = false; }
  return online;
}

/**
 * Pergunta à Julia. Devolve { index, score } ou null (fora do ar, resposta inválida ou confiança baixa).
 * minScore: abaixo disso a decisão é considerada incerta e quem chama cai na regra de reserva.
 */
export async function juliaChoose(settings, { context = '', question, options }, minScore = 0.5) {
  if (!(await juliaOnline(settings))) return null;
  try {
    const r = await fetch(settings.julia.url + '/choose', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context: context.slice(-1500), question: question.slice(0, 1500), options }),
      signal: AbortSignal.timeout(2000)
    });
    if (!r.ok) return null;
    const { best, scores } = await r.json();
    if (!Number.isInteger(best) || !options[best]) return null;
    const score = Array.isArray(scores) ? scores[best] : 1;
    return score >= minScore ? { index: best, score } : null;
  } catch { online = false; return null; }
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
