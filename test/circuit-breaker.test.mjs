import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CB_STATE,
  CircuitBreaker,
  createCircuitBreakerRegistry,
  _resetCircuitBreakersForTests
} from '../lib/circuit-breaker.mjs';
import { runProviderAttemptLoop } from '../lib/provider-turn.mjs';

test('CircuitBreaker: closed → open após N falhas', () => {
  let t = 0;
  const cb = new CircuitBreaker('claude', { failureThreshold: 3, cooldownMs: 10_000 });
  assert.equal(cb.allow(t).allowed, true);
  cb.recordFailure(t);
  cb.recordFailure(t);
  assert.equal(cb.state, CB_STATE.CLOSED);
  cb.recordFailure(t);
  assert.equal(cb.state, CB_STATE.OPEN);
  assert.equal(cb.allow(t).allowed, false);
});

test('CircuitBreaker: open → half_open após cooldown → closed no sucesso', () => {
  let t = 1000;
  const cb = new CircuitBreaker('codex', { failureThreshold: 1, cooldownMs: 500 });
  cb.recordFailure(t);
  assert.equal(cb.state, CB_STATE.OPEN);
  t += 400;
  assert.equal(cb.allow(t).allowed, false);
  t += 200;
  assert.equal(cb.allow(t).allowed, true);
  assert.equal(cb.state, CB_STATE.HALF_OPEN);
  cb.recordSuccess();
  assert.equal(cb.state, CB_STATE.CLOSED);
  assert.equal(cb.consecutiveFailures, 0);
});

test('CircuitBreaker: half_open falha reabre', () => {
  let t = 0;
  const cb = new CircuitBreaker('claude', { failureThreshold: 1, cooldownMs: 100 });
  cb.recordFailure(t);
  t += 100;
  cb.allow(t);
  assert.equal(cb.state, CB_STATE.HALF_OPEN);
  cb.recordFailure(t);
  assert.equal(cb.state, CB_STATE.OPEN);
});

test('registry snapshots expõem estado honesto', () => {
  const reg = createCircuitBreakerRegistry({
    config: { failureThreshold: 2, cooldownMs: 1000 },
    nowFn: () => 42
  });
  reg.get('claude').recordFailure(42);
  const snap = reg.snapshots().find(s => s.provider === 'claude');
  assert.equal(snap.state, CB_STATE.CLOSED);
  assert.equal(snap.consecutiveFailures, 1);
  assert.equal(snap.failureThreshold, 2);
});

test('runProviderAttemptLoop: circuit aberto pula provedor e faz fallback', async () => {
  _resetCircuitBreakersForTests();
  const reg = createCircuitBreakerRegistry({ config: { failureThreshold: 1, cooldownMs: 60_000 } });
  const cb = reg.get('claude');
  cb.recordFailure();

  const calls = [];
  const events = [];
  const result = await runProviderAttemptLoop({
    order: ['claude-sonnet-5-5', 'codex'],
    getCircuitBreaker: p => reg.get(p),
    runModel: async function* (m) {
      calls.push(m);
      if (m === 'codex') yield { text: 'ok codex' };
      else throw new Error('não deveria chamar claude');
    },
    emit: ev => events.push(ev)
  });

  assert.equal(result.ok, true);
  assert.equal(result.model, 'codex');
  assert.deepEqual(calls, ['codex']);
  assert.ok(events.some(e => e.circuitBreaker?.state === CB_STATE.OPEN));
  assert.ok(events.some(e => e.handoff === 'codex' && e.reason === 'circuit_open'));
  _resetCircuitBreakersForTests();
});

test('runProviderAttemptLoop: falhas consecutivas abrem circuit e próxima chamada falha rápido', async () => {
  _resetCircuitBreakersForTests();
  const reg = createCircuitBreakerRegistry({ config: { failureThreshold: 2, cooldownMs: 50 } });
  let now = 1_000;
  const getCircuitBreaker = p => {
    const cb = reg.get(p);
    const origAllow = cb.allow.bind(cb);
    const origRecordFailure = cb.recordFailure.bind(cb);
    const origRecordSuccess = cb.recordSuccess.bind(cb);
    cb.allow = () => origAllow(now);
    cb.recordFailure = () => origRecordFailure(now);
    cb.recordSuccess = () => origRecordSuccess();
    return cb;
  };

  for (let i = 0; i < 2; i++) {
    const r = await runProviderAttemptLoop({
      order: ['claude-sonnet-5-5'],
      retry: { maxAttempts: 1 },
      getCircuitBreaker,
      runModel: async function* () {
        throw new Error('claude down');
      }
    });
    assert.equal(r.ok, false);
  }

  assert.equal(reg.get('claude').state, CB_STATE.OPEN);
  const calls = [];
  const r3 = await runProviderAttemptLoop({
    order: ['claude-sonnet-5-5', 'codex'],
    getCircuitBreaker,
    runModel: async function* (m) {
      calls.push(m);
      yield { text: 'via codex' };
    }
  });
  assert.equal(r3.ok, true);
  assert.deepEqual(calls, ['codex']);

  now += 60;
  const r4 = await runProviderAttemptLoop({
    order: ['claude-sonnet-5-5'],
    getCircuitBreaker,
    runModel: async function* () {
      yield { text: 'probe ok' };
    }
  });
  assert.equal(r4.ok, true);
  assert.equal(reg.get('claude').state, CB_STATE.CLOSED);
  _resetCircuitBreakersForTests();
});
