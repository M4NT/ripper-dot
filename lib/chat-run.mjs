/** Metadados de turno SSE persistidos por conversa (retomada honesta após queda). */

import { lastUserTurnIndex } from './agent-flow.mjs';

/** @typedef {{ runId: string, status: 'running'|'interrupted'|'done', lastEventSeq: number, startedAt: number, finishedAt?: number, userMessageId?: string }} ChatRun */

/**
 * Marca runs órfãs (servidor caiu com status running).
 * @param {Array<{ run?: ChatRun }>} chats
 */
export function repairChatRunsOnStartup(chats) {
  for (const c of chats || []) {
    if (c.run?.status === 'running') {
      c.run = { ...c.run, status: 'interrupted', finishedAt: Date.now() };
    }
  }
}

/** Vista segura para API (sem campos internos extras). */
export function chatRunPublic(run) {
  if (!run) return null;
  return {
    runId: run.runId,
    status: run.status,
    lastEventSeq: run.lastEventSeq ?? 0,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? null,
    userMessageId: run.userMessageId ?? null
  };
}

export function beginChatRun(chat, { runId, userMessageId }) {
  chat.run = {
    runId,
    status: 'running',
    lastEventSeq: 0,
    startedAt: Date.now(),
    userMessageId: userMessageId || null
  };
}

export function bumpChatRunSeq(chat) {
  if (!chat.run || chat.run.status !== 'running') return;
  chat.run.lastEventSeq = (chat.run.lastEventSeq || 0) + 1;
}

export function finishChatRun(chat, status) {
  if (!chat.run) return;
  chat.run = { ...chat.run, status, finishedAt: Date.now() };
}

/** Remove respostas parciais após a última pergunta do usuário. */
export function trimPartialRepliesAfterLastUser(chat) {
  const at = lastUserTurnIndex(chat.messages || []);
  if (at < 0) return { ok: false, reason: 'Não há mensagem do usuário para retomar.' };
  while ((chat.messages?.length || 0) > at + 1) {
    const tail = chat.messages.at(-1);
    if (tail?.role === 'assistant' && (tail.stopped || tail.error || !String(tail.content || '').trim())) {
      chat.messages.pop();
      continue;
    }
    return { ok: false, reason: 'A última pergunta já tem resposta. Envie uma nova mensagem.' };
  }
  const user = chat.messages[at];
  return { ok: true, at, user, text: String(user.content || '').trim(), fileIds: user.files || [] };
}

export function canResumeChatRun(chat, { streaming } = {}) {
  if (streaming) return { ok: false, reason: 'Resposta em andamento.' };
  if (chat.run?.status !== 'interrupted') return { ok: false, reason: 'Nenhuma execução interrompida para retomar.' };
  const trim = trimPartialRepliesAfterLastUser(chat);
  if (!trim.ok) return trim;
  if (!trim.text && !(trim.fileIds?.length)) return { ok: false, reason: 'Mensagem do usuário vazia.' };
  return { ok: true, ...trim };
}
