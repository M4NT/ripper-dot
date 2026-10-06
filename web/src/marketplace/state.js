import { CONNECTORS } from './catalog.js';

// "Instalado" = está em settings.plugins (o que o agente recebe de verdade).
// Antes era marcado no localStorage do navegador e aparecia "Conectado" sem nada por trás.

export function isPluginInstalled(id, settings, claudeList = []) {
  const cat = CONNECTORS.find(c => c.id === id);
  if (cat?.connect?.type === 'claude') return claudeConnected(cat, claudeList);
  return (settings.plugins || []).some(p => p.name === id);
}

/** Conector do claude.ai conectado na conta (nome como aparece lá, ex.: "Google Calendar"). */
export function claudeConnected(cat, claudeList = []) {
  const names = [cat.name, ...(cat.claudeNames || [])].map(n => n.toLowerCase());
  return claudeList.some(c => names.includes(String(c.name).toLowerCase()) && c.status !== 'failed');
}

export function installPlugin(id, settings, extra = {}) {
  const cat = CONNECTORS.find(c => c.id === id);
  const plugins = [...(settings.plugins || [])].filter(p => p.name !== id);
  if (cat?.mcp) plugins.push({ ...cat.mcp, enabled: true, ...extra });
  return plugins;
}

export function uninstallPlugin(id, settings) {
  return (settings.plugins || []).filter(p => p.name !== id);
}

/** Para a tela "Gerenciar": catálogo instalado + conectores personalizados. */
export function listInstalledPlugins(settings, claudeList = []) {
  const mine = (settings.plugins || []).map(p => {
    const cat = CONNECTORS.find(c => c.id === p.name);
    return cat || { id: p.name, name: p.name, icon: 'plug', desc: `${p.type === 'http' ? 'HTTP' : 'stdio'} MCP personalizado`, custom: true };
  });
  // Conectados pela conta claude.ai também contam como instalados
  const fromClaude = claudeList.filter(c => c.status !== 'failed').map(c => {
    const cat = CONNECTORS.find(x => [x.name, ...(x.claudeNames || [])].some(n => n.toLowerCase() === String(c.name).toLowerCase()));
    return cat || { id: `claude-${c.name}`, name: c.name, icon: 'plug', desc: 'Conectado pela conta claude.ai' };
  });
  // Canais já ligados nas Configurações
  const channels = [
    (settings.whatsappWeb?.enabled || settings.whatsapp?.enabled) && { id: 'channel-whatsapp', name: 'WhatsApp', icon: 'whatsapp', desc: 'Canal ligado' },
    settings.email?.enabled && { id: 'channel-email', name: 'E-mail', icon: 'gmail', desc: settings.email.user || 'Canal ligado' },
    settings.github?.token && { id: 'channel-github', name: 'GitHub', icon: 'github', desc: 'Conectado' }
  ].filter(Boolean);
  const seen = new Set();
  return [...mine, ...fromClaude, ...channels].filter(x => !seen.has(x.id) && seen.add(x.id));
}

export function installedCount(settings, claudeList = []) {
  return listInstalledPlugins(settings, claudeList).length;
}

/** "Meus conectores": os instalados no Ripper + os da conta claude.ai. */
export function listMyConnectors(settings, claudeList = []) {
  const rows = (settings.plugins || []).map(p => {
    const cat = CONNECTORS.find(c => c.id === p.name);
    return { id: `plugin-${p.name}`, pluginName: p.name, name: cat?.name || p.name, icon: cat?.icon || 'plug', type: 'Ripper', badge: p.type === 'http' ? 'MCP' : 'stdio', status: p.enabled !== false ? 'ok' : 'off' };
  });
  for (const c of claudeList) {
    rows.push({ id: `claude-${c.name}`, name: c.name, icon: 'plug', type: 'claude.ai', badge: 'Conta claude.ai',
      status: c.status === 'connected' ? 'ok' : c.status === 'pending' ? 'session' : 'off',
      hint: c.status === 'connected' ? `${c.tools} ferramenta(s)` : c.status === 'pending' ? 'conectando…' : c.status });
  }
  return rows;
}
