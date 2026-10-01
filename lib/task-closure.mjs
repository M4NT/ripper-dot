/**
 * Encerramento autônomo de tarefas delegadas: completar → validar → confirmar ao solicitante → arquivar.
 */

import { checkSend } from './inbox.mjs';
import { TASK_STATUS, findTaskItem, findTaskItemByInboxMessageId } from './task-items.mjs';
import { noopGoogleTasksSync } from './google-tasks-sync.mjs';
import { isPass } from './agent-flow.mjs';

export const CLOSURE_OUTCOME = Object.freeze({
  closed: 'closed',
  alreadyArchived: 'already_archived',
  validationFailed: 'validation_failed',
  taskNotFound: 'task_not_found'
});

/** Checagens básicas de sucesso antes de confirmar ao solicitante. */
export function validateTaskResult(result) {
  const text = String(result ?? '').trim();
  if (!text) return { ok: false, error: 'Resposta vazia.' };
  if (isPass(text)) return { ok: false, error: 'Destinatário não entregou trabalho (PASSO).' };
  if (/^\s*erro:/i.test(text) || /\berror:\s/i.test(text)) {
    return { ok: false, error: 'Resposta indica erro.' };
  }
  return { ok: true, result: text };
}

export function closureConfirmationBody({ task, assigneeName, result }) {
  const title = task.title || 'Tarefa';
  return `[Tarefa concluída · ${title}]\n${assigneeName} finalizou o pedido.\n\n${result}\n\n(A tarefa foi arquivada automaticamente.)`;
}

export function closureValidationFailureBody({ task, assigneeName, reason }) {
  const title = task.title || 'Tarefa';
  return `[Tarefa não validada · ${title}]\n${assigneeName} respondeu, mas o encerramento automático falhou: ${reason}\n\nRevise manualmente se precisar reabrir ou delegar de novo.`;
}

function resolveAgent(db, agentId) {
  return (db.agents || []).find(a => a.id === agentId) || null;
}

/**
 * Enfileira confirmação (ou falha de validação) na inbox do solicitante.
 */
export function enqueueClosureInbox({
  db,
  id,
  from,
  to,
  body,
  originChatId,
  hops = 0,
  limits,
  taskId,
  kind = 'closure_confirm'
}) {
  const sendChk = checkSend({
    from,
    to,
    messages: db.messages || [],
    hops,
    limits
  });
  if (sendChk.error) return { error: sendChk.error };

  const message = {
    id: id(),
    from: from.id,
    to: to.id,
    body: String(body).slice(0, 4000),
    priority: 'normal',
    status: 'queued',
    hops,
    originChatId: originChatId || null,
    createdAt: Date.now(),
    taskClosure: { taskId, kind }
  };
  db.messages.push(message);
  return { ok: true, message };
}

/**
 * Pipeline idempotente: valida resultado, notifica solicitante, arquiva.
 * @param {object} opts
 * @param {import('./google-tasks-sync.mjs').GoogleTasksSyncHook} [opts.googleTasksSync]
 */
export async function runTaskClosure({
  db,
  taskId,
  result,
  id,
  limits = { maxPerHour: 20, maxHops: 3 },
  hops = 0,
  now = Date.now(),
  googleTasksSync = noopGoogleTasksSync(),
  skipInbox = false
}) {
  const task = findTaskItem(db, taskId);
  if (!task) return { outcome: CLOSURE_OUTCOME.taskNotFound, error: 'Tarefa não encontrada.' };

  if (task.status === TASK_STATUS.archived) {
    return { outcome: CLOSURE_OUTCOME.alreadyArchived, ok: true, task, idempotent: true };
  }

  const assignee = resolveAgent(db, task.assigneeId);
  const requester = resolveAgent(db, task.requesterId);
  if (!assignee || !requester) {
    task.status = TASK_STATUS.failed;
    task.validationError = 'Agente do pedido ou do destinatário não existe mais.';
    task.updatedAt = now;
    return { outcome: CLOSURE_OUTCOME.validationFailed, ok: false, task, error: task.validationError };
  }

  const validation = validateTaskResult(result);
  if (!validation.ok) {
    task.status = TASK_STATUS.failed;
    task.validationError = validation.error;
    task.result = String(result ?? '').slice(0, 4000);
    task.updatedAt = now;

    if (!skipInbox) {
      const failBody = closureValidationFailureBody({
        task,
        assigneeName: assignee.name,
        reason: validation.error
      });
      const notify = enqueueClosureInbox({
        db,
        id,
        from: assignee,
        to: requester,
        body: failBody,
        originChatId: task.originChatId,
        hops: hops + 1,
        limits,
        taskId: task.id,
        kind: 'closure_validation_failed'
      });
      if (notify.error) return { outcome: CLOSURE_OUTCOME.validationFailed, ok: false, task, error: notify.error };
    }

    return { outcome: CLOSURE_OUTCOME.validationFailed, ok: false, task, validationError: validation.error };
  }

  task.result = validation.result;
  task.completedAt = now;
  task.updatedAt = now;
  await googleTasksSync.onTaskCompleted?.({ ...task });

  let confirmationMessage;
  if (!skipInbox) {
    const body = closureConfirmationBody({
      task,
      assigneeName: assignee.name,
      result: validation.result
    });
    const notify = enqueueClosureInbox({
      db,
      id,
      from: assignee,
      to: requester,
      body,
      originChatId: task.originChatId,
      hops: hops + 1,
      limits,
      taskId: task.id,
      kind: 'closure_confirm'
    });
    if (notify.error) return { outcome: CLOSURE_OUTCOME.validationFailed, ok: false, task, error: notify.error };
    confirmationMessage = notify.message;
  }

  task.status = TASK_STATUS.archived;
  task.archivedAt = now;
  task.updatedAt = now;
  task.validationError = null;
  await googleTasksSync.onTaskArchived?.({ ...task });

  return {
    outcome: CLOSURE_OUTCOME.closed,
    ok: true,
    task,
    confirmationMessage
  };
}

/** Dispara encerramento quando uma mensagem inbox delegada recebe resposta. */
export async function closeTaskFromInboxReply({
  db,
  inboxMessage,
  replyText,
  id,
  limits,
  hops = 0,
  googleTasksSync,
  skipInbox = false
}) {
  const task = findTaskItemByInboxMessageId(db, inboxMessage.id);
  if (!task || task.status === TASK_STATUS.archived) {
    return task?.status === TASK_STATUS.archived
      ? { outcome: CLOSURE_OUTCOME.alreadyArchived, ok: true, idempotent: true, task }
      : { skipped: true };
  }
  return runTaskClosure({
    db,
    taskId: task.id,
    result: replyText,
    id,
    limits,
    hops,
    googleTasksSync,
    skipInbox
  });
}
