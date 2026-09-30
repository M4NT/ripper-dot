// Mensagens assíncronas entre agentes (A2A): fila com prioridade, limites e isolamento.

export const PRIORITY = { now: 0, normal: 1, low: 2 };
const WAIT_MS = { now: 0, normal: 5_000, low: 5 * 60_000 }; // quanto cada prioridade espera para acordar o destinatário

/** Valida um envio. Devolve { error } ou { ok: true }. */
export function checkSend({ from, to, messages, hops, limits, now = Date.now() }) {
  if (!to) return { error: 'Destinatário desconhecido. Use o nome exato de um colega.' };
  if (to.id === from.id) return { error: 'Você não pode mandar mensagem para si mesmo.' };
  if (to.status === 'paused') return { error: `${to.name} está pausado e não recebe mensagens agora.` };
  if (hops > limits.maxHops) return { error: `Limite de troca atingido (${limits.maxHops} saltos). Resolva com o que já tem ou peça ao usuário.` };
  const lastHour = messages.filter(m => m.from === from.id && now - m.createdAt < 3_600_000).length;
  if (lastHour >= limits.maxPerHour) return { error: `Limite de ${limits.maxPerHour} mensagens por hora atingido.` };
  return { ok: true };
}

/**
 * Próximas mensagens a entregar: por prioridade, depois por ordem de chegada;
 * no máximo uma por destinatário ocupado (um agente processa uma mensagem por vez).
 */
export function dueMessages(queue, busy, now = Date.now()) {
  const ready = queue
    .filter(m => m.status === 'queued' && now - m.createdAt >= WAIT_MS[m.priority || 'normal'])
    .sort((a, b) => PRIORITY[a.priority || 'normal'] - PRIORITY[b.priority || 'normal'] || a.createdAt - b.createdAt);
  const out = [], taken = new Set(busy);
  for (const m of ready) if (!taken.has(m.to)) { out.push(m); taken.add(m.to); }
  return out;
}

/** Id da conversa que guarda a troca entre dois agentes (a mesma nos dois sentidos). */
export const threadKey = (a, b) => [a, b].sort().join(':');

/** Texto que o destinatário recebe: só a mensagem, nunca a conversa de quem enviou. */
export function inboxPrompt(msg, fromName) {
  return `[Mensagem de ${fromName}${msg.priority === 'now' ? ', urgente' : ''}]\n${msg.body}\n\nResponda de forma direta e completa: a sua resposta volta automaticamente para ${fromName}. Não cumprimente nem repita o pedido.`;
}
