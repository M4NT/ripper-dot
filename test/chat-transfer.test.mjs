import test from 'node:test';
import assert from 'node:assert/strict';
import { exportChatPayload, importChatPayload, CHAT_EXPORT_VERSION } from '../lib/chat-transfer.mjs';

test('export/import preserva mensagens e mede caracteres', () => {
  const chat = {
    id: 'old',
    agentId: 'a1',
    title: 'Teste',
    messages: [
      { id: 'm1', role: 'user', content: 'Olá', at: 1 },
      { id: 'm2', role: 'assistant', content: 'Oi', agentId: 'a1', at: 2 }
    ],
    createdAt: 1,
    updatedAt: 2
  };
  const payload = exportChatPayload(chat);
  assert.equal(payload.version, CHAT_EXPORT_VERSION);
  assert.equal(payload.meta.messageCount, 2);
  assert.equal(payload.meta.measuredChars, 5);

  const db = { agents: [{ id: 'a1', name: 'A' }], projects: [], chats: [] };
  const { chat: imported, warnings } = importChatPayload(db, payload, { agentId: 'a1', id: () => 'new-chat' });
  assert.equal(imported.id, 'new-chat');
  assert.equal(imported.messages.length, 2);
  assert.equal(imported.messages[1].content, 'Oi');
  assert.equal(warnings.length, 0);
});

test('import rejeita formato desconhecido', () => {
  const db = { agents: [{ id: 'a1' }], projects: [], chats: [] };
  assert.throws(() => importChatPayload(db, { format: 'other' }, { id: () => 'x' }), /ripper-chat/);
});

test('import valida agente no projeto', () => {
  const db = {
    agents: [{ id: 'a1' }, { id: 'a2' }],
    projects: [{ id: 'p1', agentIds: ['a1'] }],
    chats: []
  };
  const payload = exportChatPayload({ title: 'X', messages: [{ role: 'user', content: 'hi' }] });
  assert.throws(
    () => importChatPayload(db, payload, { agentId: 'a2', projectId: 'p1', id: () => 'c' }),
    /não pertence/
  );
});
