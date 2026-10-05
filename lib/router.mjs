// Modo automático: Julia 1 classifica a tarefa; cascading CPS (lib/julia-cascade.mjs) escolhe o modelo.
// Se o sidecar do Julia não estiver no ar, cai numa heurística (com log [julia] fallback).

import { juliaPostChoose, measureTriagePromptChars } from './julia.mjs';
import {
  cascadeEnabled,
  inferTaskCategoryFromRouteIndex,
  inferTaskCategoryFromText,
  resolveModelWithCascade
} from './julia-cascade.mjs';

export const EFFORTS = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];

export const MODELS = {
  auto: { label: 'Ripper Auto' },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5', provider: 'claude' },
  'claude-opus-5-5': { label: 'Claude Opus 5.5', provider: 'claude' },
  'claude-fable-5-1': { label: 'Claude Fable 5.1', provider: 'claude' },
  'claude-haiku-4-5': { label: 'Claude Haiku 4.5', provider: 'claude' }, // o mais econômico: mensagens de canal (WhatsApp)
  codex: { label: 'Codex (ChatGPT)', provider: 'codex' }
};

const ROUTES = [
  { model: 'claude-sonnet-5-5', option: 'Pergunta simples, conversa rápida, resumo ou busca.' },
  { model: 'claude-opus-5-5', option: 'Raciocínio difícil, planejamento, análise longa ou escrita cuidadosa.' },
  { model: 'codex', option: 'Escrever, rodar ou depurar código e comandos no computador.' },
  // no fim: os índices acima alimentam o mapa de categorias da cascata
  { model: 'claude-haiku-4-5', option: 'Conversa curta: cumprimento, agradecimento, confirmação (ok, sim, pode).' }
];

const SMALL_TALK = /^\s*(oi|ol[áa]|bom dia|boa tarde|boa noite|e a[íi]|obrigad[oa]|valeu|vlw|ok|okay|beleza|blz|sim|n[ãa]o|pode|certo|perfeito|show|top|tchau|at[ée] mais)[\s!.,?]*$/i;

function heuristicRoute(text) {
  const t = text.toLowerCase();
  const code = /```|\b(código|code|bug|erro|script|npm|git|deploy|terminal|instal\w*|rod[ea]r?|build|função|python|typescript)\b/.test(t);
  const hard = text.length > 600 || /\b(planeje|analise|compare|estratégia|arquitetura|prove|por que)\b/.test(t);
  if (SMALL_TALK.test(text)) return { ...ROUTES[3], by: 'heuristic' };
  return { ...ROUTES[code ? 2 : hard ? 1 : 0], by: 'heuristic' };
}

// Níveis concretos de esforço, do mais leve ao mais pesado ('auto' = o Ripper decide).
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const EFFORT_OPTIONS = {
  low: 'Resposta direta e curta, sem pensar muito.',
  medium: 'Algum raciocínio: comparar, explicar ou resumir com cuidado.',
  high: 'Raciocínio cuidadoso em várias etapas.',
  xhigh: 'Problema difícil: planejamento longo, depuração ou análise profunda.',
  max: 'O máximo de profundidade possível, sem economizar.'
};

/** Modelos liberados em Configurações → Modelos (padrão: todos). */
export function enabledModels(settings) {
  const on = settings?.models?.enabled || {};
  return Object.keys(MODELS).filter(k => k !== 'auto' && on[k] !== false);
}

/** Teto de esforço de um modelo (padrão: sem teto). */
export function maxEffortFor(settings, model) {
  const cap = settings?.models?.maxEffort?.[model];
  return EFFORT_LEVELS.includes(cap) ? cap : 'max';
}

/** Rebaixa o esforço ao teto do modelo. 'auto' com teto definido vira o próprio teto. */
export function clampEffort(settings, model, effort) {
  const cap = maxEffortFor(settings, model);
  if (!effort || effort === 'auto') return cap === 'max' ? 'auto' : cap;
  return EFFORT_LEVELS.indexOf(effort) > EFFORT_LEVELS.indexOf(cap) ? cap : effort;
}

function heuristicEffort(text) {
  const hard = text.length > 600 || /\b(planeje|analise|compare|estratégia|arquitetura|prove|depure|por que)\b/i.test(text);
  return hard ? 'high' : text.length > 160 ? 'medium' : 'low';
}

/** Com esforço 'auto', a Julia escolhe o nível entre os permitidos para o modelo escolhido. */
async function chooseEffort(text, context, settings, model) {
  const cap = maxEffortFor(settings, model);
  const levels = EFFORT_LEVELS.slice(0, EFFORT_LEVELS.indexOf(cap) + 1);
  if (levels.length === 1) return { effort: levels[0], effortBy: 'cap' };
  const options = levels.map(l => EFFORT_OPTIONS[l]);
  const res = await juliaPostChoose(settings, { context, question: text, options }, {
    timeout: 1500,
    minScore: 0,
    purpose: 'effort',
    avoidedPromptChars: measureTriagePromptChars({ context, question: text, options })
  });
  if (res.ok) return { effort: levels[res.best], effortBy: 'julia-1' };
  return { effort: clampEffort(settings, model, heuristicEffort(text)), effortBy: 'heuristic' };
}

/** Correções recentes do usuário viram exemplos no contexto da Julia (aprende sem re-treino). */
export function correctionHints(corrections = []) {
  if (!corrections.length) return '';
  return 'Preferências do usuário em pedidos parecidos:\n' + corrections
    .map(c => `- "${c.ask}" → prefere ${MODELS[c.to]?.label || c.to} (não ${MODELS[c.from]?.label || c.from})`).join('\n') + '\n\n';
}

const words = s => new Set(String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{5,}/g) || []);

/**
 * Correção repetida vence a classificação: 2+ pedidos parecidos (2+ palavras em comum)
 * que você trocou para o mesmo modelo. ponytail: sobreposição de palavras, sem embeddings;
 * trocar por similaridade semântica se errar em pedidos com vocabulário diferente.
 */
export function learnedModel(text, corrections = [], allowed = []) {
  const w = words(text);
  const votes = {};
  for (const c of corrections) {
    const common = [...words(c.ask)].filter(x => w.has(x)).length;
    if (common >= 2 && allowed.includes(c.to)) votes[c.to] = (votes[c.to] || 0) + 1;
  }
  const [best] = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  return best && best[1] >= 2 ? best[0] : null;
}

export async function route(text, history, settings, { effort, corrections } = {}) {
  const context = (correctionHints(corrections?.slice(-3)) + history.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n')).slice(-1500);
  const allowed = enabledModels(settings);
  const routes = ROUTES.filter(r => allowed.includes(r.model));
  const autoEffort = !effort || effort === 'auto';
  const learned = learnedModel(text, corrections, allowed);
  if (learned) {
    const pick = { model: learned, by: 'learned' };
    if (autoEffort) Object.assign(pick, await chooseEffort(text, context, settings, learned));
    return pick;
  }
  // Só um modelo liberado com rota: não há o que classificar.
  if (routes.length <= 1) {
    const only = routes[0]?.model || allowed[0] || 'claude-sonnet-5-5';
    const pick = { model: only, by: 'policy' };
    if (autoEffort) Object.assign(pick, await chooseEffort(text, context, settings, only));
    return pick;
  }
  const options = routes.map(r => r.option);
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
  const legacyPick = res.ok
    ? { ...routes[res.best], scores: res.scores, by: 'julia-1' }
    : heuristicRoute(text);
  // A heurística conhece todas as rotas; se apontar para um modelo desligado, usa o primeiro liberado.
  if (!allowed.includes(legacyPick.model)) legacyPick.model = routes[0].model;
  const routeIndex = ROUTES.findIndex(r => r.model === legacyPick.model);
  let pick = legacyPick;
  if (!res.ok && res.reason) pick.fallbackReason = res.reason;

  if (cascadeEnabled(settings) && pick.model !== 'claude-haiku-4-5') {
    const taskCategory = res.ok
      ? inferTaskCategoryFromRouteIndex(routeIndex)
      : inferTaskCategoryFromText(text);
    const allowedModelIds = allowed;
    const cascade = resolveModelWithCascade({
      settings,
      taskCategory,
      prompt: text,
      context,
      routedBy: pick.by,
      allowedModelIds
    });
    if (cascade.modelId) {
      pick = {
        ...pick,
        model: cascade.modelId,
        by: `${pick.by}+cascade`,
        taskCategory: cascade.taskCategory,
        cascade
      };
    }
  }

  // Esforço alto pedido explicitamente: o simples vira profundo.
  if (['xhigh', 'max'].includes(effort) && pick.model === 'claude-sonnet-5-5' && allowed.includes('claude-opus-5-5')) pick.model = 'claude-opus-5-5';
  if (autoEffort) Object.assign(pick, await chooseEffort(text, context, settings, pick.model));
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

/** Limpa settings.models: só modelos conhecidos, níveis válidos e pelo menos um modelo ligado. */
export function normalizeModelPolicy(raw = {}) {
  const ids = Object.keys(MODELS).filter(k => k !== 'auto');
  const enabled = {}, maxEffort = {};
  for (const id of ids) {
    if (typeof raw.enabled?.[id] === 'boolean') enabled[id] = raw.enabled[id];
    if (EFFORT_LEVELS.includes(raw.maxEffort?.[id])) maxEffort[id] = raw.maxEffort[id];
  }
  if (ids.every(id => enabled[id] === false)) delete enabled['claude-sonnet-5-5']; // nunca fica sem modelo
  return { enabled, maxEffort };
}
