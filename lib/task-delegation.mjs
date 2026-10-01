/** Registros internos de tarefa/delegação e mapeamento com Google Tasks. */

export const INTERNAL_STATUS = ['open', 'in_progress', 'done', 'cancelled'];

/** @typedef {'open'|'in_progress'|'done'|'cancelled'} InternalTaskStatus */

/**
 * @param {object} input
 * @returns {object}
 */
export function normalizeTaskRecord(input, { id, now = Date.now() } = {}) {
  const status = INTERNAL_STATUS.includes(input.status) ? input.status : 'open';
  return {
    id: input.id || id?.(),
    title: String(input.title || '').slice(0, 500),
    notes: String(input.notes || '').slice(0, 8000),
    status,
    agentId: input.agentId || undefined,
    chatId: input.chatId || undefined,
    delegation: input.delegation
      ? {
          fromAgentId: input.delegation.fromAgentId || undefined,
          toAgentIds: Array.isArray(input.delegation.toAgentIds) ? input.delegation.toAgentIds.slice(0, 20) : undefined,
          originChatId: input.delegation.originChatId || undefined
        }
      : undefined,
    external: input.external?.provider === 'google_tasks'
      ? {
          provider: 'google_tasks',
          taskListId: String(input.external.taskListId || ''),
          taskId: String(input.external.taskId || ''),
          etag: input.external.etag ? String(input.external.etag) : undefined,
          updated: input.external.updated ? String(input.external.updated) : undefined
        }
      : undefined,
    sync: {
      lastPullAt: input.sync?.lastPullAt || undefined,
      lastPushAt: input.sync?.lastPushAt || undefined,
      lastRemoteStatus: input.sync?.lastRemoteStatus || undefined,
      lastLocalStatus: input.sync?.lastLocalStatus || undefined,
      pushFingerprint: input.sync?.pushFingerprint || undefined
    },
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now
  };
}

/** Google Tasks: needsAction | completed */
export function internalStatusToGoogle(status) {
  if (status === 'done' || status === 'cancelled') return 'completed';
  return 'needsAction';
}

/** @param {{ status?: string, completed?: string|null }} googleTask */
export function googleStatusToInternal(googleTask) {
  if (googleTask?.status === 'completed' || googleTask?.completed) return 'done';
  return 'open';
}

export function taskPushFingerprint(record) {
  return `${record.status}|${record.title}|${record.notes || ''}`;
}

export function googleTaskFingerprint(task) {
  const st = task?.status === 'completed' || task?.completed ? 'completed' : 'needsAction';
  return `${st}|${task?.title || ''}|${task?.notes || ''}`;
}

export function applyGoogleTaskToRecord(record, googleTask, now = Date.now()) {
  const nextStatus = googleStatusToInternal(googleTask);
  const changed =
    record.status !== nextStatus ||
    record.title !== (googleTask.title || '') ||
    (record.notes || '') !== (googleTask.notes || '');
  if (!changed) return { record, changed: false };
  return {
    record: {
      ...record,
      title: googleTask.title ?? record.title,
      notes: googleTask.notes ?? record.notes,
      status: nextStatus,
      external: {
        ...(record.external || { provider: 'google_tasks', taskListId: '', taskId: '' }),
        etag: googleTask.etag || record.external?.etag,
        updated: googleTask.updated || record.external?.updated
      },
      sync: {
        ...record.sync,
        lastPullAt: now,
        lastRemoteStatus: googleTask.status || (googleTask.completed ? 'completed' : 'needsAction'),
        lastLocalStatus: nextStatus
      },
      updatedAt: now
    },
    changed: true
  };
}

export function patchRecordForGooglePush(record, now = Date.now()) {
  const fp = taskPushFingerprint(record);
  if (record.sync?.pushFingerprint === fp && record.external?.taskId) {
    return { record, skip: true, reason: 'already_pushed' };
  }
  return {
    record: {
      ...record,
      sync: {
        ...record.sync,
        lastPushAt: now,
        pushFingerprint: fp,
        lastLocalStatus: record.status
      },
      updatedAt: now
    },
    skip: false
  };
}

export function googlePatchBodyFromRecord(record) {
  const completed = internalStatusToGoogle(record.status) === 'completed';
  return {
    title: record.title,
    notes: record.notes || '',
    status: completed ? 'completed' : 'needsAction',
    ...(completed ? { completed: new Date().toISOString() } : { completed: null })
  };
}
