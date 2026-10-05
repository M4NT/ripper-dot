/** Editar e reenviar + busca na conversa (puro: servidor e web importam). */

/** Corta a conversa a partir de uma mensagem do usuário (ela inclusive). Arquivos ficam. */
export function truncateChatFrom(chat, messageId) {
  if (chat?.flowRun) return { ok: false, reason: 'Conversas de fluxo não podem ser editadas.' };
  const at = (chat?.messages || []).findIndex(m => m.id === messageId);
  const m = chat?.messages?.[at];
  if (!m || m.role !== 'user' || m.inbox) return { ok: false, reason: 'Mensagem não encontrada.' };
  const removed = chat.messages.length - at;
  chat.messages = chat.messages.slice(0, at);
  delete chat.run;
  return { ok: true, removed };
}

/** Índices das mensagens cujo texto contém q (sem diferenciar maiúsculas/acentos). */
export function findChatMatches(messages, q) {
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const needle = norm(q).trim();
  if (!needle) return [];
  return (messages || []).flatMap((m, i) => norm(m.content).includes(needle) ? [i] : []);
}
