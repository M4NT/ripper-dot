// Fluxos: agentes em sequência (A pesquisa → B escreve → C publica), cada um recebendo o resultado do anterior,
// com pausa para a sua aprovação nos passos marcados. Roda numa conversa normal: você acompanha tudo.

import { keywordHit, parseKeywords } from './event-triggers.mjs';

export const MAX_STEPS = 10;

/** Valida e limpa um fluxo vindo da tela. Lança erro com mensagem para o usuário. */
export function normalizeFlow(b, agents, cur = {}) {
  const name = String(b.name ?? cur.name ?? '').trim().slice(0, 80) || 'Fluxo sem nome';
  const raw = Array.isArray(b.steps) ? b.steps : cur.steps || [];
  if (!raw.length) throw new Error('Adicione pelo menos um passo.');
  if (raw.length > MAX_STEPS) throw new Error(`No máximo ${MAX_STEPS} passos.`);
  const steps = raw.map((st, i) => {
    if (!agents.some(a => a.id === st.agentId)) throw new Error(`Passo ${i + 1}: escolha um agente.`);
    const instruction = String(st.instruction || '').trim().slice(0, 4000);
    if (!instruction) throw new Error(`Passo ${i + 1}: diga o que o agente deve fazer.`);
    const kws = parseKeywords(st.when?.keywords);
    // Condição (ramificação): roda só se o resultado anterior contiver (ou não) estas palavras.
    const when = i > 0 && kws.length ? { mode: st.when.mode === 'not' ? 'not' : 'has', keywords: kws } : undefined;
    return { agentId: st.agentId, instruction, approve: st.approve === true, ...(when ? { when } : {}) };
  });
  return { name, description: String(b.description ?? cur.description ?? '').slice(0, 300), steps };
}

/** O que cada agente recebe: a instrução do passo, o pedido original e o resultado do passo anterior. */
export function stepPrompt(flow, i, input, previous) {
  const st = flow.steps[i];
  return [
    `Você é o passo ${i + 1} de ${flow.steps.length} do fluxo "${flow.name}".`,
    `Sua parte: ${st.instruction}`,
    input && `Pedido original: ${input}`,
    previous && `Resultado do passo anterior:\n${previous}`, // na conversa do fluxo, os passos anteriores já chegam como "respondeu nesta rodada"
    i < flow.steps.length - 1 ? 'Entregue um resultado completo: o próximo passo trabalha em cima dele. Não chame colegas; o fluxo já faz isso.' : 'Você é o último passo: entregue o resultado final.'
  ].filter(Boolean).join('\n\n');
}

/** O passo roda? Sem condição, sempre. Com condição, olha o resultado do último passo que rodou. */
export function stepRuns(step, previous) {
  if (!step.when) return true;
  const hit = keywordHit(step.when.keywords, previous || '');
  return step.when.mode === 'not' ? !hit : hit;
}
