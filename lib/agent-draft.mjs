// Criar agente em 1 frase: "um agente que responde clientes no WhatsApp" → nome, função, instruções,
// habilidades e extras sugeridos. O modelo econômico propõe; o usuário revisa antes de criar.
import { TOOLS } from './store.mjs';
import { CATEGORIES } from './templates.mjs';
import { z } from 'zod';

export const DRAFT_SYSTEM = `Você configura agentes de IA do Ripper a partir de uma frase do usuário.
Responda SÓ com um JSON, sem texto em volta:
{"name": "nome curto e humano (1-2 palavras)", "description": "o que ele faz, numa frase", "category": um de ${JSON.stringify(CATEGORIES)},
 "instructions": "instruções de trabalho em português, 4 a 8 linhas, diretas e práticas",
 "tone": "direto" | "amigavel" | "formal" | "tecnico",
 "tools": subconjunto de ${JSON.stringify(TOOLS)} (web=pesquisar, computer=computador próprio para arquivos/código, browser=navegador para sites, memory=memória, routines=agendar, files=ler anexos, plugins=conectores como Gmail/Agenda, social=publicar),
 "whatsapp": true se ele deve atender o WhatsApp do usuário,
 "routine": null ou {"dailyAt": "HH:MM", "weekday": null (todo dia) ou 0-6 (0=domingo, 1=segunda…), "prompt": "o que fazer"} se a frase pedir algo recorrente}
Use só as ferramentas que a função precisa.`;

const TONES = ['direto', 'amigavel', 'formal', 'tecnico'];
// Contrato estrito do JSON do modelo (validado antes das correções determinísticas do sanitizeDraft).
export const DRAFT_SCHEMA = z.object({
  name: z.string().min(1),
  description: z.string(),
  category: z.enum(CATEGORIES),
  instructions: z.string().min(1),
  tone: z.enum(TONES),
  tools: z.array(z.enum(TOOLS)),
  whatsapp: z.boolean(),
  routine: z.object({
    dailyAt: z.string().regex(/^\d\d:\d\d$/, 'use HH:MM'),
    weekday: z.number().int().min(0).max(6).nullable().optional(),
    prompt: z.string().min(1)
  }).nullable()
});
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

/** Valida o JSON do modelo (ou da heurística). Campos ruins viram padrão; nada fora da lista passa. */
export function sanitizeDraft(raw, sentence = '') {
  let j = raw;
  if (typeof raw === 'string') {
    const m = /\{[\s\S]*\}/.exec(raw);
    try { j = m ? JSON.parse(m[0]) : null; } catch { j = null; }
  }
  if (!j || typeof j !== 'object') return null;
  let tools = [...new Set((Array.isArray(j.tools) ? j.tools : []).filter(t => TOOLS.includes(t)))];
  // o modelo às vezes marca "social" (publicar em redes) sem a frase pedir: só fica se pedir mesmo
  if (!/post|publica|instagram|linkedin|rede social|tiktok/i.test(sentence)) tools = tools.filter(t => t !== 'social');
  // gerar planilha/documento exige o computador do agente
  if (/planilha|excel|pdf|relat[oó]rio|documento|word|slides|apresenta/i.test(sentence) && !tools.includes('computer')) tools.push('computer');
  const r = j.routine && /^\d\d:\d\d$/.test(j.routine.dailyAt) && clip(j.routine.prompt, 500) ? { dailyAt: j.routine.dailyAt, prompt: clip(j.routine.prompt, 500), ...(Number.isInteger(j.routine.weekday) && j.routine.weekday >= 0 && j.routine.weekday <= 6 ? { weekday: j.routine.weekday } : {}) } : null;
  return {
    name: clip(j.name, 40) || 'Novo agente',
    description: clip(j.description, 200) || clip(sentence, 200),
    category: CATEGORIES.includes(j.category) ? j.category : 'Outro',
    instructions: clip(j.instructions, 4000),
    tone: TONES.includes(j.tone) ? j.tone : 'direto',
    tools: [...new Set([...(tools.length ? tools : ['web', 'memory', 'files']), ...(r ? ['routines'] : [])])], // rotina sugerida precisa da habilidade
    whatsapp: j.whatsapp === true,
    routine: r
  };
}

/** Sem modelo disponível: palavras da frase escolhem habilidades e extras. */
export function heuristicDraft(sentence) {
  const t = String(sentence).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const has = re => re.test(t);
  const tools = ['memory', 'files'];
  if (has(/pesquis|noticia|web|internet|concorr|tendenc/)) tools.push('web');
  if (has(/planilha|excel|relatorio|arquivo|codigo|script|pdf|documento/)) tools.push('computer');
  if (has(/site|navega|formulario|login|preencher/)) tools.push('browser', 'computer');
  if (has(/agenda|gmail|e-?mail|drive|calendario/)) tools.push('plugins');
  if (has(/todo dia|toda manha|diari|semanal|toda semana/)) tools.push('routines');
  if (has(/post|instagram|linkedin|publica/)) tools.push('social');
  const category = has(/cliente|atend|suporte|whatsapp/) ? 'Atendimento' : has(/venda|lead|proposta/) ? 'Vendas' : has(/post|marketing|conteudo|instagram/) ? 'Marketing' : has(/pesquis/) ? 'Pesquisa' : has(/planilha|dados|relatorio/) ? 'Dados' : 'Outro';
  const hour = /(\d{1,2})\s*h/.exec(t)?.[1];
  return sanitizeDraft({
    name: { Atendimento: 'Atendente', Vendas: 'Vendedor', Marketing: 'Criador', Pesquisa: 'Pesquisador', Dados: 'Analista' }[category] || 'Assistente',
    description: sentence, category, tools, tone: 'direto',
    instructions: `Sua função: ${sentence}\nSeja direto e prático. Quando faltar informação, pergunte antes de agir.`,
    whatsapp: has(/whatsapp/),
    routine: has(/todo dia|toda manha|diari|toda (segunda|terca|quarta|quinta|sexta|sabado)|todo (sabado|domingo)/) ? {
      dailyAt: `${String(hour ? Math.min(23, +hour) : 8).padStart(2, '0')}:00`, prompt: sentence,
      weekday: ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'].findIndex(d => t.includes(`toda ${d}`) || t.includes(`todo ${d}`))
    } : null
  }, sentence);
}
