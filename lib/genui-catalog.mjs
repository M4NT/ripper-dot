// Catálogo único de UI generativa do Ripper.
// Servidor e tela falam a mesma língua: schema, quando usar / não usar e fallback em texto.
import { z } from 'zod';

const colType = z.enum(['text', 'number', 'date', 'link', 'status']);
const chartKind = z.enum(['bar', 'line', 'pie']);
const stepStatus = z.enum(['pending', 'running', 'done', 'error']);
const prStatus = z.enum(['open', 'draft', 'merged', 'closed']);
const draftChannel = z.enum(['email', 'slack', 'whatsapp', 'generic']);
const connectStatus = z.enum(['idle', 'connected', 'reauth', 'error']);
const mediaKind = z.enum(['image', 'video', 'file']);

const option = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(120)
});

function mdTable(columns, rows) {
  if (!columns?.length) return '';
  const keys = columns.map(c => c.key);
  const head = '| ' + columns.map(c => c.label || c.key).join(' | ') + ' |';
  const sep = '|' + columns.map(() => '---').join('|') + '|';
  const body = (rows || []).map(r => '| ' + keys.map(k => String(r?.[k] ?? '')).join(' | ') + ' |');
  return [head, sep, ...body].join('\n');
}

function listLines(items, pick) {
  return (items || []).map(it => `- ${pick(it)}`).join('\n');
}

/** Entradas do catálogo. A ordem é a de implementação da proposta (aprovação → mídia). */
export const GENUI_CATALOG = {
  approval: {
    version: 1,
    title: 'Aprovação',
    description: 'Cartão "revisar uma ação" em uma frase, com detalhes recolhidos e Permitir uma vez / Negar. Sem "sempre": isso não persiste.',
    when: 'Ação com efeito externo: enviar, publicar, pagar, apagar, rodar comando arriscado, criar recurso.',
    whenNot: 'Pergunta sem efeito (use question). Configuração liga/desliga (use setting). Não peça "responda sim" no texto.',
    interactive: true,
    sideEffects: true,
    schema: z.object({
      title: z.string().min(1).max(200).describe('A ação em uma frase'),
      details: z.string().max(4000).optional().describe('Comando, payload ou motivo completo (recolhido)'),
      command: z.string().max(2000).optional(),
      reason: z.string().max(500).optional(),
      destructive: z.boolean().optional(),
      allowOnceLabel: z.string().max(40).optional(),
      denyLabel: z.string().max(40).optional()
    }),
    toText: p => {
      const verb = p.destructive ? 'Ação destrutiva' : 'Ação';
      return `${verb}: ${p.title}${p.reason ? `\nMotivo: ${p.reason}` : ''}${p.command ? `\n\`${p.command}\`` : ''}\nResponda permitir ou negar.`;
    },
    example: { title: 'Apagar a pasta dist no computador', command: 'rm -rf dist', reason: 'Limpar o build antigo', destructive: true }
  },

  question: {
    version: 1,
    title: 'Pergunta',
    description: 'Pergunta com opções (uma ou várias) + Outro e Enviar. Trava depois de respondida.',
    when: 'Pergunta com opções fechadas, escolha de cliente/arquivo/modelo, single ou multi-select.',
    whenNot: 'Não liste opções numeradas no texto. Não use para 1–2 itens óbvios (escreva a pergunta). Ação com efeito externo → approval.',
    interactive: true,
    sideEffects: false,
    schema: z.object({
      prompt: z.string().min(1).max(500),
      options: z.array(option).min(2).max(12),
      multiple: z.boolean().optional(),
      allowOther: z.boolean().optional(),
      submitLabel: z.string().max(40).optional()
    }),
    toText: p => `${p.prompt}\n${listLines(p.options, o => o.label)}${p.allowOther ? '\n- Outro' : ''}`,
    example: {
      prompt: 'Qual cliente devo usar?',
      options: [{ id: 'ana', label: 'Ana Ltda' }, { id: 'me', label: 'Ana ME' }],
      allowOther: true
    }
  },

  connect_app: {
    version: 1,
    title: 'Conectar app',
    description: 'Cartão para conectar repositório ou app (logo, escopos, OAuth, reautorizar/erro).',
    when: 'O pedido depende de um app ou repositório ainda não conectado, ou a conexão expirou.',
    whenNot: 'Não fale de conectores se o pedido não depender deles. Não invente um app fora do marketplace.',
    interactive: true,
    sideEffects: true,
    schema: z.object({
      app: z.string().min(1).max(80),
      logo: z.string().max(500).optional(),
      scopes: z.array(z.string().max(80)).max(12).optional(),
      reason: z.string().max(400).optional(),
      status: connectStatus.optional(),
      connectUrl: z.string().max(500).optional(),
      error: z.string().max(300).optional()
    }),
    toText: p => {
      const st = p.status === 'connected' ? 'já conectado' : p.status === 'reauth' ? 'precisa reautorizar' : p.status === 'error' ? `erro: ${p.error || 'falhou'}` : 'não conectado';
      return `Conectar ${p.app} (${st}).${p.reason ? ` ${p.reason}` : ''}${p.scopes?.length ? `\nPermissões: ${p.scopes.join(', ')}` : ''}`;
    },
    example: { app: 'GitHub', scopes: ['repo', 'read:user'], reason: 'Para abrir o PR no repositório do time', status: 'idle' }
  },

  draft_message: {
    version: 1,
    title: 'Rascunho',
    description: 'E-mail, Slack ou WhatsApp editável, com Enviar / Descartar.',
    when: 'Há um rascunho de mensagem para o usuário revisar antes de sair.',
    whenNot: 'Não diga que já enviou. Não use para recado interno ao próprio usuário (escreva no chat).',
    interactive: true,
    sideEffects: true,
    schema: z.object({
      channel: draftChannel,
      to: z.string().max(300).optional(),
      subject: z.string().max(200).optional(),
      body: z.string().min(1).max(20000),
      sendLabel: z.string().max(40).optional()
    }),
    toText: p => {
      const dest = p.to ? `Para: ${p.to}\n` : '';
      const sub = p.subject ? `Assunto: ${p.subject}\n` : '';
      return `Rascunho (${p.channel})\n${dest}${sub}\n${p.body}`;
    },
    example: { channel: 'email', to: 'ana@loja.com', subject: 'Proposta', body: 'Olá Ana, segue a proposta que combinamos.' }
  },

  data_table: {
    version: 1,
    title: 'Tabela',
    description: 'Tabela ordenável e filtrável, com copiar Markdown/CSV e rolagem horizontal.',
    when: '3+ linhas com 2+ colunas comparáveis (preços, status, prazos, estoque).',
    whenNot: '1–2 itens (use texto). Mais de 500 linhas (gere CSV e use file_card). Nunca escreva tabela markdown com 3+ linhas.',
    interactive: false,
    sideEffects: false,
    schema: z.object({
      title: z.string().max(120).optional(),
      columns: z.array(z.object({
        key: z.string().min(1).max(40),
        label: z.string().min(1).max(40),
        type: colType.optional()
      })).min(2).max(12),
      rows: z.array(z.record(z.string(), z.any())).min(1).max(500),
      caption: z.string().max(240).optional()
    }),
    toText: p => `${p.title ? p.title + '\n\n' : ''}${mdTable(p.columns, p.rows)}${p.caption ? '\n\n' + p.caption : ''}`,
    example: {
      title: 'Vendas da semana',
      columns: [
        { key: 'dia', label: 'Dia' },
        { key: 'qtd', label: 'Pedidos', type: 'number' },
        { key: 'total', label: 'Total' }
      ],
      rows: [
        { dia: 'Seg', qtd: 12, total: 'R$ 1.200' },
        { dia: 'Ter', qtd: 9, total: 'R$ 890' },
        { dia: 'Qua', qtd: 15, total: 'R$ 1.540' }
      ]
    }
  },

  chart: {
    version: 1,
    title: 'Gráfico',
    description: 'Gráfico de barras, linha ou pizza (SVG). Até 1000 pontos.',
    when: 'Tendência, comparação ou composição numérica (séries com rótulos).',
    whenNot: 'Um único número (use texto). Mais de 1000 pontos (agregue). Não desenhe gráfico em ASCII.',
    interactive: false,
    sideEffects: false,
    schema: z.object({
      title: z.string().max(120).optional(),
      kind: chartKind,
      labels: z.array(z.string().max(40)).min(1).max(60),
      series: z.array(z.object({
        name: z.string().min(1).max(40),
        values: z.array(z.number()).min(1).max(60)
      })).min(1).max(8),
      caption: z.string().max(240).optional()
    }),
    toText: p => {
      const lines = (p.labels || []).map((lab, i) => {
        const vals = (p.series || []).map(s => `${s.name}: ${s.values?.[i] ?? '—'}`).join(', ');
        return `- ${lab}: ${vals}`;
      });
      return `${p.title || 'Gráfico'} (${p.kind})\n${lines.join('\n')}`;
    },
    example: {
      title: 'Pedidos por dia',
      kind: 'bar',
      labels: ['Seg', 'Ter', 'Qua', 'Qui'],
      series: [{ name: 'Pedidos', values: [12, 9, 15, 11] }]
    }
  },

  progress: {
    version: 1,
    title: 'Progresso',
    description: 'Lista de passos do agente ou de subagentes (pendente / rodando / pronto / falhou).',
    when: 'Tarefa com 3+ etapas, subtarefas ou acompanhamento de um fluxo.',
    whenNot: 'Um único passo (escreva a frase). Não invente progresso que você não está executando.',
    interactive: false,
    sideEffects: false,
    schema: z.object({
      title: z.string().max(120).optional(),
      steps: z.array(z.object({
        id: z.string().max(40).optional(),
        title: z.string().min(1).max(120),
        detail: z.string().max(300).optional(),
        status: stepStatus
      })).min(2).max(20)
    }),
    toText: p => {
      const mark = { pending: '○', running: '…', done: '✓', error: '✗' };
      return `${p.title || 'Progresso'}\n${(p.steps || []).map(s => `${mark[s.status] || '·'} ${s.title}${s.detail ? ' — ' + s.detail : ''}`).join('\n')}`;
    },
    example: {
      title: 'Publicar a loja',
      steps: [
        { title: 'Revisar textos', status: 'done' },
        { title: 'Gerar imagens', status: 'running' },
        { title: 'Subir no ar', status: 'pending' }
      ]
    }
  },

  link_preview: {
    version: 1,
    title: 'Prévia de link',
    description: 'Cartão de link com título, descrição e ícone.',
    when: 'Você entrega um URL importante (artigo, painel, documento) e o título ajuda a decidir se abre.',
    whenNot: 'Link irrelevante no meio do texto. PR do GitHub (use pr_card).',
    interactive: false,
    sideEffects: false,
    schema: z.object({
      url: z.string().min(1).max(500),
      title: z.string().max(160).optional(),
      description: z.string().max(300).optional(),
      icon: z.string().max(500).optional(),
      host: z.string().max(80).optional()
    }),
    toText: p => `[${p.title || p.host || p.url}](${p.url})${p.description ? ' — ' + p.description : ''}`,
    example: { url: 'https://docs.ripper.dev/genui', title: 'UI generativa', description: 'Catálogo de componentes do Ripper', host: 'docs.ripper.dev' }
  },

  pr_card: {
    version: 1,
    title: 'Cartão de PR',
    description: 'Prévia de pull request com título, repositório e status (aberto / rascunho / mesclado / fechado).',
    when: 'Você abriu, encontrou ou está vigiando um PR.',
    whenNot: 'Issue sem PR (use link_preview). Não invente número nem status.',
    interactive: false,
    sideEffects: false,
    schema: z.object({
      url: z.string().min(1).max(500),
      title: z.string().min(1).max(200),
      status: prStatus,
      repo: z.string().max(120).optional(),
      number: z.number().int().optional(),
      author: z.string().max(80).optional()
    }),
    toText: p => `PR ${p.number ? '#' + p.number + ' ' : ''}${p.title} (${p.status})${p.repo ? ' · ' + p.repo : ''}\n${p.url}`,
    example: { url: 'https://github.com/acme/loja/pull/42', title: 'Corrige o frete grátis', status: 'open', repo: 'acme/loja', number: 42, author: 'ripper' }
  },

  file_card: {
    version: 1,
    title: 'Arquivo',
    description: 'Cartão de um arquivo do computador do agente (nome, tipo, tamanho).',
    when: 'Você entregou ou encontrou um arquivo específico para o usuário abrir/baixar.',
    whenNot: 'Vários arquivos de mídia (use media_gallery). Tabela enorme que deveria ser CSV ainda não gerado.',
    interactive: false,
    sideEffects: false,
    schema: z.object({
      name: z.string().min(1).max(200),
      size: z.number().nonnegative().optional(),
      type: z.string().max(80).optional(),
      url: z.string().max(500).optional(),
      fileId: z.string().max(80).optional()
    }),
    toText: p => `Arquivo: ${p.name}${p.size != null ? ` (${p.size} bytes)` : ''}`,
    example: { name: 'vendas.csv', size: 2048, type: 'text/csv' }
  },

  media_gallery: {
    version: 1,
    title: 'Galeria',
    description: 'Grade de imagens, vídeos ou arquivos do computador do agente.',
    when: '2+ imagens/arquivos para o usuário ver juntos (amostras, prints, anexos).',
    whenNot: 'Um único arquivo (use file_card). Não invente URLs.',
    interactive: false,
    sideEffects: false,
    schema: z.object({
      title: z.string().max(120).optional(),
      items: z.array(z.object({
        src: z.string().min(1).max(500),
        alt: z.string().max(160).optional(),
        name: z.string().max(160).optional(),
        type: mediaKind.optional()
      })).min(1).max(24)
    }),
    toText: p => `${p.title || 'Arquivos'}\n${listLines(p.items, it => it.name || it.alt || it.src)}`,
    example: {
      title: 'Peças da campanha',
      items: [
        { src: '/api/files/a', alt: 'Banner claro', name: 'banner-claro.png', type: 'image' },
        { src: '/api/files/b', alt: 'Banner escuro', name: 'banner-escuro.png', type: 'image' }
      ]
    }
  },

  html_preview: {
    version: 1,
    title: 'Prévia HTML',
    description: 'Iframe em sandbox com abas Prévia / Código. Base para mini-apps e MCP Apps (ui://).',
    when: 'Há HTML para o usuário ver (página, e-mail formatado). A prévia é estática: sem JavaScript (CSP própria no srcdoc).',
    whenNot: 'Trecho de código para copiar (use markdown). Não conte com JS, cookies nem rede no iframe.',
    interactive: false,
    sideEffects: false,
    schema: z.object({
      title: z.string().max(120).optional(),
      html: z.string().min(1).max(80000),
      source: z.string().max(80000).optional()
    }),
    toText: p => `${p.title || 'Prévia HTML'}\n\`\`\`html\n${(p.source || p.html).slice(0, 2000)}\n\`\`\``,
    example: { title: 'Cartão de visita', html: '<article><h1>Ana</h1><p>Design</p></article>' }
  },

  slides: {
    version: 1,
    title: 'Slides',
    description: 'Amostras de slide para o usuário escolher (depois exporta).',
    when: 'Há 2+ visuais/temas de apresentação para escolher antes de gerar o restante.',
    whenNot: 'Um único slide já decidido (mostre html_preview). Não use para escolher texto sem visual.',
    interactive: true,
    sideEffects: false,
    schema: z.object({
      title: z.string().max(120).optional(),
      samples: z.array(z.object({
        id: z.string().min(1).max(40),
        title: z.string().min(1).max(80),
        preview: z.string().max(500).optional(),
        description: z.string().max(200).optional()
      })).min(2).max(8)
    }),
    toText: p => `${p.title || 'Escolha um visual'}\n${listLines(p.samples, s => s.title + (s.description ? ' — ' + s.description : ''))}`,
    example: {
      title: 'Visual da apresentação',
      samples: [
        { id: 'limpo', title: 'Limpo', description: 'Fundo claro, pouco texto' },
        { id: 'escuro', title: 'Escuro', description: 'Contraste alto para palco' }
      ]
    }
  },

  setting: {
    version: 1,
    title: 'Configuração',
    description: 'Interruptor de uma configuração do Ripper oferecido na conversa.',
    when: 'O usuário pediu para ligar/desligar algo das configurações, ou isso resolve o problema.',
    whenNot: 'Não use para ações externas (approval). Se a chave já existir no catálogo de interruptores, offer_setting também serve — o clique aplica de verdade.',
    interactive: true,
    sideEffects: true,
    schema: z.object({
      key: z.string().min(1).max(80),
      label: z.string().min(1).max(80),
      description: z.string().max(300).optional(),
      proposed: z.boolean()
    }),
    toText: p => `Configuração: ${p.label} → ${p.proposed ? 'ligar' : 'desligar'}${p.description ? '\n' + p.description : ''}`,
    example: { key: 'pulse.enabled', label: 'Resumo diário', description: 'Todo dia, um resumo do que os agentes fizeram.', proposed: true }
  }
};

export const GENUI_NAMES = Object.keys(GENUI_CATALOG);
export const GENUI_TOOL_NAMES = GENUI_NAMES.map(n => `show_${n}`);

export function genuiEntry(name) {
  return GENUI_CATALOG[name] || null;
}

export function componentFromTool(tool) {
  const n = String(tool || '').replace(/^mcp__ripper__/, '');
  return n.startsWith('show_') ? n.slice(5) : '';
}

export function isGenuiTool(name) {
  return GENUI_TOOL_NAMES.includes(String(name || '').replace(/^mcp__ripper__/, ''));
}
