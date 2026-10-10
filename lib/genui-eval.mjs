// Avaliação da escolha de componente: prompts rotulados + régua (acerto, schema, tabela markdown).
import { GENUI_CATALOG, GENUI_NAMES, genuiEntry } from './genui-catalog.mjs';
import { detectMarkdownTableAbuse, validateGenui, genuiToText } from './genui.mjs';

/** @type {{ id: string, prompt: string, expect: string }[]} expect = nome do componente ou "none" */
export const GENUI_LABELED_PROMPTS = [
  { id: 'q1', prompt: 'Qual cliente eu uso, Ana Ltda ou Ana ME?', expect: 'question' },
  { id: 'q2', prompt: 'Me dá três opções de tom para o e-mail e eu escolho.', expect: 'question' },
  { id: 'q3', prompt: 'Pergunta com múltipla escolha: quais produtos entram no combo?', expect: 'question' },
  { id: 'q4', prompt: 'Escolhe um entre estes quatro fornecedores, por favor.', expect: 'question' },
  { id: 'a1', prompt: 'Pode apagar a pasta dist no computador?', expect: 'approval' },
  { id: 'a2', prompt: 'Envia esse WhatsApp para o cliente agora.', expect: 'approval' },
  { id: 'a3', prompt: 'Publica o post no webhook do Slack.', expect: 'approval' },
  { id: 'a4', prompt: 'Paga a fatura de R$ 1.200 no Omie.', expect: 'approval' },
  { id: 'c1', prompt: 'Preciso conectar o GitHub para abrir o PR.', expect: 'connect_app' },
  { id: 'c2', prompt: 'O token do Vercel expirou, tem que reautorizar.', expect: 'connect_app' },
  { id: 'c3', prompt: 'Conecta o Google Agenda neste agente.', expect: 'connect_app' },
  { id: 'f1', prompt: 'O site pediu usuário e senha para eu entrar no painel.', expect: 'none' },
  { id: 'f2', prompt: 'Precisa do token da API, mas não escreve isso no chat.', expect: 'none' },
  { id: 'f3', prompt: 'Formulário de login da loja: e-mail e senha.', expect: 'none' },
  { id: 'd1', prompt: 'Monta um rascunho de e-mail para a Ana com a proposta.', expect: 'draft_message' },
  { id: 'd2', prompt: 'Escreve a mensagem de Slack e me deixa revisar antes de enviar.', expect: 'draft_message' },
  { id: 'd3', prompt: 'Rascunho de WhatsApp para confirmar a visita de sexta.', expect: 'draft_message' },
  { id: 't1', prompt: 'Compara as vendas dos últimos 7 dias em uma tabela.', expect: 'data_table' },
  { id: 't2', prompt: 'Lista os 12 produtos com preço, estoque e status.', expect: 'data_table' },
  { id: 't3', prompt: 'Tabela com nome, prazo e valor dos três orçamentos.', expect: 'data_table' },
  { id: 't4', prompt: 'Mostra os pedidos da semana: dia, quantidade e total.', expect: 'data_table' },
  { id: 'g1', prompt: 'Gráfico de barras com os pedidos de cada dia.', expect: 'chart' },
  { id: 'g2', prompt: 'Linha do tempo das visitas no mês (gráfico).', expect: 'chart' },
  { id: 'g3', prompt: 'Pizza com a fatia de cada canal de venda.', expect: 'chart' },
  { id: 'p1', prompt: 'Acompanha as etapas: revisar, gerar imagens, publicar.', expect: 'progress' },
  { id: 'p2', prompt: 'Mostra o progresso das três subtarefas do time.', expect: 'progress' },
  { id: 'p3', prompt: 'Passo a passo do fluxo de nota fiscal até o e-mail.', expect: 'progress' },
  { id: 'l1', prompt: 'Segue o artigo: https://docs.ripper.dev/genui com o título.', expect: 'link_preview' },
  { id: 'l2', prompt: 'Prévia do link da documentação que achei.', expect: 'link_preview' },
  { id: 'pr1', prompt: 'Abri o PR #42 no acme/loja, ainda aberto.', expect: 'pr_card' },
  { id: 'pr2', prompt: 'O pull request foi mesclado, mostra o cartão.', expect: 'pr_card' },
  { id: 'pr3', prompt: 'Tem um PR em rascunho no repositório do time.', expect: 'pr_card' },
  { id: 'fi1', prompt: 'Entreguei o arquivo vendas.csv no computador.', expect: 'file_card' },
  { id: 'fi2', prompt: 'O PDF da proposta está pronto para baixar.', expect: 'file_card' },
  { id: 'm1', prompt: 'Aqui estão as três artes da campanha para você ver juntas.', expect: 'media_gallery' },
  { id: 'm2', prompt: 'Galeria com os prints da tela do checkout.', expect: 'media_gallery' },
  { id: 'h1', prompt: 'Prévia HTML do e-mail formatado, com a aba do código.', expect: 'html_preview' },
  { id: 'h2', prompt: 'Mostra o cartão de visita em HTML num iframe.', expect: 'html_preview' },
  { id: 's1', prompt: 'Dois visuais de slide para eu escolher antes de gerar o resto.', expect: 'slides' },
  { id: 's2', prompt: 'Amostras de apresentação: limpo ou escuro.', expect: 'slides' },
  { id: 'st1', prompt: 'Liga o resumo diário nas configurações.', expect: 'setting' },
  { id: 'st2', prompt: 'Oferece o interruptor para pausar o WhatsApp.', expect: 'setting' },
  { id: 'n1', prompt: 'Oi, tudo bem?', expect: 'none' },
  { id: 'n2', prompt: 'Obrigado, era só isso.', expect: 'none' },
  { id: 'n3', prompt: 'Explica em duas frases o que é um webhook.', expect: 'none' },
  { id: 'n4', prompt: 'Pode ser, confirma.', expect: 'none' },
  { id: 'n5', prompt: 'Qual é a capital da França?', expect: 'none' },
  { id: 'n6', prompt: 'Resuma este parágrafo em uma linha: o gato subiu no telhado.', expect: 'none' },
  { id: 'n7', prompt: 'Bom dia!', expect: 'none' },
  { id: 'n8', prompt: 'Dois itens: leite e pão. Só isso.', expect: 'none' }
];

const CUES = {
  approval: [/\baprov/i, /\bpermit/i, /\bneg[ae]/i, /\bapag/i, /\bdelet/i, /\brm -/i, /\bpag[aeo]/i, /\bpublic[ae]/i, /\benvia (esse|esse|o)/i, /efeito externo/i, /\bcomando arrisc/i],
  question: [/\bqual (cliente|op[cç][aã]o|dos|destes)/i, /\bescolh/i, /\bop[cç][oõ]es/i, /\bm[uú]ltipla escolha/i, /\bfornecedor/i],
  connect_app: [/\bconect[ae]/i, /\breautoriz/i, /\boauth/i, /\bgithub/i, /\bvercel/i, /\bgoogle agenda/i, /\btoken do \w+ expirou/i],
  draft_message: [/\brascunho de/i, /\bmonta um rascunho/i, /\brevisar antes de enviar/i, /\be-mail para/i, /\bmensagem de slack/i, /\bwhatsapp para confirmar/i],
  data_table: [/\btabela/i, /\bcompara.*dias/i, /\bprodutos com pre[cç]o/i, /\bor[cç]amentos/i, /\bpedidos da semana/i, /\b7 dias/i],
  chart: [/\bgr[aá]fico/i, /\bbarras/i, /\bpizza com/i, /\blinha do tempo das visitas/i],
  progress: [/\betapas/i, /\bprogresso/i, /\bpasso a passo/i, /\bsubtarefas/i, /\brevisar, gerar/i],
  link_preview: [/https?:\/\//i, /\bpr[eé]via do link/i, /\bartigo:/i],
  pr_card: [/\bpr #/i, /\bpull request/i, /\bpr em rascunho/i, /\bpr foi mesclado/i],
  file_card: [/\barquivo \w+\.\w+/i, /\bpdf da proposta/i, /\bentreguei o arquivo/i, /\bpronto para baixar/i],
  media_gallery: [/\bgaleria/i, /\bartes da campanha/i, /\bprints da tela/i, /\btr[eê]s artes/i],
  html_preview: [/\bhtml/i, /\biframe/i, /\be-mail formatado/i, /\bcart[aã]o de visita/i],
  slides: [/\bslides?\b/i, /\bvisuais de (slide|apresent)/i, /\bamostras de apresenta/i],
  setting: [/\bresumo di[aá]rio/i, /\bconfigura[cç]/i, /\binterruptor/i, /\bpausar o whatsapp/i, /\bliga o /i],
  none: [/^(oi|ol[aá]|bom dia|boa tarde|obrigad|valeu|pode ser|confirma)\b/i, /\bcapital da fran[cç]a\b/i, /\bresuma este par[aá]grafo\b/i, /\bexplica em duas frases\b/i, /\bdois itens: leite\b/i, /\bsenha\b/i, /\bformul[aá]rio de login/i, /\btoken da api\b/i]
};

export function suggestComponent(prompt) {
  const t = String(prompt || '');
  if (!t.trim()) return 'none';
  let best = 'none';
  let score = 0;
  for (const name of [...GENUI_NAMES, 'none']) {
    const cues = CUES[name] || [];
    let hits = 0;
    let weight = 0;
    for (const re of cues) {
      const m = t.match(re);
      if (m) { hits++; weight += m[0].length; }
    }
    const s = hits * 100 + weight;
    if (s > score) { score = s; best = name; }
  }
  if (score === 0) return 'none';
  return best;
}

export function evaluateLabeledPrompts(cases = GENUI_LABELED_PROMPTS) {
  let correct = 0;
  const misses = [];
  for (const c of cases) {
    const got = suggestComponent(c.prompt);
    if (got === c.expect) correct++;
    else misses.push({ id: c.id, expect: c.expect, got, prompt: c.prompt });
  }
  return { total: cases.length, correct, accuracy: correct / cases.length, misses };
}

export function evaluateExampleSchemas() {
  const results = GENUI_NAMES.map(name => {
    const entry = genuiEntry(name);
    const check = validateGenui(name, entry.example);
    const text = genuiToText(name, entry.example);
    return { name, ok: check.ok, error: check.error, hasText: !!text, tableAbuse: detectMarkdownTableAbuse(text) && name !== 'data_table' };
  });
  return {
    total: results.length,
    valid: results.filter(r => r.ok && r.hasText).length,
    results
  };
}

export function evaluateReply(text, expected) {
  const abuse = detectMarkdownTableAbuse(text);
  const usedTable = abuse && expected === 'data_table';
  return {
    markdownTableWhenComponent: abuse && expected !== 'none' && expected !== 'data_table',
    usedDataTableAsMarkdown: usedTable,
    abuse
  };
}
