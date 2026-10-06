// Mensagens assíncronas entre agentes (A2A): fila com prioridade, limites e isolamento.

export const PRIORITY = { now: 0, normal: 1, low: 2 };
const WAIT_MS = { now: 0, normal: 5_000, low: 5 * 60_000 }; // quanto cada prioridade espera para acordar o destinatário

export const DEFAULT_CALL_TIMEOUT_MS = 120_000;
export const MIN_CALL_TIMEOUT_MS = 5_000;
export const MAX_CALL_TIMEOUT_MS = 300_000;

/** Resolve colega pelo nome exato (com ou sem @). */
export function findAgentByName(name, agents) {
  const q = String(name ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!q) return null;
  return agents.find(a => a.name.toLowerCase() === q) || null;
}

/**
 * RBAC suave: sem `callPeers` no agente = todos os colegas; array = só esses ids;
 * array vazio = ninguém.
 */
export function peerAllowed(from, to) {
  if (!from || !to) return false;
  const list = from.callPeers;
  if (list == null) return true;
  if (!Array.isArray(list)) return true;
  return list.includes(to.id);
}

export function recipientBusyError(toName) {
  return `${toName} está ocupado com outra mensagem ou chamada. Use send_message para pedido assíncrono ou tente de novo em instantes.`;
}

/** Segundos pedidos pelo modelo → ms dentro dos limites da instalação. */
export function clampCallTimeoutMs(seconds, settingsInbox = {}) {
  const fallbackSec = settingsInbox.callTimeoutSeconds ?? DEFAULT_CALL_TIMEOUT_MS / 1000;
  const base = Number(seconds);
  const sec = Number.isFinite(base) && base > 0 ? base : fallbackSec;
  const ms = Math.round(sec * 1000);
  return Math.max(MIN_CALL_TIMEOUT_MS, Math.min(MAX_CALL_TIMEOUT_MS, ms));
}

/** Valida um envio. Devolve { error } ou { ok: true }. */
export function checkSend({ from, to, messages, hops, limits, now = Date.now(), busyToIds = null }) {
  if (!to) return { error: 'Destinatário desconhecido. Use o nome exato de um colega.' };
  if (to.id === from.id) return { error: 'Você não pode mandar mensagem para si mesmo.' };
  if (to.status === 'paused') return { error: `${to.name} está pausado e não recebe mensagens agora.` };
  if (!peerAllowed(from, to)) {
    return { error: `${from.name} não tem permissão para chamar ${to.name}. Peça ao usuário ajustar os colegas permitidos.` };
  }
  if (busyToIds?.has?.(to.id)) return { error: recipientBusyError(to.name) };
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
  return `[Mensagem de ${fromName}${msg.priority === 'now' ? ', urgente' : ''}]\n${msg.body}\n\n${colleagueReplyRules(fromName)}`;
}

/** Como responder a um colega: só o que esta mensagem diz, no tom dela. */
const colleagueReplyRules = fromName => `Sua resposta volta sozinha para ${fromName}. Responda só ao que esta mensagem diz, no mesmo tom: recado ou cumprimento → uma frase curta e natural; pergunta ou pedido → a resposta ou o resultado, direto. Não traga assuntos pendentes de conversas anteriores, não repita o pedido e não explique o que vai fazer.`;

/** Chamada síncrona (call_agent): o colega sabe que a resposta é imediata. */
export function callAgentPrompt(msg, fromName) {
  return `[Chamada síncrona de ${fromName}, aguardando agora]\n${msg.body}\n\n${colleagueReplyRules(fromName)}`;
}

/** Interpreta a última mensagem após um turno de inbox (assíncrono ou síncrono). */
export function interpretInboxReply(messages, lenBeforeTurn) {
  if (!messages?.length || messages.length <= lenBeforeTurn) {
    return { ok: false, error: 'Sem resposta do destinatário.' };
  }
  const reply = messages.at(-1);
  if (reply?.stopped) return { ok: false, error: 'Chamada interrompida antes da resposta.' };
  if (reply?.error) return { ok: false, error: String(reply.error) };
  if (!reply?.content) return { ok: false, error: 'Sem resposta do destinatário.' };
  return { ok: true, content: reply.content, model: reply.model };
}

/** Texto devolvido à ferramenta call_agent. */
export function formatCallAgentResult(result) {
  if (!result.ok) return `Erro ao chamar colega: ${result.error}`;
  return result.content;
}

const MAX_DELIVERY_ATTEMPTS = 3;

/** Após reinício ou falha transitória: reenfileira sem perder mensagens silenciosamente. */
export function repairInboxOnStartup(messages) {
  for (const m of messages || []) {
    if (m.status === 'delivering') m.status = 'queued';
    else if (m.status === 'failed' && (m.attempts || 0) < MAX_DELIVERY_ATTEMPTS) m.status = 'queued';
  }
}

export function markInboxDeliveryFailed(m, error) {
  m.attempts = (m.attempts || 0) + 1;
  m.status = m.attempts >= MAX_DELIVERY_ATTEMPTS ? 'failed' : 'queued';
  m.error = error;
}

/** Resumo para API/UI — só contagens reais da fila. */
export function inboxSummary(messages) {
  const counts = { queued: 0, delivering: 0, delivered: 0, failed: 0 };
  for (const m of messages || []) {
    const s = m.status || 'queued';
    if (counts[s] != null) counts[s]++;
    else counts.queued++;
  }
  return counts;
}

/**
 * Passagem de bastão com contrato fixo (ex.: Omie faturou → Mailcow envia o e-mail).
 * Vai pelo mesmo inbox do send_message (limites, entrega e resposta de volta iguais);
 * o que muda é o corpo: JSON previsível na ida e pedido de JSON na volta.
 */
export const HANDOFF_VERSION = 1;
export function buildHandoff({ from, to, task, done = '', data = {}, expect = '' }) {
  if (!task || !String(task).trim()) throw new Error('handoff precisa de "task".');
  if (data && (typeof data !== 'object' || Array.isArray(data))) throw new Error('"data" deve ser um objeto JSON.');
  const payload = { handoff: HANDOFF_VERSION, from, to, task: String(task).trim(), done: String(done || ''), data: data || {}, expect: String(expect || '') };
  const body = [
    'Passagem de bastão (handoff). Contrato:',
    '```json', JSON.stringify(payload, null, 2), '```',
    'Execute "task" usando "data". Termine com um bloco JSON no formato:',
    '```json\n{"handoff":1,"status":"done|blocked","result":{},"summary":"uma frase"}\n```'
  ].join('\n');
  return { payload, body };
}

