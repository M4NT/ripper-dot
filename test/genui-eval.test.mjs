import test from 'node:test';
import assert from 'node:assert/strict';
import { GENUI_NAMES } from '../lib/genui-catalog.mjs';
import {
  GENUI_LABELED_PROMPTS,
  suggestComponent,
  evaluateLabeledPrompts,
  evaluateExampleSchemas,
  evaluateReply
} from '../lib/genui-eval.mjs';

test('conjunto rotulado cobre ~50 prompts e todos os componentes + none', () => {
  assert.ok(GENUI_LABELED_PROMPTS.length >= 50, GENUI_LABELED_PROMPTS.length);
  const expects = new Set(GENUI_LABELED_PROMPTS.map(c => c.expect));
  for (const name of GENUI_NAMES) assert.ok(expects.has(name), name);
  assert.ok(expects.has('none'));
});

test('régua de escolha acerta o conjunto rotulado', () => {
  const r = evaluateLabeledPrompts();
  assert.equal(r.total, GENUI_LABELED_PROMPTS.length);
  assert.deepEqual(r.misses, [], r.misses.map(m => `${m.id}: ${m.expect}≠${m.got}`).join('; '));
  assert.equal(r.accuracy, 1);
});

test('exemplos do catálogo passam no schema e têm fallback em texto', () => {
  const r = evaluateExampleSchemas();
  assert.equal(r.valid, r.total);
  assert.ok(r.results.every(x => x.ok && x.hasText && !x.tableAbuse));
});

test('evaluateReply marca tabela markdown quando o componente era outro', () => {
  const table = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |';
  const abuse = evaluateReply(table, 'question');
  assert.equal(abuse.markdownTableWhenComponent, true);
  assert.equal(evaluateReply('só texto', 'none').abuse, false);
  assert.equal(suggestComponent(''), 'none');
  assert.equal(suggestComponent('Oi, tudo bem?'), 'none');
});
