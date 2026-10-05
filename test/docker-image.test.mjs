import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickOutdated, IMAGE } from '../lib/docker.mjs';

test('pickOutdated: tag legada mais nova só quando falta a atual', () => {
  assert.equal(pickOutdated(['ripper-agent:1', 'ripper-agent:2', '']), 'ripper-agent:2');
  assert.equal(pickOutdated(['ripper-agent:1']), 'ripper-agent:1');
  assert.equal(pickOutdated(['ripper-agent:2', IMAGE]), null);
  assert.equal(pickOutdated(['node:22-bookworm', 'outra:latest']), null);
  assert.equal(pickOutdated([]), null);
});
