/**
 * Governador de orçamento de tokens (PR 59): limites configuráveis por período,
 * escopo global e por agente — somente com eventos reais em usage.sqlite.
 */
import { listUsageEventsSince } from './usage-events.mjs';
import { checkSendQuota, CHARS_PER_TOKEN } from './usage.mjs';

const MS_PER_HOUR = 3_600_000;
const DEFAULT_PERIOD_HOURS = 24;

export function tokensFromChars(chars) {
  const n = Number(chars) || 0;
  return n > 0 ? Math.ceil(n / CHARS_PER_TOKEN) : 0;
}

export function charsFromTokens(tokens) {
  const n = Math.max(0, Math.floor(Number(tokens) || 0));
  return n * CHARS_PER_TOKEN;
}

/** Normaliza configuração vinda de settings (ou PATCH). */
export function normalizeTokenBudget(raw = {}) {
  const enabled = raw.enabled === true;
  const periodHours = Math.max(1, Math.min(168, Math.floor(+raw.periodHours || DEFAULT_PERIOD_HOURS)));
  const globalMaxTokens = parseOptionalPositiveInt(raw.globalMaxTokens);
  const agents = {};
  if (raw.agents && typeof raw.agents === 'object' && !Array.isArray(raw.agents)) {
    for (const [id, row] of Object.entries(raw.agents)) {
      if (!id || typeof id !== 'string' || id.length > 80) continue;
      const maxTokens = parseOptionalPositiveInt(row?.maxTokens);
      if (maxTokens != null) agents[id] = { maxTokens };
    }
  }
  const loopRaw = raw.loopDetection && typeof raw.loopDetection === 'object' ? raw.loopDetection : {};
  const loopDetection = {
    enabled: loopRaw.enabled === true,
    sameToolThreshold: Math.max(3, Math.min(30, Math.floor(+loopRaw.sameToolThreshold || 6))),
    windowSeconds: Math.max(30, Math.min(600, Math.floor(+loopRaw.windowSeconds || 120)))
  };
  const hasLimits = globalMaxTokens != null || Object.keys(agents).length > 0;
  return {
    enabled: enabled && hasLimits,
    periodHours,
    periodMs: periodHours * MS_PER_HOUR,
    globalMaxTokens,
    agents,
    loopDetection
  };
}

function parseOptionalPositiveInt(v) {
  if (v == null || v === '') return null;
  const n = Math.floor(+v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function sumTokens(events) {
  return events.reduce((n, e) => n + tokensFromChars((e.charsIn || 0) + (e.charsOut || 0)), 0);
}

function scopeRow({ scope, agentId, limitTokens, usedTokens, periodMs, now }) {
  const pct = limitTokens > 0 ? Math.min(100, Math.round((usedTokens / limitTokens) * 100)) : null;
  const exceeded = limitTokens > 0 && usedTokens >= limitTokens;
  const resetAt = exceeded ? now + periodMs : null;
  return {
    scope,
    agentId: agentId || null,
    limitTokens,
    usedTokens,
    remainingTokens: limitTokens > 0 ? Math.max(0, limitTokens - usedTokens) : null,
    pct,
    exceeded,
    resetAt,
    resetLabel: exceeded && resetAt ? resetLabelCountdown(resetAt - now) : null
  };
}

function resetLabelCountdown(ms) {
  if (ms <= 0) return 'em breve';
  const h = Math.floor(ms / MS_PER_HOUR);
  const m = Math.floor((ms % MS_PER_HOUR) / 60_000);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `Orçamento renova em ~${d} dia(s)`;
  }
  if (h > 0) return `Orçamento renova em ${h} h ${m} min`;
  return `Orçamento renova em ${m} min`;
}

/**
 * Estado atual dos orçamentos (sem bloquear). `scopes` lista global e/ou agente.
 */
export function tokenBudgetStatus(settings, { agentId, now = Date.now() } = {}) {
  const cfg = normalizeTokenBudget(settings?.tokenBudget);
  if (!cfg.enabled) {
    return {
      enabled: false,
      ok: true,
      periodHours: cfg.periodHours,
      scopes: [],
      loopDetection: cfg.loopDetection
    };
  }
  const since = now - cfg.periodMs;
  const events = listUsageEventsSince(since);
  const scopes = [];
  if (cfg.globalMaxTokens != null) {
    scopes.push(scopeRow({
      scope: 'global',
      limitTokens: cfg.globalMaxTokens,
      usedTokens: sumTokens(events),
      periodMs: cfg.periodMs,
      now
    }));
  }
  if (agentId && cfg.agents[agentId]?.maxTokens != null) {
    const agentEvents = events.filter(e => e.agentId === agentId);
    scopes.push(scopeRow({
      scope: 'agent',
      agentId,
      limitTokens: cfg.agents[agentId].maxTokens,
      usedTokens: sumTokens(agentEvents),
      periodMs: cfg.periodMs,
      now
    }));
  }
  const exceeded = scopes.filter(s => s.exceeded);
  return {
    enabled: true,
    ok: exceeded.length === 0,
    periodHours: cfg.periodHours,
    scopes,
    exceeded,
    loopDetection: cfg.loopDetection,
    note: 'Tokens estimados a partir dos caracteres medidos nos eventos de uso do Ripper (~4 caracteres/token). Não é faturamento do provedor.'
  };
}

/** Bloqueio antes ou durante execução (soft stop usa o mesmo contrato + emit stopped). */
export function checkTokenBudget(settings, { agentId, now } = {}) {
  const status = tokenBudgetStatus(settings, { agentId, now });
  if (!status.enabled || status.ok) {
    return { blocked: false, status };
  }
  const hit = status.exceeded[0];
  const scopeLabel = hit.scope === 'agent' ? 'deste agente' : 'global';
  return {
    blocked: true,
    kind: 'token_budget',
    scope: hit.scope,
    agentId: hit.agentId,
    userMessage: `Orçamento de tokens ${scopeLabel} esgotado (${hit.usedTokens} / ${hit.limitTokens} no período de ${status.periodHours} h). ${hit.resetLabel || 'Aguarde a renovação do período.'}`,
    status
  };
}

/** Cotas Ripper (env) + governador de orçamento. */
export function checkRunBudget(db, settings, { agentId } = {}) {
  const quota = checkSendQuota(db, settings);
  if (quota.blocked) return quota;
  return checkTokenBudget(settings, { agentId });
}

/** Payload estável para API / SSE. */
export function tokenBudgetAlertFromCheck(check) {
  if (!check?.blocked || check.kind !== 'token_budget') return null;
  return {
    kind: 'token_budget',
    scope: check.scope,
    agentId: check.agentId || null,
    message: check.userMessage,
    status: check.status
  };
}

/** Heurística opcional: mesma ferramenta repetida em janela curta. */
export class ToolLoopDetector {
  constructor(tokenBudgetSettings) {
    const norm = normalizeTokenBudget(tokenBudgetSettings || {});
    this.enabled = norm.loopDetection.enabled;
    this.threshold = norm.loopDetection.sameToolThreshold;
    this.windowMs = norm.loopDetection.windowSeconds * 1000;
    this.recent = [];
  }

  /** @returns {{ loop: boolean, tool?: string, count?: number, message?: string }} */
  observe(toolName) {
    if (!this.enabled || !toolName) return { loop: false };
    const tool = String(toolName).slice(0, 120);
    const now = Date.now();
    this.recent.push({ tool, at: now });
    const cutoff = now - this.windowMs;
    this.recent = this.recent.filter(r => r.at >= cutoff);
    const same = this.recent.filter(r => r.tool === tool).length;
    if (same >= this.threshold) {
      return {
        loop: true,
        tool,
        count: same,
        message: `Possível loop de agente: ferramenta "${tool}" chamada ${same} vezes em ${Math.round(this.windowMs / 1000)} s. Execução interrompida para proteger o orçamento.`
      };
    }
    return { loop: false };
  }

  reset() {
    this.recent = [];
  }
}
