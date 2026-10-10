/**
 * Portão da delegação do time: checkSend, ciclo, profundidade, fan-out,
 * timeout, orçamento, autonomia efetiva e resultado não confiável.
 */

import { randomBytes } from 'node:crypto';
import { checkSend, clampCallTimeoutMs } from './inbox.mjs';
import { canDelegate, delegationDeniedMessage } from './rbac.mjs';
import { checkRunBudget, tokensFromChars } from './token-budget-governor.mjs';
import { AUTONOMY_LEVELS, effectiveAutonomyLevel } from './autonomy.mjs';
import {
  TEAM_TASK_STATUS,
  ensureTeamTasks,
  findTeamTask,
  listTeamTasks,
  updateTeamTask,
  enqueuePeerMessage,
  wrapUntrustedColleagueResult,
  canWriteTeamTask,
  wouldCreateDepCycle
} from './team-tasks.mjs';

export { wrapUntrustedColleagueResult, canWriteTeamTask, wouldCreateDepCycle };

export const DEFAULT_TEAM_FAN_OUT = 5;
export const MAX_TEAM_TASKS = 400;
export const MAX_INBOX_MESSAGES = 1000;
export const DEFAULT_TREE_TIMEOUT_MS = 900_000;
export const DEFAULT_TREE_MAX_TOKENS = 50_000;

const OPEN = new Set([TEAM_TASK_STATUS.todo, TEAM_TASK_STATUS.doing, TEAM_TASK_STATUS.blocked]);

export function minAutonomyLevel(owner, worker, settings) {
  const a = effectiveAutonomyLevel(owner, settings);
  const b = effectiveAutonomyLevel(worker, settings);
  return AUTONOMY_LEVELS[Math.min(AUTONOMY_LEVELS.indexOf(a), AUTONOMY_LEVELS.indexOf(b))];
}

export function clampAutonomyTo(level, cap) {
  const i = AUTONOMY_LEVELS.indexOf(level);
  const j = AUTONOMY_LEVELS.indexOf(cap);
  if (i < 0) return cap && AUTONOMY_LEVELS.includes(cap) ? cap : 'semi_autonomous';
  if (j < 0) return level;
  return AUTONOMY_LEVELS[Math.min(i, j)];
}

/** Menor entre dono, delegado e a autonomia já gravada na cadeia (neto ≤ raiz). */
export function computeTaskAutonomy(db, { owner, worker, settings, parentTaskId, chat } = {}) {
  let cap = owner && worker ? minAutonomyLevel(owner, worker, settings) : (worker ? effectiveAutonomyLevel(worker, settings) : 'semi_autonomous');
  let tid = parentTaskId || parentTaskIdForChat(db, typeof chat === 'string' ? chat : chat?.id);
  const seen = new Set();
  while (tid && !seen.has(tid)) {
    seen.add(tid);
    const t = findTeamTask(db, tid);
    if (!t) break;
    if (t.effectiveAutonomy) cap = clampAutonomyTo(cap, t.effectiveAutonomy);
    tid = t.parentTaskId;
  }
  return cap;
}

export function agentWithEffectiveAutonomy(owner, worker, settings, task) {
  const level = task?.effectiveAutonomy || minAutonomyLevel(owner, worker, settings);
  return { ...worker, autonomyLevel: level };
}

export function makeUntrustedFence() {
  return `untrusted-${randomBytes(8).toString('hex')}`;
}

export function ensureTeamTrees(db) {
  if (!db.teamTrees || typeof db.teamTrees !== 'object' || Array.isArray(db.teamTrees)) db.teamTrees = {};
  return db.teamTrees;
}

export function ensureTeamTree(db, rootChatId, { settings, limits, now = Date.now() } = {}) {
  if (!rootChatId) return null;
  const trees = ensureTeamTrees(db);
  if (!trees[rootChatId]) {
    const inbox = settings?.inbox || limits || {};
    const timeout = Math.max(1, +(inbox.treeTimeoutMs || DEFAULT_TREE_TIMEOUT_MS));
    trees[rootChatId] = {
      rootChatId,
      startedAt: now,
      deadlineAt: now + timeout,
      maxTokens: Math.max(1, +(inbox.treeMaxTokens || DEFAULT_TREE_MAX_TOKENS)),
      usedTokens: 0,
      usedUsd: 0,
      maxUsd: inbox.treeMaxUsd != null && Number.isFinite(+inbox.treeMaxUsd) ? +inbox.treeMaxUsd : null
    };
  }
  return trees[rootChatId];
}

export function checkTeamTree(tree, { now = Date.now() } = {}) {
  if (!tree) return { ok: true, remainingMs: null, remainingTokens: null };
  const remainingMs = tree.deadlineAt - now;
  if (remainingMs <= 0) return { error: 'Tempo da árvore de delegação esgotado.' };
  if (tree.usedTokens >= tree.maxTokens) {
    return { error: `Orçamento de tokens da árvore esgotado (${tree.usedTokens} / ${tree.maxTokens}).` };
  }
  if (tree.maxUsd != null && tree.usedUsd >= tree.maxUsd) {
    return { error: `Orçamento da árvore de delegação esgotado (US$ ${tree.usedUsd.toFixed(2)}).` };
  }
  return {
    ok: true,
    remainingMs,
    remainingTokens: Math.max(0, tree.maxTokens - tree.usedTokens)
  };
}

export function addTeamTreeUsage(tree, { tokens = 0, charsIn = 0, charsOut = 0, usd = 0 } = {}) {
  if (!tree) return tree;
  const extra = tokens || tokensFromChars((charsIn || 0) + (charsOut || 0));
  tree.usedTokens = (tree.usedTokens || 0) + extra;
  tree.usedUsd = (tree.usedUsd || 0) + (Number(usd) || 0);
  return tree;
}

export function rootChatId(db, chat) {
  let c = typeof chat === 'string' ? (db.chats || []).find(x => x.id === chat) : chat;
  const seen = new Set();
  while (c?.parentChatId && !seen.has(c.id)) {
    seen.add(c.id);
    c = (db.chats || []).find(x => x.id === c.parentChatId);
  }
  return c?.id || (typeof chat === 'string' ? chat : chat?.id) || null;
}

export function isolatedDepth(db, chat) {
  let n = 0;
  let c = typeof chat === 'string' ? (db.chats || []).find(x => x.id === chat) : chat;
  const seen = new Set();
  while (c?.parentChatId && !seen.has(c.id)) {
    seen.add(c.id);
    n += 1;
    c = (db.chats || []).find(x => x.id === c.parentChatId);
  }
  return n;
}

export function parentTaskIdForChat(db, chatId) {
  if (!chatId) return null;
  return ensureTeamTasks(db).find(t => t.childChatId === chatId)?.id || null;
}

export function delegationChainAgentIds(db, { chat, parentTaskId, ownerId } = {}) {
  const ids = new Set();
  if (ownerId) ids.add(ownerId);
  let tid = parentTaskId || parentTaskIdForChat(db, typeof chat === 'string' ? chat : chat?.id);
  const seen = new Set();
  while (tid && !seen.has(tid)) {
    seen.add(tid);
    const t = findTeamTask(db, tid);
    if (!t) break;
    if (t.ownerId) ids.add(t.ownerId);
    if (t.assigneeId) ids.add(t.assigneeId);
    tid = t.parentTaskId;
  }
  let c = typeof chat === 'string' ? (db.chats || []).find(x => x.id === chat) : chat;
  const seenC = new Set();
  while (c?.parentChatId && !seenC.has(c.id)) {
    seenC.add(c.id);
    const t = ensureTeamTasks(db).find(x => x.childChatId === c.id);
    if (t) {
      if (t.ownerId) ids.add(t.ownerId);
      if (t.assigneeId) ids.add(t.assigneeId);
    }
    c = (db.chats || []).find(x => x.id === c.parentChatId);
  }
  return ids;
}

export function openDispatchedCount(db, originChatId, { exceptId } = {}) {
  if (!originChatId) return 0;
  return listTeamTasks(db, { chatId: originChatId }).filter(t =>
    OPEN.has(t.status) && t.id !== exceptId && (t.assigneeId || t.isolated)
  ).length;
}

export function teamResultMessage({ id, worker, task, result, childChatId, now = Date.now() }) {
  return {
    id: id(),
    role: 'user',
    agentId: worker?.id || null,
    content: wrapUntrustedColleagueResult({
      assigneeName: worker?.name,
      title: task?.title,
      result
    }),
    via: { type: 'team-result', taskId: task?.id, threadChatId: childChatId || null, untrusted: true },
    untrusted: true,
    at: now
  };
}

/**
 * Portão único: permissão (checkSend + RBAC), sem auto-delegação, ciclo,
 * profundidade, fan-out e orçamento.
 */
export function assertTeamDispatch({
  db,
  from,
  to,
  parentChat,
  hops = 0,
  limits,
  busyToIds = null,
  accessControl,
  settings,
  isolated = false,
  exceptTaskId = null,
  now = Date.now()
}) {
  if (!from?.id) return { error: 'Remetente é obrigatório.' };
  if (!to?.id) return { error: 'Destinatário desconhecido. Use o nome exato de um colega.' };
  if (from.id === to.id) return { error: 'Não é permitido delegar para si mesmo.' };

  const send = checkSend({
    from,
    to,
    messages: db.messages || [],
    hops: hops + 1,
    limits: limits || { maxPerHour: 20, maxHops: 3 },
    busyToIds,
    now
  });
  if (send.error) return send;

  const rbac = canDelegate(
    { type: 'agent', id: from.id },
    { type: 'agent', id: to.id },
    isolated ? 'delegate_task' : 'send_message',
    accessControl,
    { agents: db.agents || [] }
  );
  const denied = delegationDeniedMessage(rbac);
  if (denied) return { error: denied };

  const maxDepth = Math.max(1, +(limits?.maxHops ?? settings?.inbox?.maxHops ?? 3));
  const depth = isolatedDepth(db, parentChat);
  if (depth >= maxDepth) {
    return { error: `Limite de profundidade de delegação atingido (${maxDepth} saltos).` };
  }

  const chain = delegationChainAgentIds(db, {
    chat: parentChat,
    parentTaskId: parentTaskIdForChat(db, typeof parentChat === 'string' ? parentChat : parentChat?.id),
    ownerId: from.id
  });
  if (chain.has(to.id)) {
    return { error: `Delegação cíclica: ${to.name} já está nesta cadeia.` };
  }

  const originId = rootChatId(db, parentChat);
  const maxFan = Math.max(1, +(limits?.maxFanOut ?? settings?.inbox?.maxFanOut ?? DEFAULT_TEAM_FAN_OUT));
  if (openDispatchedCount(db, originId, { exceptId: exceptTaskId }) >= maxFan) {
    return { error: `Limite de ${maxFan} tarefas despachadas nesta conversa.` };
  }

  if (settings || db) {
    const budget = checkRunBudget(db, settings || {}, { agentId: to.id });
    if (budget.blocked) return { error: budget.userMessage };
  }

  const tree = originId ? ensureTeamTree(db, originId, { settings, limits, now }) : null;
  const treeChk = checkTeamTree(tree, { now });
  if (treeChk.error) return treeChk;

  const callMs = clampCallTimeoutMs(undefined, settings?.inbox || limits || {});
  const timeoutMs = treeChk.remainingMs != null
    ? Math.min(callMs, Math.max(1, treeChk.remainingMs))
    : callMs;

  return {
    ok: true,
    timeoutMs,
    tree,
    remainingMs: treeChk.remainingMs,
    remainingTokens: treeChk.remainingTokens
  };
}

export function repairTeamTasksOnStartup(db, { now = Date.now() } = {}) {
  const repaired = [];
  for (const t of ensureTeamTasks(db)) {
    if (t.status !== TEAM_TASK_STATUS.doing) continue;
    if (!t.isolated && !t.childChatId) continue;
    t.status = TEAM_TASK_STATUS.failed;
    t.result = t.result || 'Interrompido ao reiniciar o Ripper.';
    t.progress = { ...(t.progress || {}), note: 'falhou', at: now };
    t.updatedAt = now;
    repaired.push(t);
  }
  return repaired;
}

export function trimTeamTasks(db, max = MAX_TEAM_TASKS) {
  const all = ensureTeamTasks(db);
  if (all.length <= max) return 0;
  const closed = all
    .filter(t => !OPEN.has(t.status))
    .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  const overflow = all.length - max;
  const drop = new Set(closed.slice(0, overflow).map(t => t.id));
  if (!drop.size) return 0;
  db.teamTasks = all.filter(t => !drop.has(t.id));
  return drop.size;
}

/** Corta a fila inbox sem apagar recado ligado a tarefa aberta. */
export function trimInboxKeepingOpenTasks(db, max = MAX_INBOX_MESSAGES) {
  const msgs = db.messages || [];
  if (msgs.length <= max) return 0;
  const keepIds = new Set(
    ensureTeamTasks(db).filter(t => OPEN.has(t.status) && t.inboxMessageId).map(t => t.inboxMessageId)
  );
  const needDrop = msgs.length - max;
  const keep = [];
  let dropped = 0;
  for (const m of msgs) {
    if (dropped < needDrop && !keepIds.has(m.id)) {
      dropped += 1;
      continue;
    }
    keep.push(m);
  }
  db.messages = keep;
  return dropped;
}

export function dispatchReadyTeamTask(task, ctx) {
  if (!task || task.status !== TEAM_TASK_STATUS.todo) return { skipped: true };
  const {
    db, id, hops = 0, limits, save, dispatchInbox, spawnIsolated, emit, busyToIds, settings
  } = ctx;
  const worker = task.assigneeId && (db.agents || []).find(a => a.id === task.assigneeId);
  const owner = (db.agents || []).find(a => a.id === task.ownerId);
  const parentChat = (db.chats || []).find(c => c.id === (task.originChatId || task.chatId));
  if (!worker || !owner || !parentChat) return { skipped: true };
  if (!task.effectiveAutonomy) {
    task.effectiveAutonomy = computeTaskAutonomy(db, {
      owner, worker, settings: settings || db.settings, parentTaskId: task.parentTaskId, chat: parentChat
    });
  }

  const gate = assertTeamDispatch({
    db,
    from: owner,
    to: worker,
    parentChat,
    hops,
    limits,
    busyToIds,
    accessControl: db.accessControl,
    settings: settings || db.settings,
    isolated: !!task.isolated,
    exceptTaskId: task.id
  });
  if (gate.error) return { error: gate.error };

  if (task.isolated) {
    if (typeof spawnIsolated !== 'function') return { error: 'Este turno não pode abrir subagente isolado.' };
    const spawned = spawnIsolated({
      task, worker, prompt: task.note || task.title, owner
    });
    if (spawned?.error) return spawned;
    const now = Date.now();
    updateTeamTask(db, task.id, {
      childChatId: spawned.childChatId || task.childChatId,
      status: TEAM_TASK_STATUS.doing,
      assigneeId: worker.id
    }, { now });
    save?.();
    emit?.({ teamTask: { id: task.id, status: TEAM_TASK_STATUS.doing } });
    return { ok: true, isolated: true, childChatId: spawned.childChatId };
  }

  const queued = enqueuePeerMessage({
    db,
    id,
    from: owner,
    to: worker,
    body: task.note || task.title,
    priority: task.priority || 'normal',
    originChatId: parentChat.id,
    hops,
    limits,
    now: Date.now()
  });
  if (queued.error) return queued;
  updateTeamTask(db, task.id, {
    inboxMessageId: queued.message.id,
    status: TEAM_TASK_STATUS.doing
  });
  save?.();
  dispatchInbox?.();
  emit?.({ teamTask: { id: task.id, status: TEAM_TASK_STATUS.doing }, sent: { to: worker.name, priority: queued.message.priority } });
  return { ok: true, messageId: queued.message.id };
}

export function dispatchReadyTeamTasks(tasks, ctx) {
  const out = [];
  for (const t of tasks || []) out.push(dispatchReadyTeamTask(t, ctx));
  return out;
}
