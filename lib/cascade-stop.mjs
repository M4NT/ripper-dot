/**
 * Parada em cascata: um "Parar" na conversa interrompe o que foi delegado
 * (inbox, subagentes isolados, quadro do time, streams filhos).
 */

import { cancelTeamTasksForChat, TEAM_TASK_STATUS } from './team-tasks.mjs';

const deliveryAbort = new Map(); // key → { ac, originChatId, childChatId }

export function registerDeliveryAbort(key, { originChatId = null, childChatId = null } = {}) {
  const ac = new AbortController();
  deliveryAbort.set(key, { ac, originChatId, childChatId });
  return ac;
}

export function unregisterDeliveryAbort(key) {
  deliveryAbort.delete(key);
}

export function getDeliveryAbort(key) {
  return deliveryAbort.get(key) || null;
}

export function _resetDeliveryAbortForTests() {
  deliveryAbort.clear();
}

function abortRegisteredForChat(chatId) {
  const aborted = [];
  for (const [key, rec] of deliveryAbort) {
    if (rec.originChatId === chatId || rec.childChatId === chatId) {
      if (!rec.ac.signal.aborted) rec.ac.abort('cascade');
      aborted.push(key);
    }
  }
  return aborted;
}

export function childChatIdsOf(db, chatId) {
  const ids = [];
  for (const c of db.chats || []) {
    if (c.parentChatId === chatId) ids.push(c.id);
  }
  for (const t of db.teamTasks || []) {
    if ((t.chatId === chatId || t.originChatId === chatId) && t.childChatId) ids.push(t.childChatId);
  }
  for (const m of db.messages || []) {
    if (m.originChatId === chatId && m.threadChatId) ids.push(m.threadChatId);
  }
  return [...new Set(ids)];
}

/**
 * Cancela a conversa e tudo que ela despachou.
 * @returns {{ ok: boolean, chats: string[], messages: string[], tasks: string[], aborted: string[], approvals: string[] }}
 */
export function cancelCascade({
  chatId,
  db,
  cancelChatStream,
  decideApproval,
  now = Date.now(),
  reason = 'Interrompido pelo usuário.',
  stopReason = 'user'
}) {
  const chats = [];
  const messages = [];
  const tasks = [];
  const aborted = [];
  const approvals = [];
  const seen = new Set();

  function walk(id, streamReason) {
    if (!id || seen.has(id)) return;
    seen.add(id);

    if (typeof cancelChatStream === 'function' && cancelChatStream(id, streamReason)) {
      chats.push(id);
    }
    aborted.push(...abortRegisteredForChat(id));

    for (const m of db.messages || []) {
      const fromHere = m.originChatId === id || m.threadChatId === id;
      if (!fromHere) continue;
      if (m.status === 'queued' || m.status === 'delivering') {
        m.status = 'failed';
        m.error = reason;
        m.updatedAt = now;
        messages.push(m.id);
      }
      if (m.threadChatId && m.threadChatId !== id) walk(m.threadChatId, 'cascade');
    }

    for (const childId of childChatIdsOf(db, id)) walk(childId, 'cascade');

    for (const t of cancelTeamTasksForChat(db, id, { now, reason })) {
      tasks.push(t.id);
      if (t.childChatId) walk(t.childChatId, 'cascade');
    }
  }

  walk(chatId, stopReason);

  for (const a of db.approvals || []) {
    if (a.status !== 'pending') continue;
    if (!seen.has(a.chatId) && !seen.has(a.sourceChatId)) continue;
    const decided = typeof decideApproval === 'function' && decideApproval(a.id);
    if (!decided && a.status === 'pending') {
      a.status = 'cancelled';
      a.decidedAt = now;
      a.cancelReason = reason;
    }
    approvals.push(a.id);
  }

  return {
    ok: chats.length + messages.length + tasks.length + aborted.length + approvals.length > 0,
    chats: [...new Set(chats)],
    messages: [...new Set(messages)],
    tasks: [...new Set(tasks)],
    aborted: [...new Set(aborted)],
    approvals: [...new Set(approvals)]
  };
}

export function cascadeTouched(result) {
  return !!(result && (result.chats.length || result.messages.length || result.tasks.length || result.aborted.length || result.approvals?.length));
}

export { TEAM_TASK_STATUS };
