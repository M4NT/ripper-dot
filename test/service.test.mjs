import test from 'node:test';
import assert from 'node:assert/strict';
import { nextDelay } from '../scripts/service.mjs';

test('vigia: espera dobra até 1 min e zera se ficou de pé', () => {
  assert.equal(nextDelay(0, 100), 1000);
  assert.equal(nextDelay(1000, 100), 2000);
  assert.equal(nextDelay(60_000, 100), 60_000);
  assert.equal(nextDelay(60_000, 10 * 60_000), 1000);
});
