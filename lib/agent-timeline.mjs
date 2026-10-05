// Linha do tempo do agente: o que ele respondeu/fez, com tempo e custo. Puro, O(mensagens).

/** → { entries: [{ at, chatId, chatTitle, kind, actions, files, ms, model, costUsd, error? }] (mais nova primeiro), summary } */
export function agentTimeline(db, agentId, { since = 0, limit = 200, maxChats = 300 } = {}) {
  const chats = (db.chats || [])
    .filter(c => (c.updatedAt ?? c.createdAt ?? Infinity) >= since)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, maxChats); // ponytail: só as conversas mais recentes; paginar se precisarem de mais
  const entries = [];
  for (const c of chats) for (const m of c.messages || []) {
    if (m.role !== 'assistant' || m.agentId !== agentId || !(m.at >= since)) continue;
    entries.push({
      at: m.at, chatId: c.id, chatTitle: c.title || 'Conversa',
      kind: m.error ? 'error' : c.flowRun ? 'flow' : c.routineId ? 'routine' : 'reply',
      actions: (m.steps || []).filter(s => s.tool).map(s => s.tool),
      files: m.files?.length || 0, ms: m.timing?.totalMs ?? null, model: m.model || null,
      costUsd: Number(m.costUsd ?? m.cost) || 0,
      ...(m.error ? { error: String(typeof m.error === 'string' ? m.error : m.content || '').slice(0, 200) } : {})
    });
  }
  entries.sort((a, b) => b.at - a.at);
  const errors = entries.filter(e => e.kind === 'error').length;
  const timed = entries.filter(e => e.ms != null);
  const summary = {
    replies: entries.length - errors, errors,
    actions: entries.reduce((n, e) => n + e.actions.length, 0),
    costUsd: entries.reduce((n, e) => n + e.costUsd, 0),
    avgMs: timed.length ? Math.round(timed.reduce((n, e) => n + e.ms, 0) / timed.length) : null
  };
  return { entries: entries.slice(0, limit), summary };
}
