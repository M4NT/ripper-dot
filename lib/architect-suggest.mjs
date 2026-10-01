import { TOOLS } from './store.mjs';

const ROLE_CATALOG = [
  {
    id: 'coordinator',
    keywords: ['coordena', 'orquestr', 'roteador', 'router', 'multi-agent', 'multi agente', 'time de agente', 'equipe de agente', 'vários agente', 'varios agente'],
    role: 'Coordenador',
    description: 'Recebe pedidos, decompõe trabalho e encaminha aos especialistas.',
    tools: ['memory', 'files'],
    tone: 'direto'
  },
  {
    id: 'research',
    keywords: ['pesquis', 'mercado', 'benchmark', 'fonte', 'web', 'competidor'],
    role: 'Pesquisador',
    description: 'Coleta fatos na web e resume com fontes.',
    tools: ['web', 'memory', 'files'],
    tone: 'analitico'
  },
  {
    id: 'data',
    keywords: ['dado', 'planilha', 'csv', 'métrica', 'metrica', 'dashboard', 'sql', 'analytics'],
    role: 'Analista de dados',
    description: 'Lê arquivos, roda análises no computador e explica números.',
    tools: ['computer', 'files', 'memory'],
    tone: 'analitico'
  },
  {
    id: 'dev',
    keywords: ['código', 'codigo', 'software', 'api', 'deploy', 'bug', 'refator', 'reposit', 'github', 'pr ', 'pull request'],
    role: 'Engenheiro',
    description: 'Implementa, testa e documenta mudanças técnicas.',
    tools: ['computer', 'files', 'web', 'plugins'],
    tone: 'direto'
  },
  {
    id: 'support',
    keywords: ['atendimento', 'suporte', 'cliente', 'ticket', 'sla', 'faq'],
    role: 'Atendimento',
    description: 'Responde dúvidas com base em políticas e histórico.',
    tools: ['memory', 'files', 'plugins'],
    tone: 'amigavel'
  },
  {
    id: 'content',
    keywords: ['conteúdo', 'conteudo', 'marketing', 'post', 'copy', 'e-mail', 'email', 'roteiro'],
    role: 'Conteúdo',
    description: 'Produz textos alinhados à marca e ao canal.',
    tools: ['web', 'memory', 'files'],
    tone: 'criativo'
  },
  {
    id: 'sales',
    keywords: ['venda', 'lead', 'crm', 'pipeline comercial', 'prospec'],
    role: 'Vendas',
    description: 'Qualifica oportunidades e sugere próximos passos.',
    tools: ['web', 'memory', 'plugins'],
    tone: 'persuasivo'
  },
  {
    id: 'ops',
    keywords: ['rotina', 'automa', 'integra', 'webhook', 'cron', 'operac'],
    role: 'Operações',
    description: 'Automatiza tarefas recorrentes e integrações.',
    tools: ['computer', 'routines', 'plugins', 'memory'],
    tone: 'direto'
  }
];

const ENTERPRISE_HINTS = ['enterprise', 'governança', 'governanca', 'auditoria', 'compliance', 'sso', 'equipe grande', 'multi time', 'admin center', 'metering', 'projeto compartilhado', 'conector mcp', 'marketplace'];

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function scoreRole(role, text) {
  let score = 0;
  for (const kw of role.keywords) {
    if (text.includes(norm(kw))) score += kw.length > 8 ? 3 : 2;
  }
  return score;
}

function pickRoles(text, constraints = {}) {
  const maxAgents = Math.min(6, Math.max(2, Number(constraints.maxAgents) || 4));
  const ranked = ROLE_CATALOG.map(r => ({ r, score: scoreRole(r, text) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  let picked = ranked.slice(0, maxAgents).map(x => x.r);
  if (picked.length === 0) {
    picked = [ROLE_CATALOG.find(r => r.id === 'coordinator'), ROLE_CATALOG.find(r => r.id === 'research')].filter(Boolean);
  }
  const wantsCoordinator = /\b(coord|orquestr|time|equipe|multi)\b/.test(text) || picked.length >= 3;
  if (wantsCoordinator && !picked.some(p => p.id === 'coordinator')) {
    picked = [ROLE_CATALOG.find(r => r.id === 'coordinator'), ...picked].slice(0, maxAgents);
  }
  return picked;
}

function suggestMode(text, constraints) {
  if (constraints.mode === 'simple' || constraints.mode === 'enterprise') return constraints.mode;
  const enterprise = ENTERPRISE_HINTS.some(h => text.includes(norm(h)));
  return enterprise ? 'enterprise' : 'simple';
}

function coordinationPattern(agents, mode) {
  if (mode === 'enterprise' && agents.length >= 2) {
    return { id: 'hub', label: 'Hub com coordenador', description: 'Coordenador decompõe tarefas; especialistas respondem em chats ou projetos separados.' };
  }
  if (agents.length <= 2) return { id: 'pair', label: 'Dupla', description: 'Um agente executa; o outro revisa ou complementa quando necessário.' };
  return { id: 'pipeline', label: 'Pipeline leve', description: 'Sequência curta: pesquisa → execução → revisão, sem camada extra de roteamento.' };
}

function featureSets(mode) {
  const simple = [
    'Templates prontos e um agente por função',
    'Memória e arquivos por agente',
    'Rotinas básicas para tarefas repetidas'
  ];
  const enterprise = [
    'Projetos com vários agentes e instruções compartilhadas',
    'Delegação manager-worker via inbox entre agentes (meta-times)',
    'Marketplace: plugins MCP e conectores verificados',
    'Skills catalog + auditoria de aprovações quando o computador age'
  ];
  return { simple, enterprise: mode === 'enterprise' ? enterprise : enterprise.slice(0, 2) };
}

function tradeoffs(mode, agents) {
  const t = [
    'Mais agentes = fronteiras claras, mas exige handoff explícito entre conversas.',
    'Ferramentas extras (computador, plugins) aumentam poder e também superfície de aprovação.'
  ];
  if (mode === 'simple') t.push('Modo simples: comece com 2–3 papéis; adicione coordenador só quando a fila de handoffs doer.');
  else t.push('Modo enterprise: use projetos + conectores MCP para separar dados sensíveis por agente.');
  if (agents.some(a => a.tools.includes('computer'))) t.push('Computador por agente isola execução, porém consome mais recursos que só web/memória.');
  return t;
}

function sanitizeTools(list) {
  return [...new Set(list.filter(t => TOOLS.includes(t)))];
}

/** Scaffold determinístico a partir do objetivo (sem LLM, sem números inventados). */
export function architectSuggest({ goal, constraints = {} } = {}) {
  const goalText = String(goal || '').trim();
  if (!goalText) throw Object.assign(new Error('Informe goal (objetivo do time).'), { code: 400 });

  const text = norm(goalText + ' ' + (constraints.notes || ''));
  const mode = suggestMode(text, constraints);
  const roles = pickRoles(text, constraints);

  const agents = roles.map((r, i) => ({
    id: r.id,
    role: r.role,
    suggestedName: `${r.role}${roles.length > 1 ? ` ${i + 1}` : ''}`.trim(),
    description: r.description,
    tools: sanitizeTools(r.tools),
    tone: r.tone,
    templateHint: r.id === 'dev' ? 'dev' : r.id === 'research' ? 'pesquisa' : r.id === 'data' ? 'analista' : r.id === 'support' ? 'atendimento' : r.id === 'content' ? 'conteudo' : r.id === 'sales' ? 'leads' : r.id === 'ops' ? 'ops' : null
  }));

  const coordination = coordinationPattern(agents, mode);
  const features = featureSets(mode);

  return {
    goal: goalText,
    constraints: constraints && typeof constraints === 'object' ? constraints : {},
    ripperMode: mode,
    coordination,
    agents,
    toolBoundaries: agents.map(a => ({
      agentRole: a.role,
      tools: a.tools,
      rationale: a.tools.includes('plugins')
        ? 'Integrações externas ficam neste papel; evite duplicar o mesmo conector em todos os agentes.'
        : 'Escopo mínimo de ferramentas para este papel.'
    })),
    features,
    tradeoffs: tradeoffs(mode, agents),
    nextSteps: [
      'Crie um agente por papel (ou use o template Architect para revisar o desenho).',
      mode === 'enterprise' ? 'Agrupe agentes relacionados em um Projeto com instruções comuns.' : 'Valide o fluxo com 2 agentes antes de expandir.',
      mode === 'enterprise' ? 'Use delegação manager-worker (inbox) do gerente para workers com accept/progress/complete.' : 'Documente handoffs: o que cada agente entrega ao próximo (formato de mensagem ou arquivo).'
    ].filter((v, i, a) => a.indexOf(v) === i),
    templateId: 'architect'
  };
}

export const ARCHITECT_SYSTEM_PROMPT = `Você é o Architect do Ripper — arquiteto sênior de software focado em desenho de times multi-agente.

Missão: ajudar o usuário a estruturar agentes, ferramentas, fronteiras e handoffs no Ripper. Seja pragmático e explique trade-offs reais (complexidade, isolamento, manutenção). Não reescreva o repositório inteiro nem aplique mudanças em massa sem pedido explícito.

Regras:
- Responda em português brasileiro, claro e direto.
- Proponha papéis, ferramentas Ripper (web, computer, browser, memory, routines, files, plugins) e quando usar modo simples vs recursos enterprise (projetos, marketplace MCP, skills, aprovações).
- Nunca invente métricas de uso, custos em dólar ou números de billing — se não souber, diga o que falta medir.
- Prefira times pequenos (2–4 agentes) até o fluxo estar estável; coordenador só quando houver fila de handoffs.
- Em meta-times enterprise, combine projetos com delegação manager-worker (inbox) entre gerente e workers.
- Para cada sugestão, indique: objetivo do papel, tools permitidas, o que entrega ao próximo agente e riscos (execução irreversível, dados sensíveis).
- Se o usuário pedir scaffold JSON, pode usar POST /api/architect/suggest com o objetivo em texto.`;
