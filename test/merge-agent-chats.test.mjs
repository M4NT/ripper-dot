import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAgentChats } from '../lib/merge-agent-chats.mjs';

test('junta as conversas 1:1 do agente na mais recente, em ordem, sem apagar', () => {
  const db = {
    chats: [
      { id: 'a', agentId: 'x', createdAt: 1, updatedAt: 10, messages: [{ id: '1', at: 1 }, { id: '2', at: 5 }] },
      { id: 'b', agentId: 'x', createdAt: 3, updatedAt: 20, messages: [{ id: '3', at: 3 }, { id: '4', at: 20 }] },
      { id: 'g', agentId: 'x', agentIds: ['x', 'y'], updatedAt: 30, messages: [] },
      { id: 'w', agentId: 'x', channelKey: 'wa:1', updatedAt: 40, messages: [] },
      { id: 'y1', agentId: 'y', updatedAt: 5, messages: [] }
    ],
    artifacts: [{ id: 'art', chatId: 'a' }],
    files: []
  };
  assert.equal(mergeAgentChats(db), 1);
  const b = db.chats.find(c => c.id === 'b'), a = db.chats.find(c => c.id === 'a');
  assert.deepEqual(b.messages.map(m => m.id), ['1', '3', '2', '4']);
  assert.equal(b.createdAt, 1);
  assert.equal(a.archived, true); assert.equal(a.mergedInto, 'b');
  assert.equal(db.artifacts[0].chatId, 'b');
  assert.ok(!db.chats.find(c => c.id === 'g').archived, 'grupo fica');
  assert.ok(!db.chats.find(c => c.id === 'w').archived, 'canal fica');
  assert.equal(mergeAgentChats(db), 0, 'idempotente');
});
