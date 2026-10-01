import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MESSAGE_KIND,
  DELEGATION_STATUS,
  delegateTask,
  workerProtocolEvent,
  applyProtocolEvent,
  parseProtocolBody,
  shapeReject,
  delegationsSummary,
  ingestWorkerInboxReply
} from '../lib/manager-worker-protocol.mjs';

const limits = { maxPerHour: 20, maxHops: 5 };
const id = () => crypto.randomUUID();

const M = { id: 'mgr', name: 'Gerente', status: 'online' };
const W = { id: 'wrk', name: 'Operador', status: 'online' };

function freshDb() {
  return { agents: [M, W], messages: [], delegations: [] };
}

test('formas de mensagem: delegate → accept → progress → complete', () => {
  const db = freshDb();
  const out = delegateTask({
    db,
    id,
    manager: M,
    worker: W,
    title: 'Revisar relatório',
    description: 'Conferir números do Q3.',
    originChatId: 'chat-1',
    hops: 0,
    limits,
    now: 1000
  });
  assert.ok(out.ok);
  assert.equal(out.delegation.status, DELEGATION_STATUS.pending);
  assert.equal(out.message.protocol.kind, MESSAGE_KIND.delegate);
  assert.match(out.message.body, /manager-worker/);

  let step = workerProtocolEvent({
    db,
    id,
    worker: W,
    delegationId: out.delegation.id,
    kind: MESSAGE_KIND.accept,
    payload: { note: 'Começando.' },
    hops: 1,
    limits,
    now: 2000
  });
  assert.ok(step.ok);
  assert.equal(step.delegation.status, DELEGATION_STATUS.active);
  assert.equal(step.notifyMessage.to, M.id);

  step = workerProtocolEvent({
    db,
    id,
    worker: W,
    delegationId: out.delegation.id,
    kind: MESSAGE_KIND.progress,
    payload: { percent: 50, note: 'Metade.' },
    hops: 2,
    limits,
    now: 3000
  });
  assert.ok(step.ok);
  assert.equal(step.delegation.progress.percent, 50);

  step = workerProtocolEvent({
    db,
    id,
    worker: W,
    delegationId: out.delegation.id,
    kind: MESSAGE_KIND.complete,
    payload: { result: 'Relatório ok.' },
    hops: 3,
    limits,
    now: 4000
  });
  assert.ok(step.ok);
  assert.equal(step.delegation.status, DELEGATION_STATUS.completed);
  assert.equal(step.delegation.result, 'Relatório ok.');
  assert.equal(db.messages.length, 4); // delegate + accept + progress + complete notifies
});

test('worker rejeita delegação e manager recebe notify', () => {
  const db = freshDb();
  const { delegation } = delegateTask({
    db,
    id,
    manager: M,
    worker: W,
    title: 'Tarefa impossível',
    description: 'Sem acesso.',
    limits,
    hops: 0
  });
  const rejectEnv = shapeReject({ delegationId: delegation.id, reason: 'Fora do meu escopo.' });
  assert.ok(rejectEnv.ok);

  const res = workerProtocolEvent({
    db,
    id,
    worker: W,
    delegationId: delegation.id,
    kind: MESSAGE_KIND.reject,
    payload: { reason: 'Fora do meu escopo.' },
    limits,
    hops: 1
  });
  assert.ok(res.ok);
  assert.equal(res.delegation.status, DELEGATION_STATUS.rejected);
  assert.match(res.notifyMessage.body, /reject/);
});

test('RBAC: recusa delegação quando canDelegate falha', () => {
  const db = freshDb();
  const denied = delegateTask({
    db,
    id,
    manager: M,
    worker: W,
    title: 'X',
    description: 'Y',
    limits,
    canDelegateFn: () => ({ error: 'Sem permissão para delegar.' })
  });
  assert.match(denied.error, /permissão/);
  assert.equal(db.delegations.length, 0);
  assert.equal(db.messages.length, 0);
});

test('parseProtocolBody e ingestWorkerInboxReply', () => {
  const db = freshDb();
  const { delegation, message } = delegateTask({
    db,
    id,
    manager: M,
    worker: W,
    title: 'Parse',
    description: 'Teste',
    limits
  });
  const env = `{"protocol":"manager-worker","kind":"complete","delegationId":"${delegation.id}","result":"feito"}\n\nPronto.`;
  assert.equal(parseProtocolBody(env)?.kind, MESSAGE_KIND.complete);

  const ing = ingestWorkerInboxReply({
    db,
    id,
    worker: W,
    manager: M,
    delegationId: delegation.id,
    replyText: env,
    hops: message.hops,
    limits
  });
  assert.ok(ing.ok);
  assert.equal(ing.delegation.status, DELEGATION_STATUS.completed);
});

test('applyProtocolEvent bloqueia transição inválida', () => {
  const d = { id: 'd1', status: DELEGATION_STATUS.completed, events: [] };
  assert.match(applyProtocolEvent(d, MESSAGE_KIND.accept).error, /aceitar/);
});

test('delegationsSummary conta por estado', () => {
  const s = delegationsSummary([
    { status: 'pending' },
    { status: 'active' },
    { status: 'completed' },
    { status: 'rejected' }
  ]);
  assert.equal(s.pending, 1);
  assert.equal(s.active, 1);
  assert.equal(s.completed, 1);
  assert.equal(s.rejected, 1);
});
