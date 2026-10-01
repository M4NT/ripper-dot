/**
 * Contrato HTTP unificado para uso da conta, snapshot do provedor e janela de contexto.
 * Roadmap item 8 — sem números inventados; campos ausentes ficam null / emptyLabel "sem dados".
 */
import {
  usageSummary,
  accountLimits,
  contextBreakdown
} from './usage.mjs';

export const USAGE_CONTRACT_VERSION = 1;

export function normalizeContextWindow(breakdown, { chatId } = {}) {
  const available = breakdown?.hasData === true;
  const categories = (breakdown?.categories || []).filter(c => c.id !== 'unmeasured' && !c.hint);
  return {
    contractVersion: USAGE_CONTRACT_VERSION,
    available,
    hasData: available,
    emptyLabel: available ? null : 'sem dados',
    chatId: chatId || null,
    limitTokens: breakdown?.limitTokens ?? null,
    usedTokens: breakdown?.usedTokens ?? null,
    pct: breakdown?.pct ?? null,
    categories,
    unmeasuredNote: available
      ? 'O restante da janela (até o limite do modelo) não é medido pelo Ripper.'
      : null,
    compact: breakdown?.compact ?? { messageCount: 0, canCompact: false },
    estimate: breakdown?.estimate === true,
    note: breakdown?.note || null
  };
}

export function splitAccountLimits(limits) {
  const accountUsage = {
    available: Boolean(
      limits.live?.usageEvents
      || limits.ripperQuota?.rolling5h?.configured
      || limits.ripperQuota?.weekly?.configured
      || limits.cloudCredits?.configured
      || limits.juliaRouting
    ),
    source: limits.source,
    plan: limits.plan ?? null,
    live: limits.live,
    localUsage: limits.localUsage,
    ripperQuota: limits.ripperQuota,
    cloudCredits: limits.cloudCredits,
    byModel: limits.byModel,
    juliaRouting: limits.juliaRouting,
    notes: { ripperQuota: limits.notes?.ripperQuota ?? null }
  };
  if (
    !limits.live?.usageEvents
    && !limits.ripperQuota?.rolling5h?.configured
    && !limits.ripperQuota?.weekly?.configured
    && !limits.cloudCredits?.configured
    && !limits.juliaRouting
  ) {
    accountUsage.emptyLabel = 'sem dados';
  }

  const hasProviderSignals = (limits.providers?.length || 0) > 0;
  const claude = limits.claudeSubscription;
  const providerSnapshot = {
    available: Boolean(limits.live?.providerBilling || limits.live?.providerQuotaSignals || hasProviderSignals),
    claudeSubscription: claude,
    signals: limits.providers || [],
    notes: {
      providerBilling: limits.notes?.providerBilling ?? null,
      claudeOAuth: limits.notes?.claudeOAuth ?? null
    }
  };
  if (!providerSnapshot.available && !claude?.hint && !claude?.error) {
    providerSnapshot.emptyLabel = 'sem dados';
  }

  return { accountUsage, providerSnapshot };
}

/** Payload completo para GET /api/usage e base do estado inicial. */
export function buildUsageContract(db, settings, { chatId, measures = {} } = {}) {
  const limits = accountLimits(db, settings);
  const { accountUsage, providerSnapshot } = splitAccountLimits(limits);
  const rawContext = contextBreakdown(db, settings, { chatId, measures });
  const contextWindow = normalizeContextWindow(rawContext, { chatId });
  return {
    contractVersion: USAGE_CONTRACT_VERSION,
    summary: usageSummary(db),
    accountUsage,
    providerSnapshot,
    contextWindow,
    /** Forma legada (mesmo objeto que accountLimits); preferir accountUsage + providerSnapshot. */
    limits
  };
}
