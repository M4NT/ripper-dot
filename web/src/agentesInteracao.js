// Funções puras da interação com os agentes (sem React): frases de aprovação, fontes, durações e contexto de erro.
// Ficam fora dos componentes para serem testadas direto no Node.

// ---------- aprovações ----------

// Botões com o verbo do que a ação faz de fato (sim, não). Quem não está aqui fica com Aprovar/Recusar.
const VERBOS = {
  email: ['Enviar e-mail', 'Não enviar'], whatsapp: ['Enviar WhatsApp', 'Não enviar'], exec: ['Permitir comando', 'Não permitir'], command: ['Permitir comando', 'Não permitir'],
  omie: ['Alterar no Omie', 'Não alterar'], social: ['Publicar', 'Não publicar'], share: ['Publicar link', 'Não publicar'], github: ['Publicar no GitHub', 'Não publicar'],
  agent: ['Criar agente', 'Não criar'], flow: ['Continuar', 'Parar aqui'], documento: ['Confirmar aprovação', 'Cancelar'],
  computer: ['Permitir na tela', 'Não permitir']
};
export function verbosDaAprovacao(rec) {
  const [sim, nao] = VERBOS[rec?.kind] || ['Aprovar', 'Recusar'];
  return { sim, nao };
}

/** Frase curta do que vai acontecer; o comando inteiro fica em "Ver detalhe". */
export function fraseDaAprovacao(rec) {
  if (rec.kind === 'exec' || rec.kind === 'command') return 'Rodar um comando no seu computador.';
  if (rec.kind === 'computer') return String(rec.command || 'Usar mouse ou teclado na tela da VM.').split('\n')[0].slice(0, 200);
  if (rec.kind === 'omie') return 'Alterar dados no seu Omie.';
  const linhas = String(rec.command || '').split('\n');
  // E-mail: destinatário e assunto na frase, para ver para quem e o quê antes de enviar (item 38).
  if (rec.kind === 'email') return [linhas[0], linhas.find(x => x.startsWith('Assunto:'))].filter(Boolean).join(' · ').slice(0, 200);
  return linhas[0].slice(0, 200);
}

// ---------- atividades ----------

// Sistema de origem do dado: a linha mostra de onde veio e a hora da consulta (item 30).
const FONTE = { omie: 'Omie', compras: 'Omie', dfe: 'Notas recebidas', nfse: 'Notas recebidas', nfe: 'Notas recebidas' };
export function fonteDoPasso(step) {
  const m = /^(omie|compras|dfe|nfse|nfe)_/.exec(String(step?.tool || ''));
  return m && step.kind === 'tool' ? FONTE[m[1]] : null;
}

/** Duração de uma etapa concluída: "1,2 s", "3 min 4 s" (item 11). */
export function fmtDuracao(ms) {
  if (ms == null || ms < 0) return null;
  if (ms < 1000) return '< 1 s';
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1).replace('.', ',')} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

/** Páginas abertas nesta resposta (pesquisa na web e navegador), sem repetir. Vira a lista de fontes (item 23). */
export function fontesDoPasso(steps) {
  const out = [];
  const vistos = new Set();
  for (const s of steps || []) {
    if (s.kind !== 'tool' || !/^(WebFetch|browser_open)$/.test(s.tool || '') || !/^https?:\/\//.test(s.detail || '')) continue;
    if (vistos.has(s.detail)) continue;
    vistos.add(s.detail);
    let host = s.detail;
    try { host = new URL(s.detail).hostname.replace(/^www\./, ''); } catch { /* endereço malformado: mostra como veio */ }
    out.push({ url: s.detail, host });
  }
  return out;
}

// ---------- erros ----------

/** Hora de Brasília, sem segundos (14:02). */
export const horaCurta = ms => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/** Linha de contexto do erro: hora, etapa em que parou e o que já tinha terminado (itens 39 e 44). */
export function contextoDoErroTexto({ quando, etapa, feitas } = {}) {
  const partes = [];
  if (quando) partes.push(`às ${horaCurta(quando)}`);
  if (etapa) partes.push(`na etapa "${etapa}"`);
  const feito = feitas > 0 ? `${feitas} ${feitas === 1 ? 'ação já tinha terminado' : 'ações já tinham terminado'} antes.` : null;
  return [partes.length ? `Parou ${partes.join(' ')}.` : null, feito].filter(Boolean).join(' ');
}
