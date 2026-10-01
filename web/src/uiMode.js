import { useCallback } from 'react';
import { api } from './lib.js';
import { useApp } from './app.jsx';

export const UI_MODES = ['simple', 'enterprise'];

/** Modo de interface persistido em settings.ui.mode (padrão: simples). */
export function getUiMode(settings) {
  const m = settings?.ui?.mode;
  return m === 'enterprise' ? 'enterprise' : 'simple';
}

export function isEnterpriseMode(settings) {
  return getUiMode(settings) === 'enterprise';
}

/** Abas de configurações visíveis no modo simples. */
export const SIMPLE_SETTINGS_TABS = new Set(['profile', 'appearance', 'memory', 'security']);

export function isSettingsTabAllowed(tab, settings) {
  if (isEnterpriseMode(settings)) return true;
  return SIMPLE_SETTINGS_TABS.has(tab);
}

/** Rotas principais (#/…) que exigem modo enterprise. */
export const ENTERPRISE_ONLY_ROUTES = new Set([
  'explore',
  'library',
  'projects',
  'connectors',
  'skills'
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
      await api('/api/settings', { method: 'PUT', body: { ...S.settings, ui } });
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
