/** Arquivo que o agente pode usar: o dele, o do projeto da conversa ou um marcado "do time" (ex.: logo e paleta da marca). */
export function canUseFile(file, agent, chat) {
  return file.agentId === agent.id || Boolean(file.projectId && file.projectId === chat?.projectId) || file.team === true;
}

export function groupMembers(chat, agents) {
  return (chat.agentIds || [chat.agentId]).map(id => agents.find(a => a.id === id)).filter(Boolean);
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fold = s => String(s).normalize('NFD').replace(/̀-ͯ/g, '').toLowerCase();

/** Formas aceitas de chamar o agente: nome, apelido, nome sem "(...)", o que está entre parênteses e cada palavra do nome (≥ 4 letras). */
function aliases(a) {
  const bare = String(a.name || '').replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  const exact = [a.name, a.nickname, bare, a.name?.match(/\(([^)]+)\)/)?.[1]].filter(Boolean);
  const words = bare.split(/\s+/).filter(w => w.length >= 4);
  return [...exact.map(n => [fold(n), 1]), ...words.map(w => [fold(w), 0])];
}

/** Para cada "@" do texto: o(s) agente(s) com o casamento mais longo (forma exata desempata palavra solta). */
function mentionHits(text, members) {
  const t = String(text || '');
  const out = [];
  for (let i = t.indexOf('@'); i >= 0; i = t.indexOf('@', i + 1)) {
    const rest = fold(t.slice(i + 1, i + 81));
    let best = 0, who = [], word = '';
    for (const a of members) {
      let score = 0, w = '';
      for (const [n, exact] of aliases(a)) {
        if (!rest.startsWith(n) || /[\w]/.test(rest[n.length] || '')) continue;
        const sc = n.length * 2 + exact;
        if (sc > score) { score = sc; w = n; }
      }
      if (!score) continue;
      if (score > best) { best = score; who = [a]; word = w; }
      else if (score === best) who.push(a);
    }
    if (who.length) out.push({ index: i, mention: '@' + t.slice(i + 1, i + 1 + word.length), agents: who });
  }
  return out;
}

/** Agentes citados com @Nome, @Apelido ou parte do nome, na ordem do texto (cada um uma vez). Menção ambígua não chama ninguém. */
export function mentionOrder(text, members) {
  const seen = new Set();
  return mentionHits(text, members).filter(h => h.agents.length === 1).map(h => h.agents[0])
    .filter(a => !seen.has(a.id) && seen.add(a.id));
}

/** Menções que servem para mais de um agente (ex.: "@Engenheiro" com dois engenheiros): o agente pergunta em vez de chutar. */
export function ambiguousMentions(text, members) {
  return mentionHits(text, members).filter(h => h.agents.length > 1).map(h => ({ mention: h.mention, agents: h.agents }));
}

/** Só confirmação de colega ("ok", "recebido", "valeu", 👍): encerra a troca, sem turno. */
export function isAck(text) {
  const t = fold(text).replace(/@\S+/g, ' ').replace(/[\p{Extended_Pictographic}️‍]/gu, ' ').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return /\p{Extended_Pictographic}/u.test(String(text || ''));
  return /^((ok|okay|okey|blz|beleza|certo|recebido|recebida|entendido|anotado|combinado|perfeito|show|otimo|valeu|vlw|obrigad[oa]|brigad[oa]|grato|grata|thanks|thank you|fechado|feito|de nada|tmj|top|massa|joia|legal|sim|pode deixar)\s*){1,4}$/.test(t);
}


/**
 * Chamado pelo nome sem @, como vocativo: "consegue resolver, ripper?", "Donald, veja isso".
 * Só no começo/fim da frase ou entre vírgulas — "a plataforma Ripper" no meio do texto não chama ninguém.
 */
export function addressedByName(text, members) {
  const t = fold(text);
  const hits = [];
  for (const a of members) {
    const at = [a.name, a.nickname].filter(Boolean).flatMap(n => {
      const w = esc(fold(n));
      // começo da mensagem · fim da mensagem · entre vírgulas
      return [new RegExp('^\\s*' + w + '(?![\\w])'), new RegExp('(?:^|[\\s,;:])' + w + '[\\s,;:.!?]*$'), new RegExp(',\\s*' + w + '\\s*[,;:.!?]')]
        .map(re => re.exec(t)?.index).filter(i => i != null);
    });
    if (at.length) hits.push([Math.min(...at), a]);
  }
  return hits.sort((x, y) => x[0] - y[0]).map(h => h[1]);
}

/**
 * Quem abre a rodada. Com @menções: os citados, na ordem do texto.
 * Sem menção: só UM agente, o que o classificador (Julia 1) achar mais adequado.
 */
export async function selectSpeakers(chat, text, agents, classify) {
  const members = groupMembers(chat, agents);
  if (members.length < 2) return members;
  const named = mentionOrder(text, members);
  if (named.length) return named;
  const called = addressedByName(text, members);
  if (called.length) return called;
  const best = classify ? await classify(text, members) : null;
  return [best || members[0]];
}

/** Resposta de quem não tem nada a acrescentar: não aparece no chat. */
export const isPass = text => /^\s*\[?PASSO\]?\.?\s*$/i.test(text || '');

/**
 * Fila da rodada. Depois de cada fala, quem foi delegado com @Nome entra na fila.
 * Um agente pode voltar a falar se for chamado de novo depois da sua última fala.
 */
export class Floor {
  constructor(first, members, maxTurns = 5) {
    this.queue = [...first];
    this.members = members;
    this.maxTurns = maxTurns;
    this.turns = 0;
  }
  next() {
    if (this.turns >= this.maxTurns) return null;
    const a = this.queue.shift();
    if (a) this.turns++;
    return a || null;
  }
  afterReply(speaker, reply, { allowPeer = () => true } = {}) {
    if (isPass(reply) || isAck(reply)) return [];
    const added = [];
    for (const a of mentionOrder(reply, this.members)) {
      if (a.id === speaker.id || this.queue.some(q => q.id === a.id)) continue;
      if (!allowPeer(a)) continue;
      this.queue.push(a); added.push(a);
    }
    return added;
  }
  /** Próximos na fila (somente leitura) — útil para telemetria de handoff. */
  peek() {
    return [...this.queue];
  }
}

/**
 * Delegações de uma fala: para cada colega citado com @Nome, a frase onde ele aparece
 * (sem a menção), encurtada para até 80 caracteres. Ex.: "Ana → Bruno: pesquisar preços".
 */
export function delegationTasks(text, peers) {
  const sentences = String(text || '').split(/(?<=[.!?])\s+|\n+/);
  return peers.map(a => {
    const re = new RegExp('@' + esc(a.name) + '(?![\\wÀ-ú])', 'i');
    const s = sentences.find(x => re.test(x)) || '';
    let task = s.replace(re, '').replace(/[*_`#>]/g, '').replace(/^[\s,:;—–-]+|[\s,:;—–-]+$/g, '').replace(/\s+/g, ' ');
    if (task.length > 80) task = task.slice(0, 79).trimEnd() + '…';
    return { to: a.id, task };
  });
}

/** Pedido a um colega em uma linha (cartão "Pedi ao Donald: …"). */
export function oneLineTask(body, max = 80) {
  const t = String(body || '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

/**
 * Estado do cartão de delegação no fio de quem pediu.
 * d: { to, messageId? } · messages: da conversa · inbox: { [messageId]: { status, error?, reply? } } · liveAgentId: quem fala agora.
 * Volta { status: 'aguardando'|'trabalhando'|'feito'|'falhou', result? }.
 */
export function delegationCardState(d, messages = [], inbox = {}, liveAgentId = null) {
  if (d.messageId) {
    const r = messages.find(m => m.via?.type === 'inbox' && m.via.messageId === d.messageId);
    if (r) return { status: 'feito', result: r.content };
    const st = inbox[d.messageId];
    if (st?.status === 'failed') return { status: 'falhou', result: st.error };
    if (st?.status === 'delivered') return { status: 'feito', result: st.reply };
    return { status: st?.status === 'delivering' ? 'trabalhando' : 'aguardando' };
  }
  // @menção no grupo: o colega responde logo abaixo, na mesma conversa
  if (liveAgentId === d.to) return { status: 'trabalhando' };
  const i = messages.findIndex(m => m.delegations?.includes(d));
  return i >= 0 && messages.slice(i + 1).some(m => m.role === 'assistant' && m.agentId === d.to) ? { status: 'feito' } : { status: 'aguardando' };
}

/**
 * A resposta final diz que o agente parou esperando o dono? (rede de segurança quando ele não usou ask_owner)
 * Volta a frase do bloqueio, ou null. ponytail: frases fixas; trocar por classificador se aparecerem falsos positivos.
 */
const BLOCKED_RE = /(preciso que voc[eê]|depende de voc[eê]|dependo de voc[eê]|\bbloquead[oa]\b|n[aã]o consigo (continuar|seguir) sem|aguardando (a )?sua (resposta|aprova[cç][aã]o|decis[aã]o))/i;
export function ownerBlockedReason(text) {
  const s = String(text || '');
  if (!BLOCKED_RE.test(s)) return null;
  return oneLineTask(s.split(/(?<=[.!?])\s+|\n+/).find(x => BLOCKED_RE.test(x)), 300);
}

/** IDs dos agentes previstos na rodada (ordem de fala, sem duplicar). */
export function turnPlanIds(firstSpeakers, floor) {
  const ids = [];
  const seen = new Set();
  for (const a of [...firstSpeakers, ...(floor?.peek?.() || [])]) {
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id);
    ids.push(a.id);
  }
  return ids;
}

const plain = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Intenções comuns: palavras do pedido → sinais na função do agente.
const INTENTS = [
  [/\b(slogan|texto|poema|post|legenda|copy|email|e-mail|frase|titulo|roteiro|artigo|redacao|escrev\w*|revis\w*)\b/, /escrev|redat|texto|conteud|copy|poem/],
  [/\b(estrategi\w*|posicionamento|plano|publico|campanha|marca|mensagem|angulo|prioriz\w*)\b/, /estrat|posicion|mensagem|marca|campanh/],
  [/\b(dados|planilha|numeros|grafico|metric\w*|analis\w*|relatorio|csv)\b/, /dado|analis|planilh|metric|insight/],
  [/\b(codigo|bug|erro|deploy|script|api|programa\w*|terminal|instal\w*)\b/, /codig|software|engenh|dev|program/],
  [/\b(pesquis\w*|fonte|noticia|mercado|concorren\w*)\b/, /pesquis|mercado|fonte|web/],
  [/\b(cliente|atendimento|suporte|reclamac\w*|duvida)\b/, /atend|client|suporte/],
  [/\b(lead|venda\w*|proposta|prospec\w*|comercial)\b/, /venda|lead|comercial|prospec/]
];

/** Heurística de escolha de falante (sem Julia): intenção do pedido + palavras x função de cada agente. */
export function heuristicSpeaker(text, members) {
  const t = plain(text);
  const words = new Set(t.match(/[a-z]{4,}/g) || []);
  let best = members[0], bestScore = 0;
  for (const a of members) {
    const bag = plain(`${a.name} ${a.description || ''} ${a.category || ''} ${a.instructions || ''}`);
    let score = [...words].filter(w => bag.includes(w.slice(0, 5))).length;
    for (const [ask, role] of INTENTS) if (ask.test(t) && role.test(bag)) score += 3;
    if (score > bestScore) { best = a; bestScore = score; }
  }
  return best;
}

export function routineDue(routine, now) {
  if (routine.trigger) return false; // webhook, WhatsApp…: só acorda com evento
  const time = now.getTime();
  if (routine.everyMinutes) return time - routine.lastRun >= routine.everyMinutes * 60_000;
  return routine.dailyAt === now.toTimeString().slice(0, 5)
    && (routine.weekday == null || routine.weekday === now.getDay())
    && (!routine.weekdays || (now.getDay() >= 1 && now.getDay() <= 5))
    && time - routine.lastRun > 60_000;
}

export function mayFallback(streamedText, isLastAttempt) {
  return !streamedText && !isLastAttempt;
}

/** Histórico enxuto: últimas N mensagens, cada uma cortada. Economiza tokens em conversas longas. */
export function trimHistory(messages, { keep = 12, maxChars = 1500 } = {}) {
  return messages.slice(-keep).map(m => m.content && m.content.length > maxChars
    ? { ...m, content: m.content.slice(0, maxChars) + ' […]' } : m);
}

/** Índice da pergunta do usuário que abre a rodada (ignora mensagens de inbox A2A). */
export function lastUserTurnIndex(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && !m.inbox) return i;
  }
  return messages.findLastIndex(m => m.role === 'user');
}

/** Em grupo, falas de colegas entram como “usuário” rotulado para o modelo certo enxergar quem falou. */
export function labelMessageForAgent(m, viewerAgentId, nameForId, { group } = {}) {
  if (m.role === 'assistant' && m.agentId && m.agentId !== viewerAgentId) {
    return { role: 'user', content: `[${nameForId(m.agentId)} disse]: ${m.content}` };
  }
  if (group && m.role === 'assistant' && !m.agentId) {
    return { role: 'user', content: `[Colega disse]: ${m.content}` };
  }
  return m;
}

/** Resposta de rotina sem novidade: a conversa é descartada, sem notificar. */
export const isNothingNew = text => /^\s*\[?NADA[_ ]NOVO\]?\.?\s*$/i.test(text || '');

/** Prompt da rotina: instrução de silêncio + (quando houver) o evento que a acordou. */
export function routinePrompt(routine, event) {
  const parts = [routine.prompt];
  if (event) parts.push(`Evento recebido (${event.source || 'webhook'}${event.type ? `, ${event.type}` : ''}):\n${event.body}`);
  if (routine.quiet !== false) parts.push('Se não houver nada novo ou relevante para o usuário, responda exatamente: NADA_NOVO');
  return parts.join('\n\n');
}

/** Resumo do corpo de um webhook: JSON indentado e cortado (evento grande não estoura tokens). */
export function summarizeEvent(raw, max = 4000) {
  let text = raw;
  try { text = JSON.stringify(JSON.parse(raw), null, 1); } catch {}
  return text.length > max ? text.slice(0, max) + '\n[… cortado]' : text;
}

/**
 * Memória em níveis: perfil (estável) entra inteiro; registro (datado) entra só o mais recente.
 * Memórias antigas sem nível contam como perfil.
 */
export function memoryContext(memories, logLimit = 10) {
  const profile = memories.filter(m => (m.tier || 'profile') === 'profile');
  const log = memories.filter(m => m.tier === 'log').sort((a, b) => b.createdAt - a.createdAt).slice(0, logLimit).reverse();
  const day = t => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const parts = [];
  if (profile.length) parts.push('Perfil do usuário (fatos estáveis):\n' + profile.map(m => '- ' + m.text).join('\n'));
  if (log.length) parts.push('Registro recente (datado):\n' + log.map(m => `- [${day(m.createdAt)}] ${m.text}`).join('\n'));
  return parts.join('\n\n');
}

/**
 * Memória repetida (mesmo texto ou quase: 80%+ das palavras de uma já guardada).
 * ponytail: sobreposição de palavras; trocar por embeddings se deixar passar paráfrases.
 */
export function isDuplicateMemory(text, memories = []) {
  const w = s => new Set(String(s).toLowerCase().match(/[\p{L}\d]{3,}/gu) || []);
  const a = w(text);
  if (!a.size) return true;
  return memories.some(m => {
    const b = w(m.text);
    const common = [...a].filter(x => b.has(x)).length;
    return common / Math.max(a.size, b.size) >= 0.8;
  });
}
