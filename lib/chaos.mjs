/**
 * Injeção opt-in de falhas/latência para testes de resiliência (desligado por padrão).
 * Config: settings.chaos e/ou RIPPER_CHAOS_* no ambiente.
 */

const DEFAULT = {
  enabled: false,
  providerFailRate: 0,
  sseDelayMs: 0,
  mcpDisconnect: false
};

/** @type {{ provider?: boolean, sse?: boolean, mcp?: boolean }} */
let oneShots = {};

function envSet(name) {
  const v = process.env[name];
  if (v == null || v === '') return undefined;
  return v;
}

function envBool(name) {
  const v = envSet(name);
  if (v === undefined) return undefined;
  return v === '1' || String(v).toLowerCase() === 'true';
}

function envNum(name) {
  const v = envSet(name);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function normalizeChaos(raw = {}) {
  const sse = +raw.sseDelayMs || 0;
  return {
    enabled: !!raw.enabled,
    providerFailRate: clamp01(+raw.providerFailRate || 0),
    sseDelayMs: Math.min(60_000, Math.max(0, sse)),
    mcpDisconnect: !!raw.mcpDisconnect
  };
}

/** Produção bloqueia chaos ativo salvo override explícito. */
export function isChaosBlockedInProduction() {
  return process.env.NODE_ENV === 'production' && process.env.RIPPER_CHAOS_ALLOW_PROD !== '1';
}

export function chaosFromEnv() {
  const out = { ...DEFAULT };
  const enabled = envBool('RIPPER_CHAOS_ENABLED');
  if (enabled !== undefined) out.enabled = enabled;
  const rate = envNum('RIPPER_CHAOS_PROVIDER_FAIL_RATE');
  if (rate !== undefined) out.providerFailRate = clamp01(rate);
  const sse = envNum('RIPPER_CHAOS_SSE_DELAY_MS');
  if (sse !== undefined) out.sseDelayMs = Math.min(60_000, Math.max(0, sse));
  const mcp = envBool('RIPPER_CHAOS_MCP_DISCONNECT');
  if (mcp !== undefined) out.mcpDisconnect = mcp;
  return out;
}

/**
 * Mescla settings.chaos com env (env sobrescreve quando definido).
 * @param {object} [settings]
 */
export function resolveEffectiveChaos(settings) {
  const merged = normalizeChaos({ ...DEFAULT, ...settings?.chaos, ...pickEnvOverrides() });
  const blocked = isChaosBlockedInProduction();
  return {
    ...merged,
    active: merged.enabled && !blocked,
    blocked,
    blockReason: blocked && merged.enabled
      ? 'Chaos desativado em NODE_ENV=production (defina RIPPER_CHAOS_ALLOW_PROD=1 para override explícito).'
      : undefined
  };
}

function pickEnvOverrides() {
  const o = {};
  const enabled = envBool('RIPPER_CHAOS_ENABLED');
  if (enabled !== undefined) o.enabled = enabled;
  const rate = envNum('RIPPER_CHAOS_PROVIDER_FAIL_RATE');
  if (rate !== undefined) o.providerFailRate = rate;
  const sse = envNum('RIPPER_CHAOS_SSE_DELAY_MS');
  if (sse !== undefined) o.sseDelayMs = sse;
  const mcp = envBool('RIPPER_CHAOS_MCP_DISCONNECT');
  if (mcp !== undefined) o.mcpDisconnect = mcp;
  return o;
}

export function chaosStatusPayload(settings) {
  const effective = resolveEffectiveChaos(settings);
  return {
    defaults: DEFAULT,
    stored: normalizeChaos(settings?.chaos || {}),
    env: chaosFromEnv(),
    effective,
    productionGuard: isChaosBlockedInProduction(),
    oneShotsPending: { ...oneShots }
  };
}

export function applyChaosPatch(s, chaos) {
  if (chaos == null || typeof chaos !== 'object') return;
  const next = normalizeChaos({ ...s.chaos, ...chaos });
  if (next.enabled && isChaosBlockedInProduction()) {
    throw new Error('Chaos não permitido em produção sem RIPPER_CHAOS_ALLOW_PROD=1.');
  }
  s.chaos = next;
}

/** Dispara um drill único na próxima ocorrência do tipo (provider | sse | mcp | all). */
export function scheduleChaosFire(kind = 'all') {
  if (isChaosBlockedInProduction()) {
    throw new Error('Chaos não permitido em produção sem RIPPER_CHAOS_ALLOW_PROD=1.');
  }
  const k = String(kind || 'all').toLowerCase();
  if (k === 'all') {
    oneShots = { provider: true, sse: true, mcp: true };
    return { scheduled: ['provider', 'sse', 'mcp'] };
  }
  if (!['provider', 'sse', 'mcp'].includes(k)) {
    throw new Error('kind deve ser provider, sse, mcp ou all.');
  }
  oneShots[k] = true;
  return { scheduled: [k] };
}

function takeOneShot(key) {
  if (!oneShots[key]) return false;
  delete oneShots[key];
  return true;
}

export function _resetChaosForTests() {
  oneShots = {};
}

function sleepMs(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(Object.assign(new Error('aborted'), { aborted: true }));
    }, { once: true });
  });
}

/**
 * @param {ReturnType<resolveEffectiveChaos>} chaos
 * @param {{ random?: () => number }} [opts]
 */
export function maybeChaosProviderFailure(chaos, opts = {}) {
  if (!chaos?.active && !oneShots.provider) return null;
  if (takeOneShot('provider')) {
    return Object.assign(new Error('chaos: falha simulada do provedor (one-shot)'), { chaos: true });
  }
  if (!chaos?.active || chaos.providerFailRate <= 0) return null;
  const rnd = opts.random ?? Math.random;
  if (rnd() < chaos.providerFailRate) {
    return Object.assign(new Error('chaos: falha simulada do provedor'), { chaos: true });
  }
  return null;
}

/** Atraso artificial antes de cada evento SSE (serializado pelo caller). */
export async function chaosSseBeforeEmit(chaos, signal) {
  const delay = takeOneShot('sse') ? Math.max(chaos?.sseDelayMs || 0, 50) : (chaos?.active ? chaos.sseDelayMs : 0);
  if (!delay) return;
  await sleepMs(delay, signal);
}

/** Erro de desconexão MCP simulada (sondas e ponte ripper). */
export function maybeChaosMcpFailure(chaos, settings) {
  const eff = chaos || resolveEffectiveChaos(settings);
  if (takeOneShot('mcp')) {
    return Object.assign(new Error('chaos: desconexão MCP simulada (one-shot)'), { chaos: true });
  }
  if (!eff?.active || !eff.mcpDisconnect) return null;
  return Object.assign(new Error('chaos: desconexão MCP simulada'), { chaos: true });
}

export function chaosDefaultsForStore() {
  return { ...DEFAULT };
}
