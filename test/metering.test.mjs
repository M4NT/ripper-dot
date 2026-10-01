import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withUsageDataDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-metering-'));
  const prev = process.env.RIPPER_DATA;
  process.env.RIPPER_DATA = dir;
  return import('../lib/store.mjs').then(async store => {
    const { _resetUsageEventsForTests } = await import('../lib/usage-events.mjs');
    store._resetStoreForTests();
    _resetUsageEventsForTests();
    return fn(dir).finally(() => {
      store._resetStoreForTests();
      _resetUsageEventsForTests();
      process.env.RIPPER_DATA = prev;
    });
  });
}

test('buildMeteringReport agrega por dia, modelo e roteador', () =>
  withUsageDataDir(async () => {
    const { appendUsageEvent } = await import('../lib/usage-events.mjs');
    const { buildMeteringReport } = await import('../lib/metering.mjs');
    const day = Date.UTC(2026, 9, 1, 12, 0, 0);
    appendUsageEvent({ at: day, model: 'codex', charsIn: 100, charsOut: 50, routedBy: 'julia-1' });
    appendUsageEvent({ at: day + 3600_000, model: 'codex', charsIn: 20, charsOut: 10, routedBy: 'heuristic' });
    appendUsageEvent({ at: day + 86400_000, model: 'claude-sonnet-5-5', charsIn: 40, charsOut: 0, routedBy: null });

    const report = buildMeteringReport({}, {}, { since: day - 1, until: day + 2 * 86400_000 });
    assert.equal(report.hasData, true);
    assert.equal(report.totals.events, 3);
    assert.equal(report.totals.charsTotal, 100 + 50 + 20 + 10 + 40);
    assert.equal(report.tokens, null);
    assert.equal(report.byDay.length, 2);
    assert.equal(report.byModel.find(m => m.model === 'codex').events, 2);
    assert.equal(report.byAgent.find(a => a.routedBy === 'julia-1').charsIn, 100);
    assert.ok(report.byAgent.some(a => a.routedBy === null));
  }));

test('buildMeteringReport sem eventos marca sem dados', () =>
  withUsageDataDir(async () => {
    const { buildMeteringReport } = await import('../lib/metering.mjs');
    const report = buildMeteringReport({}, {});
    assert.equal(report.hasData, false);
    assert.equal(report.emptyLabel, 'sem dados');
    assert.equal(report.totals, null);
    assert.deepEqual(report.byDay, []);
  }));

test('usageEventsToCsv exporta linhas reais', () =>
  withUsageDataDir(async () => {
    const { appendUsageEvent } = await import('../lib/usage-events.mjs');
    const { usageEventsToCsv, listMeteringEvents } = await import('../lib/metering.mjs');
    const at = Date.UTC(2026, 0, 15, 8, 30, 0);
    appendUsageEvent({ at, model: 'codex', charsIn: 3, charsOut: 7, routedBy: 'julia-1' });
    const events = listMeteringEvents({ since: at - 1, until: at + 1 });
    const csv = usageEventsToCsv(events);
    assert.match(csv, /^at_iso,at_ms,model,chars_in,chars_out,routed_by/);
    assert.match(csv, /codex/);
    assert.match(csv, /julia-1/);
    assert.doesNotMatch(csv, /\$/);
  }));
