/** Modo enterprise: superfície de operações (Admin Center) e políticas ampliadas. */

export const UI_MODES = ['simple', 'enterprise'];

export function isEnterpriseMode(settings) {
  if (!settings || typeof settings !== 'object') return false;
  if (settings.enterprise?.enabled === true) return true;
  return settings.ui?.mode === 'enterprise';
}

export function normalizeEnterpriseSettings(settings) {
  const s = settings || {};
  const ui = s.ui && typeof s.ui === 'object' ? s.ui : {};
  const enterprise = s.enterprise && typeof s.enterprise === 'object' ? s.enterprise : {};
  const mode = UI_MODES.includes(ui.mode) ? ui.mode : 'simple';
  return {
    ui: { mode },
    enterprise: { enabled: enterprise.enabled === true }
  };
}
