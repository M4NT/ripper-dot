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
