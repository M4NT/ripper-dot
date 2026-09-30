import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { routineDue, isNothingNew, routinePrompt, summarizeEvent } from '../lib/agent-flow.mjs';
import { verifySignature, eventMeta } from '../lib/hooks.mjs';

test('rotina por evento nunca dispara pelo relógio', () => {
  assert.equal(routineDue({ trigger: 'webhook', everyMinutes: 5, lastRun: 0 }, new Date()), false);
});

test('NADA_NOVO silencia; resposta de verdade não', () => {
  assert.equal(isNothingNew('NADA_NOVO'), true);
  assert.equal(isNothingNew(' nada novo. '), true);
  assert.equal(isNothingNew('Nada novo no front, mas o PR #12 quebrou o build.'), false);
});

test('prompt da rotina inclui o evento e a regra de silêncio', () => {
  const p = routinePrompt({ prompt: 'Revise o PR.' }, { source: 'GitHub', type: 'pull_request', body: '{"n":1}' });
  assert.match(p, /Revise o PR/); assert.match(p, /GitHub, pull_request/); assert.match(p, /NADA_NOVO/);
  assert.doesNotMatch(routinePrompt({ prompt: 'x', quiet: false }), /NADA_NOVO/);
});

test('evento grande é cortado', () => {
  assert.ok(summarizeEvent(JSON.stringify({ a: 'x'.repeat(10000) })).length < 4100);
});

test('assinatura do GitHub é verificada', () => {
  const body = '{"ok":true}', secret = 's3gr3do';
  const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifySignature(secret, body, sig), true);
  assert.equal(verifySignature(secret, body, 'sha256=errado'), false);
  assert.equal(verifySignature(secret, body, undefined), false);
  assert.equal(verifySignature('', body, undefined), true);
  assert.deepEqual(eventMeta({ 'x-github-event': 'push' }), { source: 'GitHub', type: 'push' });
});
