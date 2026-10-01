/** Ciclo de vida de conectores MCP, redação de segredos e catálogo de ferramentas. */

import { redactPluginAuth, mcpHttpAuthHeaders, pluginOAuthStatus, refreshPluginOAuthToken, applyOAuthTokensToPlugin } from './mcp-oauth.mjs';
import { redactGoogleTasksSettings } from './google-tasks-oauth.mjs';
import { verifyMcpConnector } from './mcp-probe.mjs';
import { getStdioSupervisorPublicState } from './mcp-stdio-supervisor.mjs';

const NAME_RE = /^[\w-]{1,40}$/;

export function redactPluginHeaders(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return headers;
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, v ? '••••' : '']));
}

export function redactPlugin(plugin) {
  if (!plugin) return plugin;
  const out = { ...plugin };
  if (out.headers) out.headers = redactPluginHeaders(out.headers);
  if (out.auth) out.auth = redactPluginAuth(out.auth);
  return out;
}

export function redactSettingsSecrets(s) {
  return {
    ...s,
    claude: { ...s.claude, apiKey: s.claude.apiKey ? '••••' : '' },
    computer: { ...s.computer, boatApiKey: s.computer.boatApiKey ? '••••' : '' },
    plugins: (s.plugins || []).map(p => redactPlugin(p)),
    taskSync: redactGoogleTasksSettings(s.taskSync)
  };
}

export function settingsForMcpSession(s, mcpSession) {
  if (!mcpSession) return s;
  const disabled = new Set(mcpSession.disabledPlugins || []);
  return {
    ...s,
    plugins: (s.plugins || []).map(p => ({ ...p, enabled: disabled.has(p.name) ? false : p.enabled !== false })),
    claude: { ...s.claude, useConnectors: mcpSession.claudeConnectors === false ? false : !!s.claude.useConnectors }
  };
}

export function activePlugins(settings, mcpSession) {
  const s = settingsForMcpSession(settings, mcpSession);
  return (s.plugins || []).filter(p => p.enabled !== false);
}

export function listConnectorRecords(settings) {
  return (settings.plugins || []).map(p => ({
    name: p.name,
    type: p.type,
    url: p.type === 'http' ? p.url : undefined,
    command: p.type === 'stdio' ? p.command : undefined,
    args: p.type === 'stdio' ? p.args || [] : undefined,
    enabled: p.enabled !== false,
    authStatus: pluginOAuthStatus(p),
    headerNames: p.headers ? Object.keys(p.headers) : [],
    ...(p.type === 'stdio' ? { stdioSupervisor: getStdioSupervisorPublicState(p.name) } : {})
  }));
}

function validatePluginShape(p, { requireName = true } = {}) {
  if (requireName && (!p.name || !NAME_RE.test(p.name))) throw new Error('Nome inválido (use letras, números, hífen; até 40 caracteres).');
  if (p.type === 'http') {
    if (!p.url || !/^https:\/\//.test(String(p.url))) throw new Error('URL HTTPS do servidor MCP é obrigatória.');
  } else if (p.type === 'stdio') {
    if (!p.command?.trim()) throw new Error('Comando stdio é obrigatório.');
  } else throw new Error('Tipo deve ser http ou stdio.');
}

export function createPluginRecord(body, existing = []) {
  const p = {
    name: String(body.name || '').trim(),
    type: body.type === 'stdio' ? 'stdio' : 'http',
    enabled: body.enabled !== false
  };
  if (existing.some(x => x.name === p.name)) throw new Error('Já existe um conector com esse nome.');
  if (p.type === 'http') {
    p.url = String(body.url || '').trim();
  } else {
    p.command = String(body.command || '').trim();
    p.args = Array.isArray(body.args) ? body.args.map(String) : [];
  }
  validatePluginShape(p);
  return p;
}

export function updatePluginRecord(prev, body) {
  const p = { ...prev };
  if (body.enabled != null) p.enabled = body.enabled !== false;
  if (p.type === 'http' && body.url) {
    if (!/^https:\/\//.test(String(body.url))) throw new Error('URL HTTPS inválida.');
    p.url = String(body.url).trim();
  }
  if (p.type === 'stdio' && body.command) p.command = String(body.command).trim();
  if (p.type === 'stdio' && body.args) p.args = body.args.map(String);
  return p;
}

export async function listMcpToolCatalog(settings, mcpSession, opts = {}) {
  const { vaultContextFromSession, resolvePluginsVaultSecrets } = await import('./credential-vault.mjs');
  const vault = vaultContextFromSession(mcpSession, { credentialVault: opts.credentialVault || {} });
  let plugins = activePlugins(settings, mcpSession);
  if (vault.dek && opts.credentialVault) {
    plugins = await resolvePluginsVaultSecrets(plugins, vault);
  }
  const tools = [];
  const errors = [];
  for (const p of plugins) {
    try {
      const probe = await verifyMcpConnector(p, { ...opts, vault, listTools: true, refreshOAuth: true });
      if (probe.tools?.length) {
        for (const name of probe.tools) tools.push({ plugin: p.name, name });
      } else if (probe.ok && !probe.tools?.length) {
        errors.push({ plugin: p.name, reason: probe.detail || 'Nenhuma ferramenta listada.' });
      } else if (!probe.ok) {
        errors.push({
          plugin: p.name,
          reason: probe.failureReason || probe.steps?.find(s => s.status === 'error')?.detail || 'Falha ao contactar conector.',
          ...(probe.supervisor ? { supervisor: probe.supervisor } : {})
        });
      }
    } catch (e) {
      errors.push({ plugin: p.name, reason: e.message || 'Erro inesperado.' });
    }
  }
  return { tools, errors, pluginCount: plugins.length };
}

export async function refreshConnectorOAuth(db, pluginName, { fetch } = {}) {
  const idx = (db.settings.plugins || []).findIndex(p => p.name === pluginName);
  if (idx < 0) throw new Error('Conector não encontrado.');
  const plugin = db.settings.plugins[idx];
  if (plugin.type !== 'http') throw new Error('Atualização OAuth só se aplica a conectores HTTP.');
  const result = await refreshPluginOAuthToken(plugin, { fetch });
  if (!result.ok) throw new Error(result.error || 'Não foi possível atualizar o token.');
  db.settings.plugins[idx] = applyOAuthTokensToPlugin(plugin, result.tokens, {
    clientId: plugin.auth?.clientId,
    clientSecret: plugin.auth?.clientSecret,
    tokenEndpoint: plugin.auth?.tokenEndpoint
  });
  return { plugin: redactPlugin(db.settings.plugins[idx]), authStatus: pluginOAuthStatus(db.settings.plugins[idx]) };
}
