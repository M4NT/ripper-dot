import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withUsageDataDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-usage-'));
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

test('recordUsage persiste em SQLite e janela 5h', () =>
  withUsageDataDir(async dir => {
    const { recordUsage, accountLimits } = await import('../lib/usage.mjs');
    const db = {};
    recordUsage(db, 'codex', { charsIn: 5000, charsOut: 1000 });
    assert.ok(existsSync(join(dir, 'usage.sqlite')));
    const lim = accountLimits(db, {});
    assert.equal(lim.localUsage.chars5h, 6000);
    assert.equal(lim.localUsage.totalRecordedEvents, 1);
  }));

test('migração importa usage.events do db.json e remove do JSON', () =>
  withUsageDataDir(async dir => {
    const legacyAt = Date.now() - 60_000;
    writeFileSync(join(dir, 'db.json'), JSON.stringify({
      schemaVersion: 2,
      settings: { name: '' },
      agents: [],
      chats: [],
      files: [],
      memories: [],
      routines: [],
      projects: [],
      artifacts: [],
      messages: [],
      approvals: [],
      skills: [],
      usage: {
        byModel: { codex: { requests: 1, charsIn: 10, charsOut: 0 } },
        events: [{ at: legacyAt, model: 'codex', charsIn: 4000, charsOut: 0, routedBy: null }],
        updatedAt: legacyAt
      }
    }));
    const store = await import('../lib/store.mjs');
    store._resetStoreForTests();
    const { _resetUsageEventsForTests } = await import('../lib/usage-events.mjs');
    _resetUsageEventsForTests();
    const db = store.load();
    const { accountLimits } = await import('../lib/usage.mjs');
    assert.equal(db.usage.events, undefined);
    const lim = accountLimits(db, {});
    assert.equal(lim.localUsage.totalRecordedEvents, 1);
    assert.equal(lim.localUsage.chars5h, 4000);
    store.flush();
    const onDisk = JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8'));
    assert.equal(onDisk.usage?.events, undefined);
  }));

test('ring buffer mantém no máximo USAGE_EVENTS_MAX eventos', () =>
  withUsageDataDir(async () => {
    const { USAGE_EVENTS_MAX, countUsageEvents } = await import('../lib/usage-events.mjs');
    const { recordUsage } = await import('../lib/usage.mjs');
    const db = {};
    for (let i = 0; i < USAGE_EVENTS_MAX + 50; i++) {
      recordUsage(db, 'codex', { charsIn: 1, charsOut: 0 });
    }
    assert.equal(countUsageEvents(), USAGE_EVENTS_MAX);
  }));

test('usage.sqlite abre com WAL e busy_timeout', () =>
  withUsageDataDir(async () => {
    const { getUsageEventsSqlitePragmas, appendUsageEvent } = await import('../lib/usage-events.mjs');
    appendUsageEvent({ at: Date.now(), model: 'codex', charsIn: 1, charsOut: 0 });
    const pragmas = getUsageEventsSqlitePragmas();
    assert.equal(pragmas.journalMode, 'wal');
    assert.equal(pragmas.synchronous, 1);
    assert.equal(pragmas.busyTimeout, 5000);
  }));

test('appendUsageEvent concorrente não corrompe nem perde além do ring', () =>
  withUsageDataDir(async () => {
    const { appendUsageEvent, countUsageEvents, listAllUsageEvents, USAGE_EVENTS_MAX } = await import('../lib/usage-events.mjs');
    const base = Date.now();
    const total = 120;
    await Promise.all(Array.from({ length: total }, (_, i) =>
      Promise.resolve().then(() =>
        appendUsageEvent({ at: base + i, model: 'codex', charsIn: i, charsOut: 0 })
      )
    ));
    const expected = Math.min(total, USAGE_EVENTS_MAX);
    assert.equal(countUsageEvents(), expected);
    const events = listAllUsageEvents();
    assert.equal(events.length, expected);
    const ids = new Set(events.map(e => e.charsIn));
    assert.equal(ids.size, expected);
  }));
