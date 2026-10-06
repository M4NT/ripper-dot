/** Ciclo de vida de conectores MCP, redação de segredos e catálogo de ferramentas. */

import { redactWhatsapp } from './whatsapp.mjs';
import { redactPluginAuth, mcpHttpAuthHeaders, pluginOAuthStatus, refreshPluginOAuthToken, applyOAuthTokensToPlugin, mergePluginAuth } from './mcp-oauth.mjs';
import { redactGoogleTasksSettings } from './google-tasks-oauth.mjs';
import { redactSocialWebhooks } from './social-webhooks.mjs';
import { verifyMcpConnector } from './mcp-probe.mjs';
import { getStdioSupervisorPublicState } from './mcp-stdio-supervisor.mjs';
import { resolvePluginWithVault, persistOAuthTokensInVault } from './connection-vault.mjs';

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
    openrouter: { models: s.openrouter?.models || [], apiKey: s.openrouter?.apiKey ? '••••' : '' },
    openai: { models: s.openai?.models || [], apiKey: s.openai?.apiKey ? '••••' : '' },
    gemini: { models: s.gemini?.models || [], apiKey: s.gemini?.apiKey ? '••••' : '' },
    computer: { ...s.computer, boatApiKey: s.computer.boatApiKey ? '••••' : '' },
    plugins: (s.plugins || []).map(p => redactPlugin(p)),
    taskSync: redactGoogleTasksSettings(s.taskSync),
    social: s.social ? { webhooks: redactSocialWebhooks(s.social.webhooks) } : { webhooks: [] },
    whatsapp: redactWhatsapp(s.whatsapp),
    email: s.email ? { ...s.email, pass: s.email.pass ? '••••' : '' } : s.email,
    github: s.github ? { ...s.github, token: s.github.token ? '••••' : '' } : s.github,
    push: { vapidPublicKey: s.push?.vapidPublicKey || '' }
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
  if (p.url !== prev.url || p.command !== prev.command || JSON.stringify(p.args) !== JSON.stringify(prev.args)) delete p.readOnlyTools;
  return p;
}

/**
 * Guarda no conector os nomes marcados readOnlyHint (annotations MCP) na última listagem.
 * Em autonomia somente leitura só essas ferramentas do conector ficam liberadas. true = mudou.
 */
export function rememberReadOnlyTools(settings, pluginName, probe) {
  const p = (settings?.plugins || []).find(x => x.name === pluginName);
  if (!p || !Array.isArray(probe?.tools) || !probe.tools.length) return false;
  const next = [...new Set((probe.readOnlyTools || []).map(String))].sort();
  if (JSON.stringify(p.readOnlyTools || []) === JSON.stringify(next) && p.readOnlyTools) return false;
  p.readOnlyTools = next;
  return true;
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
    const resolved = resolvePluginWithVault(p, { agentId: opts.agentId });
    try {
      const probe = await verifyMcpConnector(resolved, { ...opts, vault, listTools: true, refreshOAuth: true, plugin: resolved, chaosSettings: settings });
      if (probe.tools?.length) {
        for (const name of probe.tools) tools.push({ plugin: p.name, name });
        if (rememberReadOnlyTools(settings, p.name, probe)) opts.onChange?.();
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
  const resolved = resolvePluginWithVault(plugin, { internal: true });
  if (plugin.type !== 'http') throw new Error('Atualização OAuth só se aplica a conectores HTTP.');
  const result = await refreshPluginOAuthToken(resolved, { fetch });
  if (!result.ok) throw new Error(result.error || 'Não foi possível atualizar o token.');
  const nextPlugin = applyOAuthTokensToPlugin(resolved, result.tokens, {
    clientId: plugin.auth?.clientId,
    clientSecret: plugin.auth?.clientSecret,
    tokenEndpoint: plugin.auth?.tokenEndpoint
  });
  db.settings.plugins[idx] = persistOAuthTokensInVault(
    { ...plugin, auth: nextPlugin.auth },
    result.tokens,
    {
      clientId: plugin.auth?.clientId,
      clientSecret: plugin.auth?.clientSecret,
      tokenEndpoint: plugin.auth?.tokenEndpoint
    }
  );
  return { plugin: redactPlugin(db.settings.plugins[idx]), authStatus: pluginOAuthStatus(db.settings.plugins[idx]) };
}
