/** Poda dinâmica de contexto antes de enviar histórico ao provedor (opt-in). */

export const CHARS_PER_TOKEN = 4;
export const PRUNE_SUMMARY_PREFIX = '[Histórico resumido —';

const DEFAULTS = {
  enabled: false,
  maxMessages: 48,
  maxTokens: 32_000,
  keepRecent: 14
};

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(x)));
}

/** Configuração efetiva a partir de settings.contextPruning. */
export function normalizeContextPruning(settings) {
  const raw = settings?.contextPruning;
  if (!raw?.enabled) return { ...DEFAULTS, enabled: false };
  return {
    enabled: true,
    maxMessages: clamp(raw.maxMessages ?? DEFAULTS.maxMessages, 8, 200),
    maxTokens: clamp(raw.maxTokens ?? DEFAULTS.maxTokens, 2_000, 500_000),
    keepRecent: clamp(raw.keepRecent ?? DEFAULTS.keepRecent, 2, 100)
  };
}

/** PATCH parcial de contextPruning (API de configurações). */
export function patchContextPruningSettings(prev, patch) {
  if (!patch || typeof patch !== 'object') return normalizeContextPruning({ contextPruning: prev });
  const merged = { ...DEFAULTS, ...prev, ...patch };
  if (patch.enabled === true) merged.enabled = true;
  else if (patch.enabled === false) merged.enabled = false;
  return normalizeContextPruning({ contextPruning: merged });
}

export function messageChars(m) {
  return String(m?.content || '').length;
}

export function estimateMessagesTokens(messages) {
  const chars = (messages || []).reduce((n, m) => n + messageChars(m), 0);
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export function isContextPruneSummary(m) {
  return Boolean(m?.contextPrune?.summarized)
    || (m?.role === 'system' && String(m.content || '').startsWith(PRUNE_SUMMARY_PREFIX));
}

export function contextOverThreshold(messages, cfg) {
  if (!cfg?.enabled) return false;
  const list = messages || [];
  return list.length > cfg.maxMessages || estimateMessagesTokens(list) > cfg.maxTokens;
}

function buildPruneSummary(older) {
  const removedChars = older.reduce((n, m) => n + messageChars(m), 0);
  const preview = older.slice(-10).map(m => {
    const who = m.role === 'user' ? 'Usuário' : m.role === 'assistant' ? 'Agente' : 'Sistema';
    const line = String(m.content || '').replace(/\s+/g, ' ').trim().slice(0, 140);
    return `${who}: ${line}`;
  }).join('\n');
  const head = `${PRUNE_SUMMARY_PREFIX} ${older.length} mensagens, ~${estimateMessagesTokens(older)} tokens estimados]`;
  const content = `${head}\n\nTrechos anteriores (ordem cronológica, truncados):\n${preview}`.slice(0, 14_000);
  return {
    role: 'system',
    content,
    contextPrune: {
      summarized: true,
      summarizedCount: older.length,
      summarizedChars: removedChars,
      summarizedTokens: estimateMessagesTokens(older)
    }
  };
}

/**
 * Comprime mensagens antigas em um único bloco de resumo; mantém as últimas `keepRecent` intactas.
 * Não altera o store — só a lista enviada ao provedor.
 */
export function pruneContextMessages(messages, cfgOrSettings) {
  const cfg = cfgOrSettings?.enabled !== undefined && cfgOrSettings.maxMessages != null
    ? cfgOrSettings
    : normalizeContextPruning(cfgOrSettings);
  const input = Array.isArray(messages) ? messages : [];
  if (!cfg.enabled || !contextOverThreshold(input, cfg)) {
    return {
      messages: input,
      pruned: false,
      stats: { reason: cfg.enabled ? 'under_threshold' : 'disabled' }
    };
  }

  const keep = Math.min(cfg.keepRecent, input.length);
  if (keep >= input.length) {
    return { messages: input, pruned: false, stats: { reason: 'nothing_to_drop' } };
  }

  let older = input.slice(0, input.length - keep);
  let recent = input.slice(-keep);

  if (older.length === 1 && isContextPruneSummary(older[0])) {
    return { messages: input, pruned: false, stats: { reason: 'already_pruned' } };
  }

  if (isContextPruneSummary(older[0])) {
    const prior = older[0];
    older = older.slice(1);
    if (!older.length) {
      return { messages: input, pruned: false, stats: { reason: 'already_pruned' } };
    }
    const mergedSummary = buildPruneSummary([
      { role: 'system', content: prior.content },
      ...older
    ]);
    const out = [mergedSummary, ...recent];
    return {
      messages: out,
      pruned: true,
      stats: {
        kept: recent.length,
        summarized: older.length + (prior.contextPrune?.summarizedCount || 1),
        tokensBefore: estimateMessagesTokens(input),
        tokensAfter: estimateMessagesTokens(out)
      }
    };
  }

  const summary = buildPruneSummary(older);
  const out = [summary, ...recent];
  return {
    messages: out,
    pruned: true,
    stats: {
      kept: recent.length,
      summarized: older.length,
      tokensBefore: estimateMessagesTokens(input),
      tokensAfter: estimateMessagesTokens(out)
    }
  };
}
