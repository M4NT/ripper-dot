import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withJuliaDataDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-julia-'));
  const prev = process.env.RIPPER_DATA;
  process.env.RIPPER_DATA = dir;
  return import('../lib/store.mjs').then(async store => {
    const { _resetJuliaEventsForTests } = await import('../lib/julia-events.mjs');
    const { _resetUsageEventsForTests } = await import('../lib/usage-events.mjs');
    store._resetStoreForTests();
    _resetJuliaEventsForTests();
    _resetUsageEventsForTests();
    return fn(dir).finally(() => {
      store._resetStoreForTests();
      _resetJuliaEventsForTests();
      _resetUsageEventsForTests();
      process.env.RIPPER_DATA = prev;
    });
  });
}

test('appendJuliaDecision persiste e agrega sem USD', () =>
  withJuliaDataDir(async dir => {
    const { appendJuliaDecision, juliaTelemetrySummary, countJuliaDecisions } = await import('../lib/julia-events.mjs');
    appendJuliaDecision({
      at: Date.now(),
      purpose: 'route',
      latencyMs: 40,
      optionCount: 3,
      ok: true,
      score: 0.9,
      avoidedPromptChars: 120
    });
    appendJuliaDecision({
      purpose: 'route',
      latencyMs: 80,
      optionCount: 3,
      ok: false,
      reason: 'offline',
      avoidedPromptChars: 100
    });
    assert.ok(existsSync(join(dir, 'julia.sqlite')));
    assert.equal(countJuliaDecisions(), 2);
    const s = juliaTelemetrySummary();
    assert.equal(s.decisions, 2);
    assert.equal(s.answered, 1);
    assert.equal(s.fallbacks, 1);
    assert.equal(s.fallbacksByReason.offline, 1);
    assert.equal(s.timeouts, 0);
    assert.equal(s.avoidedPromptChars.sum, 220);
    assert.equal(s.latencyMs.p50, 40);
    assert.equal(s.usdAvoidedEst, undefined);

    const { accountLimits } = await import('../lib/usage.mjs');
    const lim = accountLimits({}, {});
    assert.equal(lim.juliaRouting.decisions, 2);
    assert.equal(lim.juliaRouting.usdAvoidedEst, undefined);

    appendJuliaDecision({
      purpose: 'route',
      latencyMs: 400,
      optionCount: 3,
      ok: false,
      reason: 'choose_timeout'
    });
    assert.equal(juliaTelemetrySummary().timeouts, 1);
  }));
