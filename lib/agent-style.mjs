/** Tom legado + perfil de voz por agente (stylometry leve via system prompt). */

export const STYLE_TONES = ['direto', 'amigavel', 'formal', 'tecnico'];
export const STYLE_FORMALITIES = ['informal', 'neutro', 'formal'];

const TONE_LINES = {
  direto: 'Tom direto e objetivo.',
  amigavel: 'Tom caloroso e próximo.',
  formal: 'Tom formal e cuidadoso.',
  tecnico: 'Tom técnico e preciso.'
};

const FORMALITY_LINES = {
  informal: 'Linguagem casual, como numa conversa entre colegas.',
  neutro: 'Equilíbrio entre proximidade e profissionalismo.',
  formal: 'Tratamento respeitoso e vocabulário cuidadoso.'
};

export function sanitizeStyleFields(raw = {}, prev = {}) {
  const out = { ...prev };
  if (typeof raw.tone === 'string' && STYLE_TONES.includes(raw.tone)) out.tone = raw.tone;
  if (typeof raw.formality === 'string' && STYLE_FORMALITIES.includes(raw.formality)) out.formality = raw.formality;
  if (raw.maxSentences === null || raw.maxSentences === '') delete out.maxSentences;
  else if (raw.maxSentences != null && raw.maxSentences !== '') {
    const n = Math.max(1, Math.min(20, Number(raw.maxSentences)));
    if (Number.isFinite(n)) out.maxSentences = n;
  }
  if (typeof raw.language === 'string') {
    const lang = raw.language.trim().slice(0, 40);
    if (lang) out.language = lang;
    else delete out.language;
  }
  if (typeof raw.customHints === 'string') {
    const hints = raw.customHints.trim().slice(0, 500);
    if (hints) out.customHints = hints;
    else delete out.customHints;
  }
  return out;
}

/** Mescla agente + padrões globais; `agent.tone` legado entra se não houver tom no perfil. */
export function resolveAgentStyle(agent, settings) {
  const defaults = settings?.defaults?.agentStyle || {};
  const own = agent?.style && typeof agent.style === 'object' ? agent.style : {};
  const tone = own.tone || (STYLE_TONES.includes(agent?.tone) ? agent.tone : null) || defaults.tone || 'direto';
  const formality = own.formality || defaults.formality || 'neutro';
  const maxSentences = own.maxSentences ?? defaults.maxSentences;
  const language = own.language || defaults.language || '';
  const customHints = own.customHints || defaults.customHints || '';
  return sanitizeStyleFields({ tone, formality, maxSentences, language, customHints }, {});
}

/** Bloco curto anexado ao system prompt. */
export function agentStyleBlock(style) {
  const s = style;
  const lines = ['## Voz e estilo'];
  if (TONES_LINE(s.tone)) lines.push(TONES_LINE(s.tone));
  if (FORMALITY_LINES[s.formality]) lines.push(FORMALITY_LINES[s.formality]);
  if (s.maxSentences != null) {
    const max = s.maxSentences;
    lines.push(`Limite combinado: até ${max} frase${max === 1 ? '' : 's'}. Estenda se o pedido exigir clareza, um documento ou código completo.`);
  } else {
    lines.push('Tamanho proporcional ao pedido. Econômico sem ser telegráfico: raciocine quando isso ajuda a pessoa a decidir ou a usar o resultado; sem teto de frases e sem cara de formulário.');
  }
  if (s.language) lines.push(`Responda em ${s.language}.`);
  if (s.customHints) lines.push(s.customHints);
  return lines.join('\n');
}

function TONES_LINE(tone) {
  return TONE_LINES[tone] || TONE_LINES.direto;
}
