import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveComputer } from '../lib/computer-mode.mjs';

test('modo sem computador quando o escolhido não está disponível', () => {
  assert.equal(effectiveComputer({ mode: 'docker' }, null), 'none');
  assert.equal(effectiveComputer({ mode: 'docker' }, '27.1'), 'docker');
  assert.equal(effectiveComputer({ mode: 'boat', boatApiKey: '' }, null, {}), 'none');
  assert.equal(effectiveComputer({ mode: 'boat' }, null, { BOAT_API_KEY: 'k' }), 'boat');
  assert.equal(effectiveComputer({ mode: 'local', allowLocalCommands: false }), 'none');
  assert.equal(effectiveComputer({ mode: 'local', allowLocalCommands: true }), 'local');
  assert.equal(effectiveComputer({ mode: 'off' }, '27.1'), 'none');
});
