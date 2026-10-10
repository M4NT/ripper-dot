import { CONNECTORS, authKind } from './catalog.js';

// Máquina de estados do Marketplace (pesquisa da equipe + Grok Bot):
// disponível → instalando → precisa autenticar → conectado
// + expirado / erro / desativado

export const STATUS = {
  available: 'available',
  installing: 'installing',
  needs_auth: 'needs_auth',
  connected: 'connected',
  expired: 'expired',
  error: 'error',
  off: 'off'
};

export const STATUS_LABEL = {
  available: null,
  installing: 'Conectando…',
  needs_auth: 'Precisa autenticar',
  connected: 'Conectado',
  expired: 'Expirado',
  error: 'Erro',
  off: 'Desativado'
};

export const STATUS_TONE = {
  available: null,
  installing: 'warn',
  needs_auth: 'warn',
  connected: 'ok',
  expired: 'warn',
  error: 'err',
  off: null
};

const AUTH_NEEDS = new Set(['needs_auth', 'lazy']);
const AUTH_EXPIRED = new Set(['expired', 'expired_refreshable', 'expiring_soon']);

function claudeHit(cat, claudeList = []) {
  const names = [cat.name, ...(cat.claudeNames || [])].map(n => n.toLowerCase());
  return claudeList.find(c => names.includes(String(c.name).toLowerCase()));
}

/** Conector do claude.ai conectado na conta (nome como aparece lá, ex.: "Google Calendar"). */
export function claudeConnected(cat, claudeList = []) {
  const hit = claudeHit(cat, claudeList);
  return !!(hit && hit.status !== 'failed');
}

/**
 * Estado visível de um item do catálogo.
 * authByName vem de GET /api/mcp/connectors (sem segredos).
 */
export function resolveConnectorStatus({
  cat,
  settings = {},
  claudeList = [],
  authByName = {},
  liveError,
  installing,
  omieCompanies,
  stdioByName = {}
} = {}) {
  if (!cat) return { id: STATUS.available, label: null, tone: null };
  if (installing) return { id: STATUS.installing, label: STATUS_LABEL.installing, tone: 'warn' };

  if (cat.connect?.type === 'claude') {
    const hit = claudeHit(cat, claudeList);
    if (!hit) return { id: STATUS.available, label: null, tone: null };
    if (hit.status === 'pending') return { id: STATUS.installing, label: STATUS_LABEL.installing, tone: 'warn', hint: 'conectando…' };
    if (hit.status === 'failed') return { id: STATUS.error, label: STATUS_LABEL.error, tone: 'err', detail: hit.error || hit.hint || 'Falha na conta claude.ai.' };
    if (hit.status === 'connected' || hit.status !== 'failed') {
      return { id: STATUS.connected, label: STATUS_LABEL.connected, tone: 'ok', hint: hit.tools != null ? `${hit.tools} ferramenta(s)` : null };
    }
  }

  if (cat.connect?.type === 'native') {
    if (Array.isArray(omieCompanies) && omieCompanies.length) {
      return { id: STATUS.connected, label: STATUS_LABEL.connected, tone: 'ok', hint: `${omieCompanies.length} empresa(s)` };
    }
    return { id: STATUS.available, label: null, tone: null };
  }

  const plugin = (settings.plugins || []).find(p => p.name === cat.id);
  if (!plugin) return { id: STATUS.available, label: null, tone: null };
  if (plugin.enabled === false) return { id: STATUS.off, label: STATUS_LABEL.off, tone: null };

  if (liveError) return { id: STATUS.error, label: STATUS_LABEL.error, tone: 'err', detail: liveError };

  const stdio = stdioByName[cat.id] || plugin.stdioSupervisor;
  if (stdio?.state === 'crashed' || stdio?.state === 'cooldown') {
    return { id: STATUS.error, label: STATUS_LABEL.error, tone: 'err', detail: stdio.lastError || 'O processo local parou.', logs: stdio.lastError };
  }

  const auth = authByName[cat.id] || plugin.authStatus;
  if (auth?.state && AUTH_NEEDS.has(auth.state)) {
    return { id: STATUS.needs_auth, label: STATUS_LABEL.needs_auth, tone: 'warn', detail: auth.reason };
  }
  if (auth?.state && AUTH_EXPIRED.has(auth.state)) {
    return { id: STATUS.expired, label: auth.state === 'expiring_soon' ? 'Token expira em breve' : STATUS_LABEL.expired, tone: 'warn', detail: auth.reason, refreshable: auth.state === 'expired_refreshable' };
  }

  if (cat.connect?.type === 'oauth' && !auth?.state && plugin.auth?.mode !== 'none' && !plugin.auth?.apiKey) {
    return { id: STATUS.needs_auth, label: STATUS_LABEL.needs_auth, tone: 'warn' };
  }

  return { id: STATUS.connected, label: STATUS_LABEL.connected, tone: 'ok' };
}

/** Ação primária única por estado (cartão). */
export function primaryAction(statusId, connectType) {
  if (statusId === STATUS.installing) return { id: 'wait', label: 'Conectando…', disabled: true };
  if (statusId === STATUS.needs_auth) return { id: 'auth', label: connectType === 'claude' ? 'Entrar no claude.ai' : 'Entrar' };
  if (statusId === STATUS.expired) return { id: 'reauth', label: 'Entrar de novo' };
  if (statusId === STATUS.error) return { id: 'retry', label: 'Tentar de novo' };
  if (statusId === STATUS.off) return { id: 'enable', label: 'Ligar' };
  if (statusId === STATUS.connected) return { id: 'manage', label: 'Conectado', disabled: true };
  if (connectType === 'claude') return { id: 'connect', label: 'Conectar' };
  if (connectType === 'native') return { id: 'setup', label: 'Configurar' };
  return { id: 'connect', label: 'Conectar' };
}

export function isAttention(status) {
  return status?.id === STATUS.needs_auth || status?.id === STATUS.expired || status?.id === STATUS.error;
}

export function isPresent(status) {
  return status && status.id !== STATUS.available;
}

// "Instalado" = está em settings.plugins (o que o agente recebe de verdade)
// ou conectado na conta claude.ai. Não significa "autenticado".
export function isPluginInstalled(id, settings, claudeList = []) {
  const cat = CONNECTORS.find(c => c.id === id);
  if (cat?.connect?.type === 'claude') return claudeConnected(cat, claudeList);
  if (cat?.connect?.type === 'native') return false;
  return (settings.plugins || []).some(p => p.name === id);
}

export function installPlugin(id, settings, extra = {}) {
  const cat = CONNECTORS.find(c => c.id === id);
  const prev = (settings.plugins || []).find(p => p.name === id);
  const plugins = [...(settings.plugins || [])].filter(p => p.name !== id);
  if (cat?.mcp) {
    const rec = { ...cat.mcp, enabled: true };
    if (cat.connect?.type === 'oauth' && !extra.auth) rec.auth = { mode: 'oauth_now' };
    plugins.push({ ...rec, ...extra });
  } else if (prev) {
    plugins.push({ ...prev, enabled: true, ...extra });
  }
  return plugins;
}

export function uninstallPlugin(id, settings) {
  return (settings.plugins || []).filter(p => p.name !== id);
}

export function setPluginEnabled(id, settings, enabled) {
  return (settings.plugins || []).map(p => p.name === id ? { ...p, enabled } : p);
}

/** Para a tela "Gerenciar": catálogo instalado + conectores personalizados. */
export function listInstalledPlugins(settings, claudeList = []) {
  const mine = (settings.plugins || []).map(p => {
    const cat = CONNECTORS.find(c => c.id === p.name);
    return cat || { id: p.name, name: p.name, icon: 'plug', desc: p.type === 'http' ? 'Endereço personalizado' : 'Programa nesta máquina', custom: true, connect: { type: p.type === 'stdio' ? 'local' : 'oauth' } };
  });
  const fromClaude = claudeList.filter(c => c.status !== 'failed').map(c => {
    const cat = CONNECTORS.find(x => [x.name, ...(x.claudeNames || [])].some(n => n.toLowerCase() === String(c.name).toLowerCase()));
    return cat || { id: `claude-${c.name}`, name: c.name, icon: 'plug', desc: 'Conectado pela conta claude.ai', connect: { type: 'claude' } };
  });
  const channels = [
    (settings.whatsappWeb?.enabled || settings.whatsapp?.enabled) && { id: 'channel-whatsapp', name: 'WhatsApp', icon: 'whatsapp', desc: 'Canal ligado', channel: '/settings/channels' },
    settings.email?.enabled && { id: 'channel-email', name: 'E-mail', icon: 'gmail', desc: settings.email.user || 'Canal ligado', channel: '/settings/channels' },
    settings.github?.token && { id: 'channel-github', name: 'GitHub', icon: 'github', desc: 'Token do Guardião', channel: '/settings/channels' }
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
    return { id: `plugin-${p.name}`, pluginName: p.name, name: cat?.name || p.name, icon: cat?.icon || 'plug', type: 'Ripper', badge: p.type === 'http' ? 'HTTP' : 'nesta máquina', status: p.enabled !== false ? 'ok' : 'off' };
  });
  for (const c of claudeList) {
    rows.push({ id: `claude-${c.name}`, name: c.name, icon: 'plug', type: 'claude.ai', badge: 'Conta claude.ai',
      status: c.status === 'connected' ? 'ok' : c.status === 'pending' ? 'session' : 'off',
      hint: c.status === 'connected' ? `${c.tools} ferramenta(s)` : c.status === 'pending' ? 'conectando…' : c.status });
  }
  return rows;
}

export function filterByStatus(items, statusMap, installedOnly) {
  if (!installedOnly) return items;
  return items.filter(c => isPresent(statusMap[c.id]));
}

export { authKind };
