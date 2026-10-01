import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

async function withDataDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-ret-'));
  const prev = process.env.RIPPER_DATA;
  process.env.RIPPER_DATA = dir;
  const { _resetStoreForTests } = await import('../lib/store.mjs');
  try {
    await fn(dir);
  } finally {
    _resetStoreForTests();
    process.env.RIPPER_DATA = prev;
  }
}

test('summarizeLocalData reporta RIPPER_DATA e contagens', () =>
  withDataDir(async dir => {
    writeFileSync(join(dir, 'db.json'), '{}');
    const { summarizeLocalData } = await import('../lib/data-retention.mjs');
    const { appendUsageEvent } = await import('../lib/usage-events.mjs');
    appendUsageEvent({ at: Date.now(), model: 'test', charsIn: 1, charsOut: 2 });
    const s = summarizeLocalData();
    assert.equal(s.ripperData, dir);
    assert.equal(s.fromEnv, true);
    assert.equal(s.usageEventCount, 1);
    assert.ok(s.files.some(f => f.name === 'usage.sqlite'));
  }));

test('clearUsageEventsStore remove eventos', () =>
  withDataDir(async () => {
    const { appendUsageEvent, countUsageEvents } = await import('../lib/usage-events.mjs');
    const { clearUsageEventsStore } = await import('../lib/data-retention.mjs');
    appendUsageEvent({ at: Date.now(), model: 'a', charsIn: 0, charsOut: 0 });
    assert.equal(countUsageEvents(), 1);
    const r = clearUsageEventsStore();
    assert.equal(r.remaining, 0);
    assert.equal(countUsageEvents(), 0);
  }));

test('clearJuliaEventsStore remove decisões', () =>
  withDataDir(async () => {
    const { appendJuliaDecision, countJuliaDecisions } = await import('../lib/julia-events.mjs');
    const { clearJuliaEventsStore } = await import('../lib/data-retention.mjs');
    appendJuliaDecision({
      at: Date.now(),
      purpose: 'route',
      latencyMs: 10,
      optionCount: 2,
      ok: true
    });
    assert.equal(countJuliaDecisions(), 1);
    const r = clearJuliaEventsStore();
    assert.equal(r.remaining, 0);
    assert.equal(countJuliaDecisions(), 0);
  }));

test('clear-* exige --confirm no CLI', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = fileURLToPath(new URL('../scripts/ripper-data.mjs', import.meta.url));
  const noConfirm = spawnSync(process.execPath, [script, 'clear-usage'], { encoding: 'utf8' });
  assert.notEqual(noConfirm.status, 0);
  assert.match(noConfirm.stderr, /--confirm/);
});
