import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTaskResult,
  runTaskClosure,
  closeTaskFromInboxReply,
  CLOSURE_OUTCOME
} from '../lib/task-closure.mjs';
import { TASK_STATUS, trackInboxDelegation } from '../lib/task-items.mjs';
import { createGoogleTasksSync } from '../lib/google-tasks-sync.mjs';

const limits = { maxPerHour: 20, maxHops: 5 };
const id = () => crypto.randomUUID();

const R = { id: 'req', name: 'Solicitante', status: 'online' };
const W = { id: 'wrk', name: 'Executor', status: 'online' };

function freshDb() {
  return { agents: [R, W], messages: [], taskItems: [] };
}

test('validateTaskResult: aceita texto útil e rejeita vazio, PASSO e erro', () => {
  assert.ok(validateTaskResult('Relatório revisado.').ok);
  assert.equal(validateTaskResult('').error, 'Resposta vazia.');
  assert.match(validateTaskResult('PASSO').error, /PASSO/);
  assert.match(validateTaskResult('Erro: timeout').error, /erro/i);
});

test('happy path: completar, confirmar na inbox e arquivar', async () => {
  const db = freshDb();
  const inbox = {
    id: 'msg-1',
    from: R.id,
    to: W.id,
    body: 'Revisar o post X',
    originChatId: 'chat-1',
    status: 'delivered'
  };
  const { task } = trackInboxDelegation(db, inbox, { id, now: 1000 });
  assert.equal(task.status, TASK_STATUS.open);

  const archivedCalls = [];
  const hook = createGoogleTasksSync({
    enabled: true,
    sync: { onTaskArchived: t => archivedCalls.push(t.id) }
  });

  const out = await runTaskClosure({
    db,
    taskId: task.id,
    result: 'Post revisado e aprovado.',
    id,
    limits,
    hops: 0,
    now: 2000,
    googleTasksSync: hook
  });

  assert.ok(out.ok);
  assert.equal(out.outcome, CLOSURE_OUTCOME.closed);
  assert.equal(out.task.status, TASK_STATUS.archived);
  assert.ok(out.task.archivedAt);
  assert.equal(db.messages.length, 1);
  assert.equal(db.messages[0].from, W.id);
  assert.equal(db.messages[0].to, R.id);
  assert.match(db.messages[0].body, /Tarefa concluída/);
  assert.deepEqual(archivedCalls, [task.id]);
});

test('já arquivada: idempotente', async () => {
  const db = freshDb();
  const inbox = { id: 'msg-2', from: R.id, to: W.id, body: 'Tarefa', originChatId: 'c' };
  const { task } = trackInboxDelegation(db, inbox, { id });
  task.status = TASK_STATUS.archived;
  task.archivedAt = 1;

  const out = await runTaskClosure({
    db,
    taskId: task.id,
    result: 'Qualquer coisa',
    id,
    limits,
    skipInbox: true
  });

  assert.ok(out.ok);
  assert.ok(out.idempotent);
  assert.equal(out.outcome, CLOSURE_OUTCOME.alreadyArchived);
  assert.equal(db.messages.length, 0);
});

test('falha de validação: marca failed e avisa solicitante', async () => {
  const db = freshDb();
  const inbox = { id: 'msg-3', from: R.id, to: W.id, body: 'Calcular KPI', originChatId: 'c2' };
  const { task } = trackInboxDelegation(db, inbox, { id });

  const out = await runTaskClosure({
    db,
    taskId: task.id,
    result: '',
    id,
    limits,
    hops: 0
  });

  assert.equal(out.ok, false);
  assert.equal(out.outcome, CLOSURE_OUTCOME.validationFailed);
  assert.equal(out.task.status, TASK_STATUS.failed);
  assert.equal(db.messages.length, 1);
  assert.match(db.messages[0].body, /não validada/i);
});

test('closeTaskFromInboxReply integra mensagem entregue', async () => {
  const db = freshDb();
  const inbox = { id: 'msg-4', from: R.id, to: W.id, body: 'Resumir doc', originChatId: 'c3', status: 'delivered' };
  trackInboxDelegation(db, inbox, { id });

  const out = await closeTaskFromInboxReply({
    db,
    inboxMessage: inbox,
    replyText: 'Resumo: três pontos principais.',
    id,
    limits,
    skipInbox: true
  });

  assert.ok(out.ok);
  assert.equal(out.task.status, TASK_STATUS.archived);
});
