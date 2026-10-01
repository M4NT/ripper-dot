import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeContextPruning,
  patchContextPruningSettings,
  pruneContextMessages,
  estimateMessagesTokens,
  isContextPruneSummary
} from '../lib/context-pruning.mjs';

const cfg = { enabled: true, maxMessages: 20, maxTokens: 500, keepRecent: 6 };

test('abaixo do limite não altera mensagens (no-op)', () => {
  const messages = Array.from({ length: 10 }, (_, i) => ({ role: 'user', content: `m${i}` }));
  const r = pruneContextMessages(messages, cfg);
  assert.equal(r.pruned, false);
  assert.equal(r.stats.reason, 'under_threshold');
  assert.deepEqual(r.messages, messages);
});

test('desligado não poda', () => {
  const messages = Array.from({ length: 50 }, (_, i) => ({ role: 'user', content: 'x'.repeat(200) }));
  const r = pruneContextMessages(messages, { contextPruning: { enabled: false } });
  assert.equal(r.pruned, false);
  assert.equal(r.messages.length, 50);
});

test('acima do limite resume antigas e mantém recentes', () => {
  const messages = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: `msg-${i}-${'a'.repeat(80)}`
  }));
  const r = pruneContextMessages(messages, cfg);
  assert.equal(r.pruned, true);
  assert.equal(r.messages.length, 7);
  assert.ok(isContextPruneSummary(r.messages[0]));
  assert.equal(r.messages.at(-1).content, messages.at(-1).content);
  assert.ok(estimateMessagesTokens(r.messages) < estimateMessagesTokens(messages));
});

test('idempotência: segunda poda não muda o resultado', () => {
  const messages = Array.from({ length: 40 }, (_, i) => ({ role: 'user', content: `linha ${i} ${'z'.repeat(120)}` }));
  const first = pruneContextMessages(messages, cfg);
  assert.equal(first.pruned, true);
  const second = pruneContextMessages(first.messages, cfg);
  assert.equal(second.pruned, false);
  assert.deepEqual(second.messages, first.messages);
});

test('patchContextPruningSettings valida limites', () => {
  const s = patchContextPruningSettings({}, { enabled: true, maxMessages: 9999, maxTokens: 1, keepRecent: 1 });
  assert.equal(s.enabled, true);
  assert.equal(s.maxMessages, 200);
  assert.equal(s.maxTokens, 2000);
  assert.equal(s.keepRecent, 2);
});

test('normalizeContextPruning padrão desligado', () => {
  assert.equal(normalizeContextPruning({}).enabled, false);
});
