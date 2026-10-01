import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  USAGE_CONTRACT_VERSION,
  buildUsageContract,
  normalizeContextWindow,
  splitAccountLimits
} from '../lib/usage-api.mjs';
import { accountLimits, contextBreakdown } from '../lib/usage.mjs';

test('buildUsageContract expõe accountUsage, providerSnapshot e contextWindow', () => {
  const db = { chats: [], agents: [], skills: [], memories: [], settings: { plugins: [] } };
  const bundle = buildUsageContract(db, db.settings);
  assert.equal(bundle.contractVersion, USAGE_CONTRACT_VERSION);
  assert.ok(bundle.accountUsage);
  assert.ok(bundle.providerSnapshot);
  assert.ok(bundle.contextWindow);
  assert.equal(bundle.contextWindow.available, false);
  assert.equal(bundle.contextWindow.emptyLabel, 'sem dados');
  assert.ok(bundle.limits);
});

test('normalizeContextWindow não inclui faixa unmeasured inventada', () => {
  const raw = contextBreakdown(
    { chats: [{ id: 'c1', messages: [{ role: 'user', content: 'teste' }] }] },
    {},
    { chatId: 'c1', measures: {} }
  );
  const norm = normalizeContextWindow(raw, { chatId: 'c1' });
  assert.equal(norm.available, true);
  assert.equal(norm.categories.some(c => c.id === 'unmeasured'), false);
  assert.ok(norm.unmeasuredNote);
});

test('splitAccountLimits marca emptyLabel sem eventos locais', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'ripper-usage-api-'));
  const prev = process.env.RIPPER_DATA;
  process.env.RIPPER_DATA = dir;
  const store = await import('../lib/store.mjs');
  const { _resetJuliaEventsForTests } = await import('../lib/julia-events.mjs');
  const { _resetUsageEventsForTests } = await import('../lib/usage-events.mjs');
  store._resetStoreForTests();
  _resetJuliaEventsForTests();
  _resetUsageEventsForTests();
  const lim = accountLimits({}, {});
  const { accountUsage, providerSnapshot } = splitAccountLimits(lim);
  assert.equal(accountUsage.emptyLabel, 'sem dados');
  assert.equal(accountUsage.localUsage.totalRecordedEvents, 0);
  assert.equal(providerSnapshot.claudeSubscription.mode, 'subscription');
  store._resetStoreForTests();
  _resetJuliaEventsForTests();
  _resetUsageEventsForTests();
  process.env.RIPPER_DATA = prev;
});

test('rolling5h sem uso não inventa resetLabel', () => {
  const prev = process.env.RIPPER_LIMIT_5H_CHARS;
  process.env.RIPPER_LIMIT_5H_CHARS = '100000';
  const lim = accountLimits({}, {});
  assert.equal(lim.ripperQuota.rolling5h.resetAt, null);
  assert.equal(lim.ripperQuota.rolling5h.resetLabel, null);
  process.env.RIPPER_LIMIT_5H_CHARS = prev;
});
