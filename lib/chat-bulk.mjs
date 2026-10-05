// Conversas em lote: arquivar, desarquivar, etiquetar, tirar etiqueta e apagar várias de uma vez.

/** Etiqueta limpa: minúscula, sem espaços nas pontas, até 24 caracteres. */
export const normalizeTag = t => String(t || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 24);

/**
 * Aplica a ação nas conversas com esses ids. busy(id) = está respondendo agora (não apaga no meio).
 * Devolve { chats, changed, skipped }: chats é a lista nova (sem as apagadas).
 */
export function applyBulk(chats, ids, action, tag, busy = () => false) {
  const want = new Set(ids || []);
  const t = normalizeTag(tag);
  if (['tag', 'untag'].includes(action) && !t) throw new Error('Informe a etiqueta.');
  if (!['archive', 'unarchive', 'tag', 'untag', 'delete'].includes(action)) throw new Error('Ação desconhecida.');
  let changed = 0, skipped = 0;
  const out = [];
  for (const c of chats) {
    if (!want.has(c.id)) { out.push(c); continue; }
    if (action === 'delete') { if (busy(c.id)) { skipped++; out.push(c); } else changed++; continue; }
    if (action === 'archive') c.archived = true;
    if (action === 'unarchive') delete c.archived;
    if (action === 'tag') c.tags = [...new Set([...(c.tags || []), t])].slice(0, 10);
    if (action === 'untag') { c.tags = (c.tags || []).filter(x => x !== t); if (!c.tags.length) delete c.tags; }
    changed++; out.push(c);
  }
  return { chats: out, changed, skipped };
}
