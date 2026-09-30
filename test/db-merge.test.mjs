import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeIdCollection, mergeUsageByModel } from '../lib/db-merge.mjs';

test('mergeIdCollection mantém o registro mais recente por id', () => {
  const disk = [{ id: 'a', name: 'velho', updatedAt: 10 }];
  const local = [{ id: 'a', name: 'novo', updatedAt: 20 }];
  const out = mergeIdCollection(disk, local);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'novo');
});

test('mergeUsageByModel soma deltas locais sem duplicar baseline', () => {
  const disk = { byModel: { codex: { requests: 5, charsIn: 100, charsOut: 0 } } };
  const local = { byModel: { codex: { requests: 8, charsIn: 160, charsOut: 10 } } };
  const baseline = { codex: { requests: 5, charsIn: 100, charsOut: 0 } };
  const merged = mergeUsageByModel(disk, local, baseline);
  assert.equal(merged.byModel.codex.requests, 8);
  assert.equal(merged.byModel.codex.charsIn, 160);
  assert.equal(merged.byModel.codex.charsOut, 10);
});
