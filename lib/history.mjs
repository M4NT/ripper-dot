/** Ordenação estável: mais recente primeiro; empate por id (desc). */
export function chatSortKey(chat) {
  const t = chat.updatedAt ?? chat.createdAt ?? 0;
  return { t, id: String(chat.id || '') };
}

export function encodeChatCursor(chat) {
  const { t, id } = chatSortKey(chat);
  return `${t}:${id}`;
}

export function decodeChatCursor(cursor) {
  if (!cursor || typeof cursor !== 'string') return null;
  const idx = cursor.indexOf(':');
  if (idx <= 0) return null;
  const t = +cursor.slice(0, idx);
  const id = cursor.slice(idx + 1);
  if (!id || Number.isNaN(t)) return null;
  return { t, id };
}

function cmpDesc(a, b) {
  if (b.t !== a.t) return b.t - a.t;
  if (b.id === a.id) return 0;
  return b.id < a.id ? -1 : 1;
}

/** Busca honesta: só conversas reais; q casa em título ou conteúdo de mensagens. */
export function chatMatchesQuery(chat, q) {
  if (!q || !String(q).trim()) return true;
  const needle = String(q).trim().toLowerCase();
  if (String(chat.title || '').toLowerCase().includes(needle)) return true;
  for (const m of chat.messages || []) {
    if (String(m.content || '').toLowerCase().includes(needle)) return true;
  }
  return false;
}

export function chatMatchesAgent(chat, agentId) {
  if (!agentId || agentId === 'all') return true;
  const ids = chat.agentIds?.length ? chat.agentIds : [chat.agentId];
  return ids.includes(agentId) || chat.agentId === agentId;
}

/**
 * Lista paginada de conversas (sem inventar resultados).
 * @param {object[]} chats — snapshot do banco
 * @param {{ q?: string, agentId?: string, limit?: number, cursor?: string }} opts
 */
export function listChatsPage(chats, { q, agentId, limit = 30, cursor } = {}) {
  const cap = Math.max(1, Math.min(100, limit | 0 || 30));
  const filtered = (chats || []).filter(c => chatMatchesAgent(c, agentId) && chatMatchesQuery(c, q));
  const sorted = [...filtered].sort((a, b) => cmpDesc(chatSortKey(a), chatSortKey(b)));
  let start = 0;
  const cur = decodeChatCursor(cursor);
  if (cur) {
    start = sorted.findIndex(c => {
      const k = chatSortKey(c);
      return k.t < cur.t || (k.t === cur.t && k.id < cur.id);
    });
    if (start < 0) start = sorted.length;
  }
  const items = sorted.slice(start, start + cap);
  const nextCursor = start + cap < sorted.length && items.length ? encodeChatCursor(items.at(-1)) : null;
  return { items, nextCursor, total: sorted.length };
}
