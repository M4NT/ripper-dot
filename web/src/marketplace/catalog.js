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
  { id: 'google-calendar', name: 'Google Calendar', author: 'Google', icon: 'gmail', desc: 'Eventos e disponibilidade.', featured: true },
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
  { id: 'google-calendar', name: 'Google Calendar', author: 'Google', icon: 'gmail', desc: 'Agenda e convites.', verified: true, pluginId: 'google-calendar' },
  { id: 'canva', name: 'Canva', author: 'Canva', icon: 'figma', desc: 'Designs e exportação de mídia.', verified: true },
  { id: 'microsoft-365', name: 'Microsoft 365', author: 'Anthropic', icon: 'notion', desc: 'Outlook, Teams e arquivos OneDrive.', verified: true },
  { id: 'notion', name: 'Notion', author: 'Notion', icon: 'notion', desc: 'Páginas, bases e tarefas.', verified: true },
  { id: 'figma', name: 'Figma', author: 'Figma', icon: 'figma', desc: 'Arquivos, frames e comentários.', verified: true },
  { id: 'slack', name: 'Slack', author: 'Slack', icon: 'slack', desc: 'Canais, mensagens e busca.', verified: true },
  { id: 'hubspot', name: 'HubSpot', author: 'HubSpot', icon: 'finance', desc: 'CRM e contatos.', verified: true },
  { id: 'asana', name: 'Asana', author: 'Asana', icon: 'linear', desc: 'Projetos e tarefas.', verified: true },
  { id: 'linear', name: 'Linear', author: 'Linear', icon: 'linear', desc: 'Issues e ciclos de engenharia.', verified: true, pluginId: 'linear',
    mcp: { name: 'linear', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-linear'] } },
  { id: 'monday', name: 'monday.com', author: 'monday.com', icon: 'notion', desc: 'Quadros e automações.', verified: true }
];

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
