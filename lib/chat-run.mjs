/** Metadados de turno SSE persistidos por conversa (retomada honesta após queda). */

import { lastUserTurnIndex } from './agent-flow.mjs';
import { genuiSafeToRepeat } from './genui.mjs';

/** @typedef {{ runId: string, status: 'running'|'interrupted'|'done', lastEventSeq: number, startedAt: number, finishedAt?: number, userMessageId?: string }} ChatRun */

/**
 * Marca runs órfãs (servidor caiu com status running).
 * @param {Array<{ run?: ChatRun }>} chats
 */
export function repairChatRunsOnStartup(chats) {
  let repaired = 0;
  for (const c of chats || []) {
    if (c.run?.status === 'running') {
      c.run = { ...c.run, status: 'interrupted', finishedAt: Date.now(), interruptedBy: 'restart' };
      repaired++;
    }
  }
  return repaired;
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

// Ferramentas que podem rodar de novo sem efeito fora do Ripper (ler, pesquisar, navegar, guardar no próprio Ripper).
// Qualquer outra (enviar, publicar, executar comando, clicar/digitar, delegar, MCP de terceiros) bloqueia a retomada automática.
export const SAFE_TO_REPEAT = new Set(['offer_setting', // só oferece; quem muda é o clique do usuário
  ...genuiSafeToRepeat(),
  'WebSearch', 'WebFetch', 'github_read', 'github_clone', 'email_list', 'email_read', 'email_attachment',
  'whatsapp_chats', 'whatsapp_read', 'whatsapp_contacts', 'browser_open', 'browser_scroll', 'browser_read',
  'read_artifact', 'save_artifact', 'use_skill', 'list_skills', 'save_skill', 'remember', 'find_script', 'save_script',
  'list_social_webhooks', 'use_connectors', 'deliver_file', 'task_list'
]);
const AUTO_RESUME_WINDOW_MS = 30 * 60_000;
// como aparece no aviso da Caixa
const TOOL_ACTION = {
  whatsapp_send: 'enviar WhatsApp', email_send: 'enviar e-mail', send_message: 'mandar mensagem a um colega', call_agent: 'chamar um colega',
  handoff: 'passar tarefa a um colega', notify_owner: 'avisar você', computer_exec: 'rodar comando no computador', computer_share: 'publicar um link',
  browser_click: 'clicar no navegador', browser_type: 'digitar no navegador', post_social: 'publicar', send_webhook: 'chamar um webhook',
  github_open_pr: 'abrir PR', github_comment: 'comentar no GitHub', github_issue: 'abrir issue', create_agent: 'criar agente',
  create_group: 'criar grupo', schedule_routine: 'criar rotina', parallel_tasks: 'rodar subtarefas', ask_owner: 'perguntar a você',
  task_create: 'criar tarefa do time', task_update: 'atualizar tarefa do time', team_message: 'mandar recado do time'
};

/** Anota no turno a ferramenta usada (diário: decide se dá para retomar sozinho depois de um reinício). */
export function noteChatRunTool(chat, tool) {
  if (!chat.run || chat.run.status !== 'running' || !tool) return false;
  const name = String(tool).replace(/^mcp__ripper__/, '');
  chat.run.tools ||= [];
  if (chat.run.tools.includes(name)) return false;
  chat.run.tools.push(name);
  return true;
}

/**
 * Depois de um reinício: retomar sozinho? { auto: true, ...trim } | { auto: false, reason, unsafe? }.
 * Só turnos cortados pelo reinício, há pouco tempo, que não fizeram nada com efeito fora do Ripper.
 */
export function canAutoResume(chat, now = Date.now()) {
  const run = chat.run;
  if (run?.status !== 'interrupted' || run.interruptedBy !== 'restart') return { auto: false, reason: 'não foi o reinício' };
  if (now - (run.finishedAt || 0) > AUTO_RESUME_WINDOW_MS) return { auto: false, reason: 'interrompido há muito tempo' };
  const unsafe = (run.tools || []).filter(t => !SAFE_TO_REPEAT.has(t));
  if (unsafe.length) return { auto: false, unsafe, reason: `já tinha feito: ${[...new Set(unsafe.map(t => TOOL_ACTION[t] || (t.startsWith('mcp__') ? 'usar um conector' : t)))].join(', ')}` };
  const check = canResumeChatRun(chat, { streaming: false });
  return check.ok ? { auto: true, ...check } : { auto: false, reason: check.reason };
}

export function canResumeChatRun(chat, { streaming } = {}) {
  if (streaming) return { ok: false, reason: 'Resposta em andamento.' };
  if (chat.run?.status !== 'interrupted') return { ok: false, reason: 'Nenhuma execução interrompida para retomar.' };
  const trim = trimPartialRepliesAfterLastUser(chat);
  if (!trim.ok) return trim;
  if (!trim.text && !(trim.fileIds?.length)) return { ok: false, reason: 'Mensagem do usuário vazia.' };
  return { ok: true, ...trim };
}
