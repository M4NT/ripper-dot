// Gatilhos por evento: rotinas que rodam quando algo acontece (não só no horário).
// WhatsApp: palavras-chave em mensagens de contatos e/ou grupos (grupos só com "Ler grupos" ligado).

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const TRIGGER_COOLDOWN_MS = 60_000; // no máximo 1 disparo por minuto por rotina

/** Palavras-chave da tela ("urgente, orçamento") → lista limpa. */
export function parseKeywords(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(/[,;\n]/);
  return [...new Set(list.map(k => String(k).trim().slice(0, 60)).filter(Boolean))].slice(0, 20);
}

/** A mensagem dispara esta rotina? Sem palavras-chave = toda mensagem do escopo. */
export function whatsappTriggerMatches(r, { text, isGroup, fromMe }, now = Date.now()) {
  if (r.trigger !== 'whatsapp' || r.paused || fromMe) return false;
  const scope = r.scope || 'contacts';
  if (scope !== 'any' && (scope === 'groups') !== !!isGroup) return false;
  if (now - (r.lastRun || 0) < TRIGGER_COOLDOWN_MS) return false;
  return keywordHit(r.keywords, text);
}

/** Palavra inteira, sem acento/maiúscula. Sem palavras-chave = casa tudo. */
function keywordHit(kws = [], text) {
  if (!kws.length) return true;
  const t = ` ${fold(text).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return kws.some(k => t.includes(` ${fold(k).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `));
}

/** E-mail novo dispara esta rotina? Palavras-chave valem para remetente e assunto. */
export function emailTriggerMatches(r, { from, subject }, now = Date.now()) {
  if (r.trigger !== 'email' || r.paused) return false;
  if (now - (r.lastRun || 0) < TRIGGER_COOLDOWN_MS) return false;
  return keywordHit(r.keywords, `${from} ${subject}`);
}
