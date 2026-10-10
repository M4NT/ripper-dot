/**
 * Catálogo único do Marketplace ("Conectar aplicativos").
 * connect.type:
 *   'oauth'  — servidor MCP remoto oficial com login (OAuth 2.1 + PKCE)
 *   'token'  — servidor MCP remoto que usa token pessoal (ex.: GitHub)
 *   'claude' — vem pela sua conta claude.ai (Google, Slack, Microsoft)
 *   'local'  — servidor MCP que roda nesta máquina (versão fixa)
 *   'native' — API direta do Ripper (Omie)
 */
const C = (id, name, author, desc, connect, extra = {}) => ({
  id, name, author, icon: extra.icon || id, desc, connect, verified: extra.verified !== false,
  category: extra.category || 'trabalho',
  aliases: extra.aliases || [],
  ...(connect.url ? { mcp: { name: id, type: 'http', url: connect.url } } : {}),
  ...(connect.type === 'local' ? { mcp: { name: id, type: 'stdio', command: connect.command, args: connect.args } } : {}),
  ...extra
});

export const CATEGORIES = [
  ['google', 'Google'],
  ['trabalho', 'Trabalho'],
  ['projetos', 'Projetos'],
  ['design', 'Design'],
  ['automacao', 'Automação'],
  ['financeiro', 'Financeiro'],
  ['dev', 'Desenvolvimento'],
  ['seo', 'SEO']
];

export const AUTH_KINDS = [
  ['oauth', 'Login'],
  ['token', 'Token'],
  ['claude', 'Conta Claude'],
  ['local', 'Nesta máquina'],
  ['native', 'Direto']
];

export const CONNECTORS = [
  C('google-calendar', 'Google Agenda', 'Google', 'Eventos, disponibilidade e convites.', { type: 'claude' }, { forYou: true, category: 'google', claudeNames: ['Google Calendar'], aliases: ['agenda', 'calendar'] }),
  C('gmail', 'Gmail', 'Google', 'Ler, buscar e rascunhar e-mails.', { type: 'claude' }, { featured: true, category: 'google', aliases: ['email', 'e-mail', 'mail'] }),
  C('google-drive', 'Google Drive', 'Google', 'Buscar e ler documentos e planilhas.', { type: 'claude' }, { featured: true, category: 'google', aliases: ['docs', 'planilha'] }),
  C('slack', 'Slack', 'Slack', 'Canais, mensagens e busca.', { type: 'claude' }, { category: 'trabalho' }),
  C('microsoft-365', 'Microsoft 365', 'Microsoft', 'Outlook, Teams e OneDrive.', { type: 'claude' }, { icon: 'microsoft', category: 'trabalho', aliases: ['outlook', 'teams', 'onedrive'] }),
  C('notion', 'Notion', 'Notion', 'Páginas, bases e tarefas.', { type: 'oauth', url: 'https://mcp.notion.com/mcp' }, { forYou: true, category: 'trabalho' }),
  C('linear', 'Linear', 'Linear', 'Tarefas, projetos e ciclos.', { type: 'oauth', url: 'https://mcp.linear.app/mcp' }, { forYou: true, category: 'projetos' }),
  C('asana', 'Asana', 'Asana', 'Projetos e tarefas.', { type: 'oauth', url: 'https://mcp.asana.com/sse' }, { category: 'projetos' }),
  C('monday', 'monday.com', 'monday.com', 'Quadros, itens e automações.', { type: 'oauth', url: 'https://mcp.monday.com/mcp' }, { category: 'projetos' }),
  C('atlassian', 'Jira e Confluence', 'Atlassian', 'Tarefas do Jira e páginas do Confluence.', { type: 'oauth', url: 'https://mcp.atlassian.com/v1/sse' }, { category: 'projetos', aliases: ['jira', 'confluence'] }),
  C('canva', 'Canva', 'Canva', 'Criar e exportar designs.', { type: 'oauth', url: 'https://mcp.canva.com/mcp' }, { category: 'design' }),
  C('zapier', 'Zapier', 'Zapier', 'Milhares de apps por ações do Zapier.', { type: 'oauth', url: 'https://mcp.zapier.com/api/mcp/mcp' }, { forYou: true, category: 'automacao' }),
  C('granola', 'Granola', 'Granola', 'Notas e resumos de reuniões.', { type: 'oauth', url: 'https://mcp.granola.ai/mcp' }, { category: 'automacao' }),
  C('stripe', 'Stripe', 'Stripe', 'Clientes, cobranças e assinaturas.', { type: 'oauth', url: 'https://mcp.stripe.com' }, { category: 'financeiro' }),
  C('vercel', 'Vercel', 'Vercel', 'Projetos, deploys e logs.', { type: 'oauth', url: 'https://mcp.vercel.com' }, { featured: true, category: 'dev' }),
  C('cloudflare', 'Cloudflare', 'Cloudflare', 'Logs e observabilidade de Workers.', { type: 'oauth', url: 'https://observability.mcp.cloudflare.com/mcp' }, { category: 'dev' }),
  C('supabase', 'Supabase', 'Supabase', 'Banco, auth e storage.', { type: 'oauth', url: 'https://mcp.supabase.com/mcp' }, { category: 'dev' }),
  C('sentry', 'Sentry', 'Sentry', 'Erros e performance.', { type: 'oauth', url: 'https://mcp.sentry.dev/mcp' }, { category: 'dev' }),
  C('github', 'GitHub', 'GitHub', 'Repositórios, tarefas e pedidos de mudança.', { type: 'token', url: 'https://api.githubcopilot.com/mcp/',
    tokenHelp: 'Crie um token em github.com/settings/tokens (fine-grained) com acesso aos repositórios que o agente pode ver.' }, { featured: true, category: 'dev', aliases: ['gh', 'repositório', 'pr'] }),
  C('omie-erp', 'Omie ERP', 'Omie', 'Contas, pedidos, notas e cadastros do Omie, empresa por empresa.', { type: 'native',
    help: 'Você precisa da chave e do segredo do aplicativo, gerados pelo administrador de cada empresa no Omie.' }, { featured: true, icon: 'cube', category: 'financeiro', aliases: ['erp', 'omie'] }),
  C('google-analytics', 'Google Analytics 4', 'Google', 'Relatórios de tráfego, conversões e funis do GA4.', { type: 'local', command: 'pipx', args: ['run', 'analytics-mcp==0.7.0'],
    help: 'Servidor oficial do Google (Apache 2.0). Precisa de Python com pipx e, uma vez nesta máquina: gcloud auth application-default login --scopes https://www.googleapis.com/auth/analytics.readonly,https://www.googleapis.com/auth/cloud-platform. Ative as APIs Google Analytics Admin e Data no seu projeto do Google Cloud.',
    fields: [{ key: 'GOOGLE_PROJECT_ID', label: 'ID do projeto no Google Cloud', placeholder: 'meu-projeto-123', hint: 'Aparece no seletor de projetos do console do Google Cloud.' }] }, { forYou: true, category: 'seo', aliases: ['ga4', 'analytics'] }),
  C('search-console', 'Google Search Console', 'Comunidade (ahonn)', 'Posições no Google, cliques, impressões e oportunidades de SEO.', { type: 'local', command: 'npx', args: ['-y', 'mcp-server-gsc@0.3.0'],
    help: 'Servidor da comunidade (MIT). Crie uma conta de serviço no Google Cloud, baixe o JSON da chave e adicione o e-mail dela como usuário da propriedade no Search Console.',
    fields: [{ key: 'GOOGLE_APPLICATION_CREDENTIALS', label: 'Caminho do JSON da conta de serviço', placeholder: 'C:\\chaves\\search-console.json', hint: 'O arquivo da chave que você baixou da conta de serviço, nesta máquina.' }] }, { forYou: true, category: 'seo', aliases: ['gsc', 'search'] })
];

/** Compatibilidade com as telas: plugins e "descobrir conectores" são a mesma lista. */
export const PLUGIN_CATALOG = CONNECTORS;
export const CONNECTOR_DISCOVER = CONNECTORS;

/** Presets Ripper (templates de agente, não plugins MCP). */
export const AGENT_PRESETS = [
  { id: 'architect', name: 'Architect', author: 'Ripper', color: '#5b6cf0', desc: 'Desenho de times multi-agente — papéis, ferramentas e prós e contras.', templateId: 'architect', hub: 'enterprise' }
];

export const BOT_CATALOG = [
  { id: 'dr-eggbot', name: 'dr eggbot', author: 'Lauren Tan', color: '#e85d5d', desc: 'Humor técnico e analogias culinárias.' },
  { id: 'overheard', name: 'Overheard', author: 'Ripper', color: '#e8a43d', desc: 'Captura frases marcantes do time.' },
  { id: 'tradbot', name: 'Tradbot', author: 'Ripper', color: '#9b6dd6', desc: 'Tradução contextual PT ↔ EN.' },
  { id: 'projects-mana', name: 'Projects Mana…', author: 'Ripper', color: '#e85da8', desc: 'Organiza tarefas entre projetos Ripper.' }
];

/** Item para a tela de detalhe antes de conectar. */
export function marketplaceDetail(id) {
  const c = CONNECTORS.find(x => x.id === id);
  if (!c) return null;
  return {
    ...c, installId: c.id, pluginId: c.id, tagline: c.desc, body: c.desc, tools: [],
    connectorUrl: c.connect.url || (c.connect.type === 'local' ? `${c.connect.command} ${c.connect.args.join(' ')}` : 'Conta claude.ai'), kind: c.connect.type === 'claude' ? 'claude' : 'connector'
  };
}

export function allMarketplaceProducts() {
  return CONNECTORS.map(c => ({ ...c, productType: 'connector' }));
}

export const PARTNER_SKILLS = [
  { id: 'docs', name: 'docs', provider: 'Vercel', desc: 'por Vercel · Documentação e guias de produto.' },
  { id: 'ai-sdk', name: 'ai-sdk', provider: 'Vercel', desc: 'por Vercel · Vercel AI SDK expert guidance.' },
  { id: 'auth', name: 'auth', provider: 'Vercel', desc: 'por Vercel · Autenticação em apps Next.js.' },
  { id: 'nextjs', name: 'nextjs', provider: 'Vercel', desc: 'por Vercel · App Router e Server Components.' },
  { id: 'wrangler', name: 'wrangler', provider: 'Cloudflare', desc: 'por Cloudflare · CLI Workers e deploy.' },
  { id: 'cloudflare', name: 'cloudflare', provider: 'Cloudflare', desc: 'por Cloudflare · Plataforma edge completa.' }
];

/** Conectores que não são instalados aqui (os do claude.ai vêm de /api/claude/connectors). */
export const BUILTIN_CONNECTORS = [];

export function catalogById(id) {
  return CONNECTORS.find(c => c.id === id);
}

export function authKind(item) {
  return item?.connect?.type || 'oauth';
}

export function categoryLabel(id) {
  return CATEGORIES.find(([k]) => k === id)?.[1] || id;
}

export function authKindLabel(kind) {
  return AUTH_KINDS.find(([k]) => k === kind)?.[1] || kind;
}

/** Busca por nome, descrição, autor, categoria e apelidos. */
export function matchesQuery(item, q) {
  const t = String(q || '').trim().toLowerCase();
  if (!t) return true;
  const hay = [item.name, item.desc, item.author, item.id, categoryLabel(item.category), authKindLabel(authKind(item)), ...(item.aliases || [])]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(t);
}

export function filterCatalog(list, { q = '', category = '', auth = '', verified = false } = {}) {
  return list.filter(c => {
    if (!matchesQuery(c, q)) return false;
    if (category && c.category !== category) return false;
    if (auth && authKind(c) !== auth) return false;
    if (verified && !c.verified) return false;
    return true;
  });
}

export const CLAUDE_CONNECTORS_URL = 'https://claude.ai/settings/connectors';
