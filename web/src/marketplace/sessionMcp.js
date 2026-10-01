import { local } from '../lib.js';
import { BUILTIN_CONNECTORS } from './catalog.js';
import { getVaultDekB64url } from '../vault/crypto.js';

const KEY = 'mcp.session.disabled';

/** IDs desabilitados só nesta sessão do navegador (nomes de plugin MCP ou ids de conector UI). */
export function getSessionDisabled() {
  return local.get(KEY, []);
}

export function isSessionEnabled(id) {
  return !getSessionDisabled().includes(id);
}

export function setSessionEnabled(id, enabled) {
  const cur = new Set(getSessionDisabled());
  if (enabled) cur.delete(id);
  else cur.add(id);
  local.set(KEY, [...cur]);
}

/** Payload enviado ao servidor: nomes de plugins MCP e flags especiais. */
export function sessionPayload() {
  const disabled = getSessionDisabled();
  const uiOnly = new Set(['claude-chrome', 'inspo', 'claude-connectors']);
  let vaultDek;
  try { vaultDek = getVaultDekB64url(); } catch { vaultDek = undefined; }
  return {
    disabledPlugins: disabled.filter(id => !uiOnly.has(id)),
    claudeConnectors: !disabled.includes('claude-connectors'),
    ...(vaultDek ? { vaultDek } : {})
  };
}

export function listSessionConnectors(settings) {
  const disabled = new Set(getSessionDisabled());
  const rows = [];
  for (const b of BUILTIN_CONNECTORS) {
    if (b.fromPlugin) {
      if (settings.plugins?.some(p => p.name === b.fromPlugin)) {
        rows.push({ id: b.fromPlugin, label: b.name, kind: 'connector', enabled: !disabled.has(b.fromPlugin) });
      }
      continue;
    }
    if (b.settingsKey === 'github') {
      if (settings.plugins?.some(p => p.name === 'github') || settings.claude?.useConnectors) {
        rows.push({ id: 'github', label: b.name, kind: 'connector', enabled: !disabled.has('github') });
      }
      continue;
    }
    rows.push({ id: b.id, label: b.name, kind: 'connector', enabled: !disabled.has(b.id) });
  }
  for (const p of settings.plugins || []) {
    if (rows.some(r => r.id === p.name)) continue;
    rows.push({ id: p.name, label: p.name, kind: 'plugin', enabled: p.enabled !== false && !disabled.has(p.name) });
  }
  return rows;
}
