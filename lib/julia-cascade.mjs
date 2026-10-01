/**
 * Smart LLM Cascading (PR 56): roteamento por CPS = custo bruto estimado / taxa de sucesso esperada.
 * Catálogo vivo em julia/benchmarks.json (ou caminho em settings.julia.cascade.catalogPath).
 * Valores de custo são estimativas de catálogo — não billing real.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { appendCascadeDecision } from './julia-events.mjs';

const DEFAULT_CATALOG_URL = new URL('../julia/benchmarks.json', import.meta.url);

/** Índice das opções de rota legado → categoria de tarefa. */
export const ROUTE_INDEX_TO_CATEGORY = ['chat_quick', 'reasoning_deep', 'coding'];

export const DEFAULT_TASK_CATEGORY = 'chat_quick';

let catalogCache = { key: null, catalog: null };

function catalogCacheKey(opts = {}) {
  const path = opts.catalogPath || fileURLToPath(DEFAULT_CATALOG_URL);
  return path;
}

/**
 * Carrega o catálogo (com cache por caminho). `settings.julia.cascade.catalogPath` aponta para JSON alternativo.
 * `modelOverrides` mescla entradas por modelId (ex.: benchmarks atualizados pela Julia).
 */
export function loadBenchmarkCatalog(cascadeSettings = {}) {
  const path = cascadeSettings.catalogPath || fileURLToPath(DEFAULT_CATALOG_URL);
  if (catalogCache.key === path && catalogCache.catalog && !cascadeSettings.modelOverrides) {
    return catalogCache.catalog;
  }
  if (!existsSync(path)) {
    throw new Error(`julia cascade: catálogo não encontrado em ${path}`);
  }
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (cascadeSettings.modelOverrides && typeof cascadeSettings.modelOverrides === 'object') {
    raw.models = { ...raw.models, ...cascadeSettings.modelOverrides };
  }
  catalogCache = { key: path, catalog: raw };
  return raw;
}

/** Invalida cache (testes ou após refresh explícito). */
export function resetBenchmarkCatalogCache() {
  catalogCache = { key: null, catalog: null };
}

export function normalizeTaskCategory(category, catalog) {
  const list = catalog?.taskCategories;
  if (category && Array.isArray(list) && list.includes(category)) return category;
  if (category && !list) return category;
  return DEFAULT_TASK_CATEGORY;
}

/** ~4 chars por token; saída estimada como fração do input (conservador para roteamento). */
export function estimateTokensFromText({ prompt = '', context = '', outputRatio = 0.35 } = {}) {
  const inputChars = String(context).length + String(prompt).length;
  const estimatedInputTokens = Math.max(1, Math.ceil(inputChars / 4));
  const estimatedOutputTokens = Math.max(64, Math.ceil(estimatedInputTokens * outputRatio));
  return { estimatedInputTokens, estimatedOutputTokens };
}

export function rawTokenCost(modelEntry, inputTokens, outputTokens) {
  const cin = modelEntry.costPerMillionInput;
  const cout = modelEntry.costPerMillionOutput;
  if (cin == null || cout == null) return null;
  return (inputTokens / 1e6) * cin + (outputTokens / 1e6) * cout;
}

function successRateFor(modelEntry, taskCategory) {
  const c = modelEntry.competencies?.[taskCategory];
  return typeof c === 'number' && c > 0 && c <= 1 ? c : null;
}

/**
 * @param {object} opts
 * @param {object} opts.catalog
 * @param {string} opts.taskCategory
 * @param {number} opts.estimatedInputTokens
 * @param {number} opts.estimatedOutputTokens
 * @param {number} [opts.minSuccessRate]
 * @param {string[]} [opts.allowedModelIds] — restringe ao que o Ripper expõe
 * @param {'latency'|'modelId'} [opts.policy?.tieBreak]
 */
export function selectOptimalModel({
  catalog,
  taskCategory,
  estimatedInputTokens,
  estimatedOutputTokens,
  minSuccessRate,
  policy = {},
  allowedModelIds = null
}) {
  const category = normalizeTaskCategory(taskCategory, catalog);
  const threshold = minSuccessRate ?? catalog.defaultMinSuccessRate ?? 0.8;
  const models = catalog?.models || {};
  const ids = allowedModelIds?.length
    ? allowedModelIds.filter(id => models[id])
    : Object.keys(models);

  const candidatesConsidered = [];
  for (const modelId of ids) {
    const entry = models[modelId];
    const successRate = successRateFor(entry, category);
    if (successRate == null) {
      candidatesConsidered.push({ modelId, excluded: 'missing_competency' });
      continue;
    }
    const rawCost = rawTokenCost(entry, estimatedInputTokens, estimatedOutputTokens);
    if (rawCost == null) {
      candidatesConsidered.push({ modelId, excluded: 'unknown_cost' });
      continue;
    }
    const effectiveCost = rawCost / successRate;
    const row = {
      modelId,
      provider: entry.provider,
      rawCost,
      effectiveCost,
      successRate,
      avgLatencyMs: entry.avgLatencyMs ?? null,
      meetsThreshold: successRate >= threshold
    };
    candidatesConsidered.push(row);
  }

  const eligible = candidatesConsidered.filter(c => c.meetsThreshold && c.effectiveCost != null);
  const tieBreak = policy.tieBreak === 'latency' ? 'latency' : 'modelId';

  const pickBest = (list) => {
    if (!list.length) return null;
    return list.slice().sort((a, b) => {
      if (a.effectiveCost !== b.effectiveCost) return a.effectiveCost - b.effectiveCost;
      if (tieBreak === 'latency') {
        const la = a.avgLatencyMs ?? Number.MAX_SAFE_INTEGER;
        const lb = b.avgLatencyMs ?? Number.MAX_SAFE_INTEGER;
        if (la !== lb) return la - lb;
      }
      return String(a.modelId).localeCompare(String(b.modelId));
    })[0];
  };

  let chosen = pickBest(eligible);
  let fallback = null;
  let reason = 'lowest_cps';

  if (!chosen) {
    const withRate = candidatesConsidered.filter(c => c.successRate != null && c.rawCost != null);
    chosen = pickBest(withRate.map(c => ({ ...c, meetsThreshold: false })));
    if (!chosen) {
      return {
        modelId: null,
        provider: null,
        rawCost: null,
        effectiveCost: null,
        successRate: null,
        candidatesConsidered,
        reason: 'empty_catalog',
        fallback: { action: 'abort', detail: 'Nenhum modelo no catálogo com competência e custo conhecidos.' }
      };
    }
    fallback = {
      action: 'escalate_best_effort',
      detail: `Nenhum modelo atingiu minSuccessRate=${threshold}; escolhido menor CPS entre todos.`
    };
    reason = 'fallback_below_threshold';
  }

  return {
    modelId: chosen.modelId,
    provider: chosen.provider,
    rawCost: chosen.rawCost,
    effectiveCost: chosen.effectiveCost,
    successRate: chosen.successRate,
    candidatesConsidered,
    reason,
    fallback,
    taskCategory: category,
    minSuccessRate: threshold
  };
}

export function inferTaskCategoryFromRouteIndex(index) {
  return ROUTE_INDEX_TO_CATEGORY[index] ?? DEFAULT_TASK_CATEGORY;
}

export function inferTaskCategoryFromText(text) {
  const t = String(text).toLowerCase();
  const code = /```|\b(código|code|bug|erro|script|npm|git|deploy|terminal|instal\w*|rod[ea]r?|build|função|python|typescript)\b/.test(t);
  if (code) return 'coding';
  const hard = text.length > 600 || /\b(planeje|analise|compare|estratégia|arquitetura|prove|por que)\b/.test(t);
  if (hard) return 'reasoning_deep';
  const creative = /\b(poema|história|roteiro|criativ|slogan|copy)\b/.test(t);
  if (creative) return 'creative_writing';
  return 'chat_quick';
}

export function cascadeEnabled(settings) {
  return settings?.julia?.cascade?.enabled !== false;
}

/**
 * Telemetria para PR 60 (sem UI de $). Falhas de gravação não quebram o roteamento.
 */
export function recordCascadeDecision(meta) {
  try {
    appendCascadeDecision(meta);
  } catch (e) {
    console.warn('[julia-cascade] telemetry:', e?.message || e);
  }
}

/** Resolve modelo via CPS após triagem Julia/heurística. */
export function resolveModelWithCascade({
  settings,
  taskCategory,
  prompt,
  context = '',
  routedBy = 'unknown',
  allowedModelIds
}) {
  const catalog = loadBenchmarkCatalog(settings?.julia?.cascade || {});
  const tokens = estimateTokensFromText({ prompt, context });
  const selection = selectOptimalModel({
    catalog,
    taskCategory,
    estimatedInputTokens: tokens.estimatedInputTokens,
    estimatedOutputTokens: tokens.estimatedOutputTokens,
    minSuccessRate: settings?.julia?.cascade?.minSuccessRate,
    policy: settings?.julia?.cascade?.policy || {},
    allowedModelIds
  });
  recordCascadeDecision({
    taskCategory: selection.taskCategory || taskCategory,
    modelId: selection.modelId,
    provider: selection.provider,
    rawCost: selection.rawCost,
    effectiveCost: selection.effectiveCost,
    successRate: selection.successRate,
    candidates: selection.candidatesConsidered?.length ?? 0,
    reason: selection.reason,
    routedBy
  });
  return { ...selection, ...tokens };
}
