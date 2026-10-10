import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelCascade,
  cascadeTouched,
  registerDeliveryAbort,
  unregisterDeliveryAbort,
  _resetDeliveryAbortForTests,
  childChatIdsOf
} from '../lib/cascade-stop.mjs';
import { createTeamTask, TEAM_TASK_STATUS } from '../lib/team-tasks.mjs';
import { createIsolatedChildChat, descendantChatIds } from '../lib/team-subagent.mjs';

const id = () => crypto.randomUUID();

test('cancelCascade: para stream, cancela inbox e tarefas, aborta entregas', () => {
  _resetDeliveryAbortForTests();
  const db = {
    chats: [
      { id: 'p', agentId: 'a' },
      { id: 'child', agentId: 'a', parentChatId: 'p' }
    ],
    messages: [
      { id: 'm1', originChatId: 'p', status: 'queued', to: 'b' },
      { id: 'm2', originChatId: 'p', status: 'delivering', threadChatId: 'thr', to: 'c' },
      { id: 'm3', originChatId: 'other', status: 'queued' }
    ],
    teamTasks: []
  };
  createTeamTask(db, { ownerId: 'a', title: 'X', chatId: 'p', status: 'doing', childChatId: 'child' }, { id });

  const cancelledStreams = [];
  const ac = registerDeliveryAbort('m2', { originChatId: 'p', childChatId: 'thr' });
  const out = cancelCascade({
    chatId: 'p',
    db,
    cancelChatStream: cid => { cancelledStreams.push(cid); return true; },
    now: 50,
    reason: 'Parou.'
  });

  assert.ok(cascadeTouched(out));
  assert.ok(cancelledStreams.includes('p'));
  assert.ok(cancelledStreams.includes('child'));
  assert.equal(db.messages.find(m => m.id === 'm1').status, 'failed');
  assert.equal(db.messages.find(m => m.id === 'm2').error, 'Parou.');
  assert.equal(db.messages.find(m => m.id === 'm3').status, 'queued');
  assert.equal(db.teamTasks[0].status, TEAM_TASK_STATUS.cancelled);
  assert.equal(ac.signal.aborted, true);
  unregisterDeliveryAbort('m2');
  _resetDeliveryAbortForTests();
});

test('cancelCascade sem nada aberto não toca', () => {
  const db = { chats: [{ id: 'z' }], messages: [], teamTasks: [] };
  const out = cancelCascade({ chatId: 'z', db, cancelChatStream: () => false });
  assert.equal(cascadeTouched(out), false);
});

test('subagente isolado: filho com histórico vazio e descendentes', () => {
  const db = { chats: [] };
  const parent = { id: 'orig', title: 'Conversa', agentId: 'a' };
  const agent = { id: 'a', name: 'Ana' };
  const { child } = createIsolatedChildChat({ db, id, parentChat: parent, agent, title: 'Resumir' });
  assert.equal(child.parentChatId, 'orig');
  assert.equal(child.isolated, true);
  assert.deepEqual(child.messages, []);
  assert.deepEqual(descendantChatIds(db, 'orig'), [child.id]);
  assert.deepEqual(childChatIdsOf(db, 'orig'), [child.id]);
});
