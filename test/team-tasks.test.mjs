import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEAM_TASK_STATUS,
  createTeamTask,
  updateTeamTask,
  listTeamTasks,
  cancelTeamTasksForChat,
  linkOrCreateTeamTaskFromInbox,
  applyInboxResultToTeamTask,
  enqueuePeerMessage,
  enqueueOwnerWake,
  teamBoardForChat,
  depsSatisfied,
  publicTeamTask
} from '../lib/team-tasks.mjs';

const id = () => crypto.randomUUID();
const C = { id: 'coord', name: 'Coordenador', status: 'online' };
const W = { id: 'wrk', name: 'Pesquisador', status: 'online' };

function freshDb() {
  return {
    agents: [C, W],
    messages: [],
    teamTasks: [],
    chats: [{ id: 'chat-1', agentId: C.id, agentIds: [C.id, W.id], title: 'Campanha' }],
    taskItems: []
  };
}

test('createTeamTask: exige título e owner; deps bloqueiam até concluir', () => {
  const db = freshDb();
  assert.match(createTeamTask(db, { ownerId: C.id }, { id }).error, /título/);
  const a = createTeamTask(db, { ownerId: C.id, title: 'Pesquisar preços', assigneeId: W.id, chatId: 'chat-1' }, { id, now: 1 });
  assert.ok(a.ok);
  assert.equal(a.task.status, TEAM_TASK_STATUS.todo);
  assert.equal(a.task.ownerId, C.id);

  const b = createTeamTask(db, {
    ownerId: C.id,
    title: 'Montar planilha',
    deps: [a.task.id],
    chatId: 'chat-1'
  }, { id, now: 2 });
  assert.ok(b.ok);
  assert.equal(b.task.status, TEAM_TASK_STATUS.blocked);
  assert.equal(depsSatisfied(db, b.task), false);

  const done = updateTeamTask(db, a.task.id, { status: 'done', result: 'Tabela pronta' }, { now: 3 });
  assert.ok(done.ok);
  assert.equal(findReloaded(db, b.task.id).status, TEAM_TASK_STATUS.todo);
});

function findReloaded(db, tid) {
  return db.teamTasks.find(t => t.id === tid);
}

test('updateTeamTask: progresso, status inválido e auto-desbloqueio', () => {
  const db = freshDb();
  const { task } = createTeamTask(db, { ownerId: C.id, title: 'X', chatId: 'chat-1' }, { id });
  assert.match(updateTeamTask(db, 'nope', { status: 'done' }).error, /não encontrada/);
  assert.match(updateTeamTask(db, task.id, { status: 'voando' }).error, /Status/);
  const u = updateTeamTask(db, task.id, { status: 'doing', progress: { percent: 40, note: 'metade' } });
  assert.equal(u.task.status, 'doing');
  assert.equal(u.task.progress.percent, 40);
});

test('inbox: liga mensagem, conclui e acorda o dono', () => {
  const db = freshDb();
  const limits = { maxPerHour: 20, maxHops: 5 };
  const queued = enqueuePeerMessage({
    db, id, from: C, to: W, body: 'Revisar o post X', originChatId: 'chat-1', hops: 0, limits, now: 10
  });
  assert.ok(queued.ok);
  const { task, created } = linkOrCreateTeamTaskFromInbox(db, queued.message, { id, ownerId: C.id, now: 10 });
  assert.equal(created, true);
  assert.equal(task.assigneeId, W.id);
  assert.equal(linkOrCreateTeamTaskFromInbox(db, queued.message, { id }).created, false);

  const closed = applyInboxResultToTeamTask(db, queued.message, 'Post revisado.', { now: 20 });
  assert.ok(closed.ok);
  assert.equal(closed.task.status, TEAM_TASK_STATUS.done);

  const wake = enqueueOwnerWake({
    db, id, from: W, to: C, task: closed.task, result: 'Post revisado.', hops: 1, limits, now: 21
  });
  assert.ok(wake.ok);
  assert.equal(wake.message.to, C.id);
  assert.equal(wake.message.priority, 'now');
  assert.match(wake.message.body, /Resultado da tarefa/);
});

test('teamBoardForChat: membros + tarefa atual', () => {
  const db = freshDb();
  createTeamTask(db, {
    ownerId: C.id, assigneeId: W.id, title: 'Buscar fontes', chatId: 'chat-1', status: 'doing'
  }, { id });
  const board = teamBoardForChat(db, db.chats[0]);
  assert.equal(board.members.length, 2);
  const wrk = board.members.find(m => m.agentId === W.id);
  assert.equal(wrk.task.title, 'Buscar fontes');
  assert.equal(board.members.find(m => m.agentId === C.id).task, null);
  assert.equal(publicTeamTask(board.tasks[0], db).assigneeName, 'Pesquisador');
});

test('cancelTeamTasksForChat só abre o que é da conversa', () => {
  const db = freshDb();
  const a = createTeamTask(db, { ownerId: C.id, title: 'A', chatId: 'chat-1', status: 'doing' }, { id }).task;
  const b = createTeamTask(db, { ownerId: C.id, title: 'B', chatId: 'other', status: 'todo' }, { id }).task;
  const cancelled = cancelTeamTasksForChat(db, 'chat-1', { now: 9, reason: 'Parou.' });
  assert.equal(cancelled.length, 1);
  assert.equal(a.status, TEAM_TASK_STATUS.cancelled);
  assert.equal(a.result, 'Parou.');
  assert.equal(b.status, TEAM_TASK_STATUS.todo);
  assert.equal(listTeamTasks(db, { chatId: 'chat-1', open: true }).length, 0);
});
