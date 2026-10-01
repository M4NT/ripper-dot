/** Registro persistido de tarefa delegada (ex.: via send_message / inbox). */

export const TASK_STATUS = Object.freeze({
  open: 'open',
  failed: 'failed',
  archived: 'archived'
});

export function ensureTaskItems(db) {
  if (!Array.isArray(db.taskItems)) db.taskItems = [];
  return db.taskItems;
}

export function findTaskItem(db, taskId) {
  return ensureTaskItems(db).find(t => t.id === taskId) || null;
}

export function findTaskItemByInboxMessageId(db, inboxMessageId) {
  return ensureTaskItems(db).find(t => t.inboxMessageId === inboxMessageId) || null;
}

/** Título curto a partir do corpo da mensagem delegada. */
export function taskTitleFromBody(body) {
  const line = String(body || '').split('\n').map(l => l.trim()).find(Boolean) || 'Tarefa delegada';
  return line.slice(0, 200);
}

/**
 * Cria item de tarefa ao enfileirar mensagem inbox (pedido assíncrono entre agentes).
 * @returns {{ task: object, created: boolean }}
 */
export function trackInboxDelegation(db, message, { id, now = Date.now() } = {}) {
  const existing = findTaskItemByInboxMessageId(db, message.id);
  if (existing) return { task: existing, created: false };

  const task = {
    id: id?.() ?? message.id,
    requesterId: message.from,
    assigneeId: message.to,
    inboxMessageId: message.id,
    originChatId: message.originChatId || null,
    title: taskTitleFromBody(message.body),
    status: TASK_STATUS.open,
    createdAt: now,
    updatedAt: now
  };
  ensureTaskItems(db).push(task);
  return { task, created: true };
}

export function taskItemsSummary(taskItems) {
  const counts = { open: 0, failed: 0, archived: 0 };
  for (const t of taskItems || []) {
    const s = t.status || TASK_STATUS.open;
    if (counts[s] != null) counts[s]++;
    else counts.open++;
  }
  return counts;
}
