import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAgentStyle, agentStyleBlock, sanitizeStyleFields } from '../lib/agent-style.mjs';
import { systemPrompt } from '../lib/providers.mjs';

test('resolveAgentStyle herda defaults quando agente não tem style', () => {
  const agent = { tone: 'amigavel' };
  const settings = { defaults: { agentStyle: { formality: 'informal', customHints: 'Use «você».' } } };
  const s = resolveAgentStyle(agent, settings);
  assert.equal(s.tone, 'amigavel');
  assert.equal(s.formality, 'informal');
  assert.equal(s.customHints, 'Use «você».');
});

test('agentStyleBlock inclui tom, formalidade e limite de frases', () => {
  const block = agentStyleBlock({ tone: 'tecnico', formality: 'formal', maxSentences: 2, language: 'pt-BR', customHints: 'Sem emojis.' });
  assert.match(block, /## Voz e estilo/);
  assert.match(block, /técnico/i);
  assert.match(block, /até 2 frases/);
  assert.match(block, /pt-BR/);
  assert.match(block, /Sem emojis/);
});

test('systemPrompt injeta bloco de voz do agente', () => {
  const agent = {
    name: 'Teste',
    description: 'x',
    tone: 'direto',
    style: { tone: 'formal', formality: 'formal', customHints: 'Assine com — Equipe.' },
    tools: [],
    instructions: 'Faça Y.'
  };
  const sys = systemPrompt(agent, { defaults: { agentStyle: {} } }, []);
  assert.match(sys, /## Voz e estilo/);
  assert.match(sys, /Assine com — Equipe/);
  assert.match(sys, /Faça Y/);
  assert.doesNotMatch(sys, /Tom direto e objetivo/);
});

test('sanitizeStyleFields limita campos', () => {
  const s = sanitizeStyleFields({
    tone: 'nope',
    formality: 'neutro',
    maxSentences: 99,
    language: 'x'.repeat(50),
    customHints: 'ok'
  }, {});
  assert.equal(s.tone, undefined);
  assert.equal(s.formality, 'neutro');
  assert.equal(s.maxSentences, 20);
  assert.equal(s.language.length, 40);
  assert.equal(s.customHints, 'ok');
});
