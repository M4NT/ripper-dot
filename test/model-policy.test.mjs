import test from 'node:test';
import assert from 'node:assert/strict';
import { enabledModels, clampEffort, maxEffortFor, normalizeModelPolicy, route } from '../lib/router.mjs';

// Julia fora do ar (heurística) e sem cascata, para testar só a política.
const s = (models, extra = {}) => ({ models, julia: { url: 'http://127.0.0.1:1', cascade: { enabled: false } }, ...extra });

test('só modelos liberados entram na escolha', () => {
  assert.deepEqual(enabledModels(s({ enabled: { codex: false, 'claude-fable-5-1': false } })), ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5']);
  assert.equal(enabledModels(s({})).length, 5);
});

test('esforço nunca passa do teto do modelo', () => {
  const st = s({ maxEffort: { 'claude-opus-5-5': 'medium' } });
  assert.equal(maxEffortFor(st, 'claude-opus-5-5'), 'medium');
  assert.equal(clampEffort(st, 'claude-opus-5-5', 'max'), 'medium');
  assert.equal(clampEffort(st, 'claude-opus-5-5', 'low'), 'low');
  assert.equal(clampEffort(st, 'claude-opus-5-5', 'auto'), 'medium');
  assert.equal(clampEffort(st, 'claude-sonnet-5-5', 'auto'), 'auto'); // sem teto: provedor decide
});

test('normalizeModelPolicy descarta lixo e nunca desliga tudo', () => {
  const n = normalizeModelPolicy({ enabled: { x: true, codex: 'sim', 'claude-opus-5-5': false }, maxEffort: { 'claude-opus-5-5': 'ultra', codex: 'low' } });
  assert.deepEqual(n, { enabled: { 'claude-opus-5-5': false }, maxEffort: { codex: 'low' } });
  const all = normalizeModelPolicy({ enabled: { 'claude-sonnet-5-5': false, 'claude-opus-5-5': false, 'claude-fable-5-1': false, codex: false } });
  assert.ok(enabledModels({ models: all }).length >= 1);
});

test('Auto não escolhe modelo desligado e respeita o teto', async () => {
  const st = s({ enabled: { codex: false }, maxEffort: { 'claude-opus-5-5': 'medium' } });
  const code = await route('corrija este bug no script npm', [], st, { effort: 'auto' });
  assert.notEqual(code.model, 'codex');
  const hard = await route('planeje a arquitetura e analise os riscos', [], st, { effort: 'auto' });
  assert.equal(hard.model, 'claude-opus-5-5');
  assert.ok(['low', 'medium'].includes(hard.effort));
  const only = await route('oi', [], s({ enabled: { 'claude-opus-5-5': false, 'claude-fable-5-1': false, 'claude-haiku-5-5': false, codex: false } }), { effort: 'auto' });
  assert.equal(only.model, 'claude-sonnet-5-5');
});

test('correção repetida em pedidos parecidos vence a classificação', async () => {
  const { learnedModel } = await import('../lib/router.mjs');
  const corr = [
    { ask: 'revise este contrato de prestação de serviço', from: 'claude-sonnet-5-5', to: 'claude-opus-5-5' },
    { ask: 'revise a cláusula do contrato de prestação', from: 'claude-sonnet-5-5', to: 'claude-opus-5-5' }
  ];
  const all = ['claude-sonnet-5-5', 'claude-opus-5-5'];
  assert.equal(learnedModel('revise o aditivo do contrato de prestação', corr, all), 'claude-opus-5-5');
  assert.equal(learnedModel('qual a previsão do tempo hoje', corr, all), null);           // pedido diferente
  assert.equal(learnedModel('revise o contrato de prestação', corr.slice(0, 1), all), null); // uma correção só não basta
  assert.equal(learnedModel('revise o contrato de prestação', corr, ['claude-sonnet-5-5']), null); // modelo desligado
  const pick = await route('revise o aditivo do contrato de prestação', [], s({}), { effort: 'low', corrections: corr });
  assert.deepEqual([pick.model, pick.by], ['claude-opus-5-5', 'learned']);
});
