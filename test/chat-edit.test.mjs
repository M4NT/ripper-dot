import test from 'node:test';
import assert from 'node:assert/strict';
import { truncateChatFrom, findChatMatches } from '../lib/chat-edit.mjs';

const mk = () => ({ messages: [
  { id: 'a', role: 'user', content: 'Olá' }, { id: 'b', role: 'assistant', content: 'Oi! Ação feita' },
  { id: 'c', role: 'user', content: 'mais' }, { id: 'd', role: 'assistant', content: 'ok' }], run: { status: 'done' } });

test('truncateChatFrom corta a partir da mensagem do usuário', () => {
  const c = mk();
  assert.deepEqual(truncateChatFrom(c, 'c'), { ok: true, removed: 2 });
  assert.deepEqual(c.messages.map(m => m.id), ['a', 'b']);
  assert.equal(c.run, undefined);
});

test('truncateChatFrom recusa resposta, id inexistente e fluxo', () => {
  assert.equal(truncateChatFrom(mk(), 'b').ok, false);
  assert.equal(truncateChatFrom(mk(), 'zz').ok, false);
  assert.equal(truncateChatFrom({ ...mk(), flowRun: { status: 'done' } }, 'a').ok, false);
});

test('findChatMatches ignora caixa e acento', () => {
  assert.deepEqual(findChatMatches(mk().messages, 'acao'), [1]);
  assert.deepEqual(findChatMatches(mk().messages, 'O'), [0, 1, 3]);
  assert.deepEqual(findChatMatches(mk().messages, '  '), []);
});
