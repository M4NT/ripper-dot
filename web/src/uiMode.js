import { useCallback } from 'react';
import { api } from './lib.js';
import { useApp } from './app.jsx';

export const UI_MODES = ['simple', 'enterprise'];

/** Modo de interface persistido em settings.ui.mode (padrão: simples). */
// Uma plataforma só por enquanto (decisão de 07/10/2026): tudo visível. Para voltar a ter modo Simples, troque para false.
export const SINGLE_MODE = true;

export function getUiMode(settings) {
  if (SINGLE_MODE) return 'enterprise';
  if (!settings) return 'simple';
  const m = settings.ui?.mode;
  if (m === 'enterprise') return 'enterprise';
  if (m === 'simple') return 'simple';
  if (settings.enterprise?.enabled === true) return 'enterprise';
  return 'simple';
}

export function isEnterpriseMode(settings) {
  return getUiMode(settings) === 'enterprise';
}

/** Marca na chrome (sidebar): só no modo enterprise; simples sempre Ripper padrão. */
export function brandForChrome(settings) {
  if (!isEnterpriseMode(settings)) return null;
  return settings?.brand || null;
}

/** Abas de configurações visíveis no modo simples. */
// Provedores de IA ('models') também no simples: é onde ficam as contas do Claude (pessoal/Teams)
export const SIMPLE_SETTINGS_TABS = new Set(['profile', 'models', 'channels', 'appearance', 'memory', 'security', 'backup']);

export function isSettingsTabAllowed(tab, settings) {
  if (isEnterpriseMode(settings)) return true;
  return SIMPLE_SETTINGS_TABS.has(tab);
}

/** Rotas principais (#/…) que exigem modo enterprise. A Biblioteca não: são as entregas dos agentes. */
export const ENTERPRISE_ONLY_ROUTES = new Set([
  'explore',
  'projects',
  'connectors',
  'skills',
  'admin'
]);

export function isRouteAllowed(parts, settings) {
  const p0 = parts[0] || '';
  if (!isEnterpriseMode(settings) && ENTERPRISE_ONLY_ROUTES.has(p0)) return false;
  if (p0 === 'settings' && parts[1] && !isSettingsTabAllowed(parts[1], settings)) return false;
  if (p0 === 'p') return isEnterpriseMode(settings); // projetos
  return true;
}

export function useUiMode() {
  const { S, refresh, toast } = useApp();
  const mode = getUiMode(S?.settings);
  const setMode = useCallback(async next => {
    if (!UI_MODES.includes(next)) return;
    try {
      const ui = { ...(S.settings.ui || {}), mode: next };
      const enterprise = { ...(S.settings.enterprise || {}), enabled: next === 'enterprise' };
      await api('/api/settings', { method: 'PUT', body: { ui, enterprise } });
      await refresh();
      toast(next === 'enterprise' ? 'Modo enterprise ativado' : 'Modo simples ativado');
    } catch (e) {
      toast(e.message, 'error');
    }
  }, [S, refresh, toast]);
  return {
    mode,
    isEnterprise: mode === 'enterprise',
    setMode,
    toggleMode: () => setMode(mode === 'enterprise' ? 'simple' : 'enterprise')
  };
}
