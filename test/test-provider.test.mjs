import test from 'node:test';
import assert from 'node:assert/strict';
import { runTestProvider, testProviderScenario, stripTestDirective } from '../lib/test-provider.mjs';

test('testProviderScenario lê diretiva no prompt', () => {
  assert.equal(testProviderScenario('[[ripper:test:fail]] oi'), 'fail');
  assert.equal(stripTestDirective('[[ripper:test:fail]] oi'), 'oi');
});

test('runTestProvider stream divide o texto', async () => {
  const prev = process.env.RIPPER_TEST_PROVIDER;
  process.env.RIPPER_TEST_PROVIDER = 'stream';
  const parts = [];
  for await (const ev of runTestProvider({ prompt: 'abcd' })) parts.push(ev.text);
  process.env.RIPPER_TEST_PROVIDER = prev;
  assert.equal(parts.join(''), 'abcd');
});
