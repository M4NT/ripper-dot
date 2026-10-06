// Um agente = uma conversa: junta as conversas 1:1 de cada agente na mais recente.
// As outras ficam arquivadas com mergedInto (nada é apagado; dá para desfazer).
const isSolo = c => !c.archived && c.agentId && (c.agentIds || []).length <= 1 && !c.projectId && !c.channelKey && !c.channel;

export function mergeAgentChats(db) {
  const byAgent = new Map();
  for (const c of db.chats) if (isSolo(c)) byAgent.set(c.agentId, [...(byAgent.get(c.agentId) || []), c]);
  let merged = 0;
  for (const chats of byAgent.values()) {
    if (chats.length < 2) continue;
    chats.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    const [target, ...rest] = chats;
    if (target.run?.status === 'running') continue; // não mexe numa resposta em andamento
    const seen = new Set((target.messages || []).map(m => m.id));
    const all = [...(target.messages || [])];
    for (const c of rest) {
      for (const m of c.messages || []) if (!m.id || !seen.has(m.id)) { all.push(m); if (m.id) seen.add(m.id); }
      c.archived = true;
      c.mergedInto = target.id;
      for (const x of [...(db.artifacts || []), ...(db.files || [])]) if (x.chatId === c.id) x.chatId = target.id;
      merged++;
    }
    target.messages = all.map((m, i) => ({ m, i })).sort((a, b) => (a.m.at || 0) - (b.m.at || 0) || a.i - b.i).map(x => x.m);
    target.createdAt = Math.min(target.createdAt || Infinity, ...rest.map(c => c.createdAt || Infinity));
  }
  return merged;
}
