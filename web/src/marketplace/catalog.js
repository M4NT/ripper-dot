/** Catálogo estático do Marketplace (plugins, bots, conectores descobríveis, skills de parceiros). */

export const PLUGIN_CATALOG = [
  { id: 'vercel', name: 'Vercel', author: 'Vercel', icon: 'vercel', desc: 'Deploy, logs, domínios e variáveis de ambiente.', connectors: 1, skills: 33,
    mcp: { name: 'vercel', type: 'stdio', command: 'npx', args: ['-y', '@vercel/mcp-server'] }, featured: true, forYou: false },
  { id: 'github', name: 'GitHub', author: 'GitHub', icon: 'github', desc: 'Issues, PRs, repositórios e ações.', connectors: 1, skills: 0,
    mcp: { name: 'github', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] }, featured: false, forYou: false },
  { id: 'cloudflare', name: 'Cloudflare', author: 'Cloudflare', icon: 'cloudflare', desc: 'Workers, DNS, R2 e firewall.', connectors: 4, skills: 9, featured: false, forYou: false },
  { id: 'origin', name: 'Origin', author: 'Origin', icon: 'origin', desc: 'PRs, CI e repositórios na Origin.', connectors: 1, skills: 0, featured: false, forYou: false },
  { id: 'finance', name: 'Finance', author: 'Ripper', icon: 'finance', desc: 'Dados financeiros e relatórios (requer autenticação).', connectors: 1, skills: 0, needsAuth: true, featured: false, forYou: false },
  { id: 'agent-compat', name: 'Agent Compatibility', author: 'Ripper', icon: 'agent-compat', desc: 'Auditoria de compatibilidade para agentes em repositórios.', connectors: 0, skills: 1, featured: false, forYou: false },
  { id: 'aws-core', name: 'AWS Core', author: 'Amazon', icon: 'aws', desc: 'Serviços fundamentais da AWS via MCP.', forYou: true,
    mcp: { name: 'aws', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-aws'] } },
  { id: 'aws-amplify', name: 'AWS Amplify', author: 'Amazon', icon: 'aws', desc: 'Back-end e hospedagem full-stack.', forYou: true },
  { id: 'aws-location', name: 'Amazon Location Service', author: 'Amazon', icon: 'aws', desc: 'Mapas, rotas e geolocalização.', forYou: true },
  { id: 'appwrite', name: 'Appwrite', author: 'Appwrite', icon: 'appwrite', desc: 'Backend como serviço: auth, DB e storage.', forYou: true },
  { id: 'gmail-plugin', name: 'Gmail', author: 'Google', icon: 'gmail', desc: 'Ler e enviar e-mail nos agentes.', featured: true },
  { id: 'google-calendar', name: 'Google Calendar', author: 'Google', icon: 'google-calendar', desc: 'Eventos e disponibilidade.', featured: true },
  { id: 'google-drive-plugin', name: 'Google Drive', author: 'Google', icon: 'google-drive', desc: 'Arquivos e pastas compartilhadas.', featured: true },
  { id: 'granola', name: 'Granola', author: 'Granola', icon: 'notion', desc: 'Notas de reunião e resumos.', featured: true }
];

export const BOT_CATALOG = [
  { id: 'dr-eggbot', name: 'dr eggbot', author: 'Lauren Tan', color: '#e85d5d', desc: 'Humor técnico e analogias culinárias.' },
  { id: 'overheard', name: 'Overheard', author: 'Ripper', color: '#e8a43d', desc: 'Captura frases marcantes do time.' },
  { id: 'tradbot', name: 'Tradbot', author: 'Ripper', color: '#9b6dd6', desc: 'Tradução contextual PT ↔ EN.' },
  { id: 'projects-mana', name: 'Projects Mana…', author: 'Ripper', color: '#e85da8', desc: 'Organiza tarefas entre projetos Ripper.' }
];

export const CONNECTOR_DISCOVER = [
  { id: 'google-drive', name: 'Google Drive', author: 'Google', icon: 'google-drive', desc: 'Pesquise, leia e envie arquivos na hora.', verified: true, pluginId: 'google-drive-plugin' },
  { id: 'gmail', name: 'Gmail', author: 'Google', icon: 'gmail', desc: 'Caixa de entrada e envio de mensagens.', verified: true, pluginId: 'gmail-plugin' },
  { id: 'google-calendar', name: 'Google Calendar', author: 'Google', icon: 'google-calendar', desc: 'Agenda e convites.', verified: true, pluginId: 'google-calendar' },
  { id: 'canva', name: 'Canva', author: 'Canva', icon: 'canva', desc: 'Designs e exportação de mídia.', verified: true },
  { id: 'microsoft-365', name: 'Microsoft 365', author: 'Microsoft', icon: 'microsoft', desc: 'Outlook, Teams e arquivos OneDrive.', verified: true },
  { id: 'notion', name: 'Notion', author: 'Notion', icon: 'notion', desc: 'Páginas, bases e tarefas.', verified: true },
  { id: 'figma', name: 'Figma', author: 'Figma', icon: 'figma', desc: 'Arquivos, frames e comentários.', verified: true },
  { id: 'slack', name: 'Slack', author: 'Slack', icon: 'slack', desc: 'Canais, mensagens e busca.', verified: true },
  { id: 'hubspot', name: 'HubSpot', author: 'HubSpot', icon: 'hubspot', desc: 'CRM e contatos.', verified: true },
  { id: 'asana', name: 'Asana', author: 'Asana', icon: 'asana', desc: 'Projetos e tarefas.', verified: true },
  { id: 'linear', name: 'Linear', author: 'Linear', icon: 'linear', desc: 'Issues e ciclos de engenharia.', verified: true, pluginId: 'linear',
    mcp: { name: 'linear', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-linear'] } },
  { id: 'monday', name: 'monday.com', author: 'monday.com', icon: 'monday', desc: 'Quadros e automações.', verified: true }
];

const GOOGLE_DRIVE_TOOLS = ['copy_file', 'get_file_permissions', 'share_file', 'create_file', 'list_recent_files', 'trash_file', 'download_file_content', 'read_file_content', 'update_file', 'get_file_metadata', 'search_files'];

const DETAIL = {
  'google-drive': {
    tagline: 'Pesquise, leia e envie arquivos na hora',
    body: 'Conecte o Google Drive para buscar documentos, ler conteúdo, enviar arquivos e analisar dados com seus agentes — sem sair do Ripper.',
    tools: GOOGLE_DRIVE_TOOLS,
    connectorUrl: 'https://drivemcp.googleapis.com/mcp/v1',
    kind: 'connector'
  },
  gmail: {
    tagline: 'Caixa de entrada e envio na hora',
    body: 'Leia threads, rascunhe respostas e envie e-mails pelos agentes com contexto da conversa.',
    tools: ['list_messages', 'read_message', 'send_message', 'search_mail', 'list_labels'],
    connectorUrl: 'https://gmailmcp.googleapis.com/mcp/v1',
    kind: 'connector'
  },
  slack: {
    tagline: 'Canais, mensagens e busca',
    body: 'Publique updates, leia canais e pesquise histórico do Slack nos fluxos dos agentes.',
    tools: ['post_message', 'list_channels', 'search_messages', 'read_thread'],
    connectorUrl: 'https://slackmcp.example.com/mcp/v1',
    kind: 'connector'
  },
  vercel: {
    tagline: 'Deploy, logs e domínios',
    body: 'Gerencie projetos Vercel, variáveis de ambiente, deployments e observabilidade via MCP.',
    tools: ['list_projects', 'get_deployment', 'create_deployment', 'list_domains'],
    connectorUrl: 'stdio://@vercel/mcp-server',
    kind: 'plugin'
  },
  github: {
    tagline: 'Issues, PRs e repositórios',
    body: 'Integre GitHub para revisar PRs, issues e CI direto nos agentes.',
    tools: ['search_repositories', 'create_issue', 'list_pull_requests', 'merge_pull_request'],
    connectorUrl: 'stdio://@modelcontextprotocol/server-github',
    kind: 'plugin'
  }
};

/** Item unificado para a tela de detalhe antes de instalar. */
export function marketplaceDetail(id) {
  const connector = CONNECTOR_DISCOVER.find(c => c.id === id);
  const plugin = PLUGIN_CATALOG.find(p => p.id === id || p.id === connector?.pluginId);
  const base = connector || plugin;
  if (!base) return null;
  const extra = DETAIL[connector?.id || id] || {};
  const tools = extra.tools || (plugin?.skills ? ['use_skill', 'list_skills'] : ['connect', 'list_tools']);
  return {
    id: connector?.id || plugin.id,
    installId: plugin?.id || connector?.pluginId || connector?.id,
    name: base.name,
    author: base.author,
    icon: base.icon,
    verified: base.verified !== false,
    tagline: extra.tagline || base.desc,
    body: extra.body || base.desc,
    tools,
    connectorUrl: extra.connectorUrl || (plugin?.mcp?.type === 'http' ? plugin.mcp.url : plugin?.mcp ? `stdio://${plugin.mcp.command}` : '—'),
    mcp: connector?.mcp || plugin?.mcp,
    pluginId: connector?.pluginId || plugin?.id,
    kind: extra.kind || (plugin ? 'plugin' : 'connector')
  };
}

export function allMarketplaceProducts() {
  const seen = new Set();
  const out = [];
  for (const p of PLUGIN_CATALOG) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ ...p, productType: 'plugin' });
  }
  for (const c of CONNECTOR_DISCOVER) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ ...c, productType: 'connector' });
  }
  return out;
}

export const PARTNER_SKILLS = [
  { id: 'docs', name: 'docs', provider: 'Vercel', desc: 'por Vercel · Documentação e guias de produto.' },
  { id: 'ai-sdk', name: 'ai-sdk', provider: 'Vercel', desc: 'por Vercel · Vercel AI SDK expert guidance.' },
  { id: 'auth', name: 'auth', provider: 'Vercel', desc: 'por Vercel · Autenticação em apps Next.js.' },
  { id: 'nextjs', name: 'nextjs', provider: 'Vercel', desc: 'por Vercel · App Router e Server Components.' },
  { id: 'wrangler', name: 'wrangler', provider: 'Cloudflare', desc: 'por Cloudflare · CLI Workers e deploy.' },
  { id: 'cloudflare', name: 'cloudflare', provider: 'Cloudflare', desc: 'por Cloudflare · Plataforma edge completa.' }
];

export const BUILTIN_CONNECTORS = [
  { id: 'claude-chrome', name: 'Claude in Chrome', icon: 'terminal', type: 'Desktop', badge: 'Incluído', status: 'ok' },
  { id: 'inspo', name: 'Inspo', icon: 'bulb', type: 'Desktop', badge: 'Dev local', status: 'ok' },
  { id: 'github-claude', name: 'Integração com o GitHub', icon: 'github', type: 'Web', status: 'ok', settingsKey: 'github' },
  { id: 'multipli', name: 'Multipli MCP', icon: 'cube', type: 'Web', badge: 'Personalizado', status: 'ok', fromPlugin: 'multipli' }
];

export function catalogById(id) {
  return PLUGIN_CATALOG.find(p => p.id === id) || CONNECTOR_DISCOVER.find(c => c.id === id);
}
