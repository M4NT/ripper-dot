import { local } from '../lib.js';
import { PLUGIN_CATALOG, BUILTIN_CONNECTORS } from './catalog.js';

const KEY = 'marketplace.installed';
const AUTH_KEY = 'marketplace.authed';

export function getInstalledIds() {
  return local.get(KEY, []);
}

export function setInstalledIds(ids) {
  local.set(KEY, ids);
}

export function isPluginInstalled(id, settings) {
  const ids = getInstalledIds();
  if (ids.includes(id)) return true;
  const cat = PLUGIN_CATALOG.find(p => p.id === id);
  if (cat?.mcp?.name && settings.plugins?.some(p => p.name === cat.mcp.name)) return true;
  return false;
}

export function installPlugin(id, settings) {
  const ids = getInstalledIds();
  if (!ids.includes(id)) setInstalledIds([...ids, id]);
  const cat = PLUGIN_CATALOG.find(p => p.id === id);
  const plugins = [...(settings.plugins || [])];
  if (cat?.mcp && !plugins.some(p => p.name === cat.mcp.name)) {
    plugins.push({ ...cat.mcp, enabled: true });
  }
  return plugins;
}

export function uninstallPlugin(id, settings) {
  setInstalledIds(getInstalledIds().filter(x => x !== id));
  const cat = PLUGIN_CATALOG.find(p => p.id === id);
  if (!cat?.mcp) return settings.plugins;
  return settings.plugins.filter(p => p.name !== cat.mcp.name);
}

export function isAuthed(id) {
  return local.get(AUTH_KEY, {})[id] === true;
}

export function setAuthed(id, v) {
  const o = local.get(AUTH_KEY, {});
  o[id] = v;
  local.set(AUTH_KEY, o);
}

/** Plugins instalados para a tela “Gerenciar”. */
export function listInstalledPlugins(settings) {
  const seen = new Set();
  const out = [];
  const bundled = PLUGIN_CATALOG.find(p => p.id === 'agent-compat');
  if (bundled) { seen.add(bundled.id); out.push(bundled); }
  for (const p of PLUGIN_CATALOG) {
    if (isPluginInstalled(p.id, settings) && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  for (const p of settings.plugins || []) {
    const match = PLUGIN_CATALOG.find(c => c.mcp?.name === p.name);
    if (match && !seen.has(match.id)) { seen.add(match.id); out.push(match); }
    else if (!match) {
      out.push({ id: `custom-${p.name}`, name: p.name, icon: 'agent-compat', desc: `${p.type === 'http' ? 'HTTP' : 'stdio'} MCP`, connectors: 1, skills: 0, custom: true });
    }
  }
  return out;
}

export function installedCount(settings) {
  return listInstalledPlugins(settings).length;
}

/** Conectores “Meus” derivados de configuração real + entradas fixas de UI. */
export function listMyConnectors(settings) {
  const rows = [];
  for (const b of BUILTIN_CONNECTORS) {
    if (b.settingsKey === 'github') {
      const on = settings.plugins?.some(p => p.name === 'github' && p.enabled !== false);
      if (on || settings.claude?.useConnectors) rows.push({ ...b, status: on ? 'ok' : 'session' });
      continue;
    }
    if (b.fromPlugin) {
      if (settings.plugins?.some(p => p.name === b.fromPlugin)) rows.push(b);
      continue;
    }
    rows.push(b);
  }
  const pluginNames = new Set();
  for (const p of settings.plugins || []) {
    if (pluginNames.has(p.name)) continue;
    pluginNames.add(p.name);
    const cat = PLUGIN_CATALOG.find(c => c.mcp?.name === p.name);
    const sessionOnly = cat?.id === 'vercel';
    rows.push({
      id: `plugin-${p.name}`,
      name: sessionOnly ? p.name : (cat?.name || p.name),
      icon: cat?.icon || 'plug',
      type: 'Web',
      badge: 'Plugin',
      status: sessionOnly ? 'session' : (p.enabled !== false ? 'ok' : 'off'),
      hint: cat ? `Fornecido pelo plugin ${cat.name}` : undefined
    });
  }
  return rows;
}
