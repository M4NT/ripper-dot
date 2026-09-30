import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureUsage, recordUsage, usageSummary } from '../lib/usage.mjs';

test('recordUsage acumula por modelo', () => {
  const db = {};
  recordUsage(db, 'claude-sonnet-5-5', { charsIn: 100, charsOut: 50 });
  recordUsage(db, 'claude-sonnet-5-5', { charsIn: 20, charsOut: 10 });
  const s = usageSummary(db);
  assert.equal(s.byModel['claude-sonnet-5-5'].requests, 2);
  assert.equal(s.byModel['claude-sonnet-5-5'].charsIn, 120);
  assert.equal(ensureUsage(db).updatedAt, s.updatedAt);
});
