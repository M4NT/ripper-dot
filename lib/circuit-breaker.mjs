/**
 * Circuit breaker por provedor (claude / codex) — falha rápida após erros consecutivos.
 *
 * Env:
 *   RIPPER_CB_FAILURES — falhas seguidas antes de abrir (default 5)
 *   RIPPER_CB_COOLDOWN_MS — tempo em open antes de half-open (default 30000)
 */

export const CB_STATE = Object.freeze({
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half_open'
});

const KNOWN_PROVIDERS = ['claude', 'codex'];

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function readCircuitBreakerConfig() {
  return {
    failureThreshold: envInt('RIPPER_CB_FAILURES', 5),
    cooldownMs: envInt('RIPPER_CB_COOLDOWN_MS', 30_000)
  };
}

export class CircuitBreaker {
  constructor(name, config = readCircuitBreakerConfig()) {
    this.name = name;
    this.config = config;
    this.state = CB_STATE.CLOSED;
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  snapshot(now = Date.now()) {
    this._maybeHalfOpen(now);
    return {
      provider: this.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      failureThreshold: this.config.failureThreshold,
      cooldownMs: this.config.cooldownMs,
      openedAt: this.openedAt ?? undefined,
      retryAfterMs: this.state === CB_STATE.OPEN && this.openedAt != null
        ? Math.max(0, this.config.cooldownMs - (now - this.openedAt))
        : undefined
    };
  }

  _maybeHalfOpen(now) {
    if (this.state !== CB_STATE.OPEN || this.openedAt == null) return;
    if (now - this.openedAt >= this.config.cooldownMs) this.state = CB_STATE.HALF_OPEN;
  }

  /** @returns {{ allowed: boolean, probing?: boolean, retryAfterMs?: number }} */
  allow(now = Date.now()) {
    if (this.state === CB_STATE.CLOSED) return { allowed: true };
    this._maybeHalfOpen(now);
    if (this.state === CB_STATE.HALF_OPEN) return { allowed: true, probing: true };
    if (this.state === CB_STATE.OPEN) {
      return {
        allowed: false,
        retryAfterMs: Math.max(0, this.config.cooldownMs - (now - this.openedAt))
      };
    }
    return { allowed: true };
  }

  recordSuccess() {
    this.consecutiveFailures = 0;
    this.state = CB_STATE.CLOSED;
    this.openedAt = null;
  }

  recordFailure(now = Date.now()) {
    if (this.state === CB_STATE.HALF_OPEN) {
      this.consecutiveFailures += 1;
      this.state = CB_STATE.OPEN;
      this.openedAt = now;
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.config.failureThreshold) {
      this.state = CB_STATE.OPEN;
      this.openedAt = now;
    }
  }
}

const registry = new Map();

export function getProviderCircuitBreaker(provider, config) {
  if (!provider) return null;
  let cb = registry.get(provider);
  if (!cb) {
    cb = new CircuitBreaker(provider, config ?? readCircuitBreakerConfig());
    registry.set(provider, cb);
  }
  return cb;
}

export function snapshotAllProviderCircuitBreakers() {
  const config = readCircuitBreakerConfig();
  return KNOWN_PROVIDERS.map(p => getProviderCircuitBreaker(p, config).snapshot());
}

/** @param {() => number} [nowFn] — injetável em testes */
export function createCircuitBreakerRegistry({ config, nowFn } = {}) {
  const breakers = new Map();
  const now = () => (nowFn ? nowFn() : Date.now());
  return {
    get(provider) {
      if (!provider) return null;
      let cb = breakers.get(provider);
      if (!cb) {
        cb = new CircuitBreaker(provider, config ?? readCircuitBreakerConfig());
        breakers.set(provider, cb);
      }
      return cb;
    },
    snapshots() {
      return KNOWN_PROVIDERS.map(p => this.get(p).snapshot(now()));
    }
  };
}

export function _resetCircuitBreakersForTests() {
  registry.clear();
}
