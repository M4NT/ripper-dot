/**
 * Subagente com contexto próprio: conversa filha isolada (histórico vazio),
 * ligada à tarefa do time e à conversa de origem.
 */

export function createIsolatedChildChat({
  db,
  id,
  parentChat,
  agent,
  title,
  now = Date.now()
}) {
  if (!parentChat?.id || !agent?.id) return { error: 'Conversa de origem e agente são obrigatórios.' };
  const child = {
    id: id(),
    agentId: agent.id,
    parentChatId: parentChat.id,
    isolated: true,
    title: String(title || `Subtarefa · ${parentChat.title || agent.name}`).slice(0, 80),
    messages: [],
    createdAt: now,
    updatedAt: now,
    ...(parentChat.projectId ? { projectId: parentChat.projectId } : {})
  };
  db.chats.unshift(child);
  return { ok: true, child };
}

export function isolatedSubagentPrompt({ title, note, ownerName }) {
  const body = String(note || title || '').trim();
  return [
    `[Subtarefa isolada${ownerName ? ` pedida por ${ownerName}` : ''}: ${title}]`,
    body,
    '',
    'Você executa SÓ esta subtarefa, sem o histórico da conversa de origem. Entregue o resultado completo e direto. Não peça confirmação e não invente outras tarefas.'
  ].join('\n');
}

export function descendantChatIds(db, parentId) {
  const out = [];
  const seen = new Set();
  const walk = id => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    for (const c of db.chats || []) {
      if (c.parentChatId === id) {
        out.push(c.id);
        walk(c.id);
      }
    }
  };
  walk(parentId);
  return out;
}
