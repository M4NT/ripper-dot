/**
 * Quadro compartilhado do time (Agent Teams): team_tasks { id, owner, status, deps }.
 * Separado de projectTasks (kanban do projeto) e de taskItems (registro do inbox).
 */

import { checkSend } from './inbox.mjs';
import { trackInboxDelegation } from './task-items.mjs';

export const TEAM_TASK_STATUS = Object.freeze({
  todo: 'todo',
  doing: 'doing',
  blocked: 'blocked',
  done: 'done',
  cancelled: 'cancelled'
});

const STATUSES = new Set(Object.values(TEAM_TASK_STATUS));
const OPEN = new Set([TEAM_TASK_STATUS.todo, TEAM_TASK_STATUS.doing, TEAM_TASK_STATUS.blocked]);
const PRIORITIES = new Set(['now', 'normal', 'low']);

export function ensureTeamTasks(db) {
  if (!Array.isArray(db.teamTasks)) db.teamTasks = [];
  return db.teamTasks;
}

export function findTeamTask(db, taskId) {
  return ensureTeamTasks(db).find(t => t.id === taskId) || null;
}

export function findTeamTaskByInboxMessageId(db, inboxMessageId) {
  if (!inboxMessageId) return null;
  return ensureTeamTasks(db).find(t => t.inboxMessageId === inboxMessageId) || null;
}

export function taskTitleFromText(text) {
  const line = String(text || '').split('\n').map(l => l.trim()).find(Boolean) || 'Tarefa do time';
  return line.slice(0, 200);
}

function normalizeDeps(deps) {
  if (!Array.isArray(deps)) return [];
  return [...new Set(deps.map(x => String(x || '').trim()).filter(Boolean))].slice(0, 20);
}

function normalizePriority(p) {
  return PRIORITIES.has(p) ? p : 'normal';
}

function normalizeStatus(s) {
  return STATUSES.has(s) ? s : TEAM_TASK_STATUS.todo;
}

/**
 * @returns {object}
 */
export function createTeamTask(db, input, { id, now = Date.now() } = {}) {
  const title = String(input.title || '').trim().slice(0, 200);
  if (!title) return { error: 'Informe o título da tarefa.' };
  if (!input.ownerId) return { error: 'ownerId é obrigatório.' };

  const deps = normalizeDeps(input.deps);
  for (const depId of deps) {
    if (!findTeamTask(db, depId)) return { error: `Dependência "${depId}" não existe.` };
  }

  const blocked = deps.some(depId => {
    const d = findTeamTask(db, depId);
    return d && d.status !== TEAM_TASK_STATUS.done;
  });

  const task = {
    id: input.id || id?.() || crypto.randomUUID(),
    ownerId: input.ownerId,
    assigneeId: input.assigneeId || null,
    title,
    note: String(input.note || '').slice(0, 4000),
    status: blocked ? TEAM_TASK_STATUS.blocked : normalizeStatus(input.status),
    deps,
    chatId: input.chatId || null,
    originChatId: input.originChatId || input.chatId || null,
    inboxMessageId: input.inboxMessageId || null,
    childChatId: input.childChatId || null,
    parentTaskId: input.parentTaskId || null,
    progress: input.progress && typeof input.progress === 'object'
      ? {
          percent: clampPercent(input.progress.percent),
          note: String(input.progress.note || '').slice(0, 500),
          at: input.progress.at || now
        }
      : null,
    result: input.result ? String(input.result).slice(0, 4000) : null,
    priority: normalizePriority(input.priority),
    isolated: !!input.isolated,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now
  };
  ensureTeamTasks(db).push(task);
  return { ok: true, task };
}

function clampPercent(n) {
  if (n == null || n === '') return null;
  const p = Math.round(Number(n));
  if (!Number.isFinite(p)) return null;
  return Math.max(0, Math.min(100, p));
}

export function depsSatisfied(db, task) {
  for (const depId of task.deps || []) {
    const d = findTeamTask(db, depId);
    if (!d || d.status !== TEAM_TASK_STATUS.done) return false;
  }
  return true;
}

/**
 * @returns {{ ok: true, task } | { error: string }}
 */
export function updateTeamTask(db, taskId, patch = {}, { now = Date.now() } = {}) {
  const task = findTeamTask(db, taskId);
  if (!task) return { error: 'Tarefa não encontrada.' };

  if (patch.title !== undefined) {
    const t = String(patch.title || '').trim();
    if (!t) return { error: 'Informe o título da tarefa.' };
    task.title = t.slice(0, 200);
  }
  if (patch.note !== undefined) task.note = String(patch.note || '').slice(0, 4000);
  if (patch.assigneeId !== undefined) task.assigneeId = patch.assigneeId || null;
  if (patch.deps !== undefined) {
    const deps = normalizeDeps(patch.deps);
    for (const depId of deps) {
      if (depId === task.id) return { error: 'Uma tarefa não pode depender de si mesma.' };
      if (!findTeamTask(db, depId)) return { error: `Dependência "${depId}" não existe.` };
    }
    task.deps = deps;
  }
  if (patch.inboxMessageId !== undefined) task.inboxMessageId = patch.inboxMessageId || null;
  if (patch.childChatId !== undefined) task.childChatId = patch.childChatId || null;
  if (patch.priority !== undefined) task.priority = normalizePriority(patch.priority);

  if (patch.progress !== undefined) {
    if (patch.progress == null) task.progress = null;
    else {
      task.progress = {
        percent: clampPercent(patch.progress.percent),
        note: String(patch.progress.note || '').slice(0, 500),
        at: now
      };
    }
  }
  if (patch.result !== undefined) task.result = patch.result ? String(patch.result).slice(0, 4000) : null;

  if (patch.status !== undefined) {
    if (!STATUSES.has(patch.status)) return { error: 'Status inválido.' };
    if (patch.status === TEAM_TASK_STATUS.doing && !depsSatisfied(db, task)) {
      task.status = TEAM_TASK_STATUS.blocked;
    } else {
      task.status = patch.status;
    }
    if (task.status === TEAM_TASK_STATUS.done) task.completedAt = now;
    if (task.status === TEAM_TASK_STATUS.cancelled) task.cancelledAt = now;
  } else if (task.status === TEAM_TASK_STATUS.blocked && depsSatisfied(db, task)) {
    task.status = TEAM_TASK_STATUS.todo;
  }

  task.updatedAt = now;
  if (task.status === TEAM_TASK_STATUS.done) unblockDependents(db, task.id, now);
  return { ok: true, task };
}

function unblockDependents(db, doneId, now) {
  for (const t of ensureTeamTasks(db)) {
    if (t.status !== TEAM_TASK_STATUS.blocked) continue;
    if (!(t.deps || []).includes(doneId)) continue;
    if (depsSatisfied(db, t)) {
      t.status = TEAM_TASK_STATUS.todo;
      t.updatedAt = now;
    }
  }
}

export function listTeamTasks(db, filters = {}) {
  let items = ensureTeamTasks(db).slice();
  if (filters.chatId) {
    items = items.filter(t => t.chatId === filters.chatId || t.originChatId === filters.chatId);
  }
  if (filters.ownerId) items = items.filter(t => t.ownerId === filters.ownerId);
  if (filters.assigneeId) items = items.filter(t => t.assigneeId === filters.assigneeId);
  if (filters.status) items = items.filter(t => t.status === filters.status);
  if (filters.open) items = items.filter(t => OPEN.has(t.status));
  items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return items;
}

export function cancelTeamTasksForChat(db, chatId, { now = Date.now(), reason = 'Interrompido pelo usuário.' } = {}) {
  const cancelled = [];
  for (const t of ensureTeamTasks(db)) {
    if (!OPEN.has(t.status)) continue;
    if (t.chatId !== chatId && t.originChatId !== chatId && t.childChatId !== chatId) continue;
    t.status = TEAM_TASK_STATUS.cancelled;
    t.result = reason;
    t.cancelledAt = now;
    t.updatedAt = now;
    cancelled.push(t);
  }
  return cancelled;
}

/** Liga uma mensagem inbox a uma tarefa existente ou cria uma nova. */
export function linkOrCreateTeamTaskFromInbox(db, message, { id, ownerId, now = Date.now() } = {}) {
  const existing = findTeamTaskByInboxMessageId(db, message.id);
  if (existing) return { task: existing, created: false };
  const out = createTeamTask(db, {
    ownerId: ownerId || message.from,
    assigneeId: message.to,
    title: taskTitleFromText(message.body),
    note: String(message.body || '').slice(0, 4000),
    status: TEAM_TASK_STATUS.doing,
    chatId: message.originChatId || null,
    originChatId: message.originChatId || null,
    inboxMessageId: message.id,
    priority: message.priority
  }, { id, now });
  if (out.error) return out;
  return { task: out.task, created: true };
}

export function applyInboxResultToTeamTask(db, inboxMessage, result, { now = Date.now(), cancelled = false } = {}) {
  const task = findTeamTaskByInboxMessageId(db, inboxMessage?.id);
  if (!task) return { skipped: true };
  if (!OPEN.has(task.status) && task.status !== TEAM_TASK_STATUS.done) return { skipped: true, task };
  return updateTeamTask(db, task.id, {
    status: cancelled ? TEAM_TASK_STATUS.cancelled : TEAM_TASK_STATUS.done,
    result: String(result || '').slice(0, 4000),
    progress: cancelled ? task.progress : { percent: 100, note: 'concluída', at: now }
  }, { now });
}

export function ownerWakeBody({ task, assigneeName, result }) {
  const title = task.title || 'Tarefa';
  return `[Resultado da tarefa · ${title}]\n${assigneeName} terminou o que você pediu.\n\n${result}\n\nResuma isto para o usuário na conversa de origem. Não delegue de novo a mesma tarefa.`;
}

/**
 * Acorda o dono da tarefa (priority now) para ele repassar o resultado ao usuário.
 */
export function enqueueOwnerWake({
  db,
  id,
  from,
  to,
  task,
  result,
  hops = 0,
  limits,
  now = Date.now()
}) {
  if (!from?.id || !to?.id || from.id === to.id) return { skipped: true };
  const sendChk = checkSend({
    from,
    to,
    messages: db.messages || [],
    hops: hops + 1,
    limits,
    now
  });
  if (sendChk.error) return { error: sendChk.error };

  const message = {
    id: id(),
    from: from.id,
    to: to.id,
    body: ownerWakeBody({ task, assigneeName: from.name, result }).slice(0, 4000),
    priority: 'now',
    status: 'queued',
    hops: hops + 1,
    originChatId: task.originChatId || task.chatId || null,
    createdAt: now,
    teamTaskWake: { taskId: task.id }
  };
  db.messages.push(message);
  return { ok: true, message };
}

export function enqueuePeerMessage({
  db,
  id,
  from,
  to,
  body,
  priority = 'normal',
  originChatId,
  hops = 0,
  limits,
  now = Date.now()
}) {
  if (!from?.id || !to?.id) return { error: 'Remetente e destinatário são obrigatórios.' };
  const sendChk = checkSend({
    from,
    to,
    messages: db.messages || [],
    hops: hops + 1,
    limits,
    now
  });
  if (sendChk.error) return { error: sendChk.error };

  const message = {
    id: id(),
    from: from.id,
    to: to.id,
    body: String(body || '').slice(0, 4000),
    priority: normalizePriority(priority),
    status: 'queued',
    hops: hops + 1,
    originChatId: originChatId || null,
    createdAt: now
  };
  db.messages.push(message);
  trackInboxDelegation(db, message, { id, now });
  return { ok: true, message };
}

export function publicTeamTask(task, db) {
  if (!task) return null;
  const agents = db?.agents || [];
  const owner = agents.find(a => a.id === task.ownerId);
  const assignee = agents.find(a => a.id === task.assigneeId);
  return {
    id: task.id,
    ownerId: task.ownerId,
    ownerName: owner?.name || null,
    assigneeId: task.assigneeId,
    assigneeName: assignee?.name || null,
    title: task.title,
    note: task.note || '',
    status: task.status,
    deps: task.deps || [],
    progress: task.progress,
    result: task.result,
    priority: task.priority,
    isolated: !!task.isolated,
    chatId: task.chatId,
    originChatId: task.originChatId,
    inboxMessageId: task.inboxMessageId,
    childChatId: task.childChatId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

export function teamBoardForChat(db, chat) {
  const chatId = typeof chat === 'string' ? chat : chat?.id;
  if (!chatId) return { members: [], tasks: [] };
  const row = typeof chat === 'string' ? (db.chats || []).find(c => c.id === chatId) : chat;
  const memberIds = row?.agentIds?.length ? row.agentIds : (row?.agentId ? [row.agentId] : []);
  const tasks = listTeamTasks(db, { chatId });
  const members = memberIds.map(id => {
    const agent = (db.agents || []).find(a => a.id === id);
    const current = tasks.find(t => t.assigneeId === id && OPEN.has(t.status));
    return {
      agentId: id,
      name: agent?.name || id,
      description: agent?.description || '',
      task: current ? publicTeamTask(current, db) : null
    };
  });
  return { chatId, members, tasks: tasks.map(t => publicTeamTask(t, db)) };
}

export function formatTeamTaskList(tasks, db) {
  if (!tasks.length) return 'Nenhuma tarefa no quadro do time.';
  return tasks.map(t => {
    const pub = publicTeamTask(t, db);
    const who = pub.assigneeName || 'sem responsável';
    const pct = t.progress?.percent != null ? ` ${t.progress.percent}%` : '';
    const deps = (t.deps || []).length ? ` deps:${t.deps.join(',')}` : '';
    return `- [${t.status}${pct}] ${t.title} · ${who} (${t.id.slice(0, 8)})${deps}`;
  }).join('\n');
}
