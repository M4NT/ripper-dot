// Modo automático: Julia 1 decide entre Sonnet 5.5, Opus 5.5 e Codex.
// Se o sidecar do Julia não estiver no ar, cai numa heurística (com log [julia] fallback).

import { juliaPostChoose, measureTriagePromptChars } from './julia.mjs';

export const EFFORTS = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];

export const MODELS = {
  auto: { label: 'Ripper Auto' },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5', provider: 'claude' },
  'claude-opus-5-5': { label: 'Claude Opus 5.5', provider: 'claude' },
  'claude-fable-5-1': { label: 'Claude Fable 5.1', provider: 'claude' },
  codex: { label: 'Codex (ChatGPT)', provider: 'codex' }
};

const ROUTES = [
  { model: 'claude-sonnet-5-5', option: 'Pergunta simples, conversa rápida, resumo ou busca.' },
  { model: 'claude-opus-5-5', option: 'Raciocínio difícil, planejamento, análise longa ou escrita cuidadosa.' },
  { model: 'codex', option: 'Escrever, rodar ou depurar código e comandos no computador.' }
];

function heuristicRoute(text) {
  const t = text.toLowerCase();
  const code = /```|\b(código|code|bug|erro|script|npm|git|deploy|terminal|instal\w*|rod[ea]r?|build|função|python|typescript)\b/.test(t);
  const hard = text.length > 600 || /\b(planeje|analise|compare|estratégia|arquitetura|prove|por que)\b/.test(t);
  return { ...ROUTES[code ? 2 : hard ? 1 : 0], by: 'heuristic' };
}

export async function route(text, history, settings, { effort } = {}) {
  const context = history.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n').slice(-1500);
  const options = ROUTES.map(r => r.option);
  const res = await juliaPostChoose(
    settings,
    { context, question: text, options },
    {
      timeout: 1500,
      minScore: 0,
      purpose: 'route',
      avoidedPromptChars: measureTriagePromptChars({ context, question: text, options })
    }
  );
  let pick = res.ok
    ? { ...ROUTES[res.best], scores: res.scores, by: 'julia-1' }
    : heuristicRoute(text);
  if (!res.ok && res.reason) pick.fallbackReason = res.reason;
  // Esforço alto pedido explicitamente: o simples vira profundo.
  if (['xhigh', 'max'].includes(effort) && pick.model === 'claude-sonnet-5-5') pick.model = 'claude-opus-5-5';
  return pick;
}

/**
 * Quem deve abrir a conversa em grupo. O Julia 1 escolhe entre as funções dos agentes;
 * sem Julia no ar, a heurística por palavras decide. Assim só um agente gasta tokens.
 */
export async function classifySpeaker(text, members, settings, fallback) {
  const context = 'Escolha quem do time deve responder primeiro a este pedido.';
  const question = text.slice(0, 1500);
  const options = members.map(a => `${a.name}: ${a.description || a.category || 'agente'}`);
  const res = await juliaPostChoose(
    settings,
    { context, question, options },
    {
      timeout: 1500,
      minScore: 0,
      purpose: 'speaker',
      avoidedPromptChars: measureTriagePromptChars({ context, question, options })
    }
  );
  if (res.ok && members[res.best]) return members[res.best];
  return fallback(text, members);
}
