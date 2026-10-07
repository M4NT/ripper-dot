/** Modo enterprise: espelha settings.ui.mode (fonte de verdade) e mantém enterprise.enabled em sincronia. */

export const UI_MODES = ['simple', 'enterprise'];

// Uma plataforma só por enquanto (decisão de 07/10/2026): tudo visível. Para voltar a ter modo Simples, troque para false.
export const SINGLE_MODE = process.env.RIPPER_MODES !== '1'; // RIPPER_MODES=1 religa Simples × Enterprise (os testes rodam assim)

export function getUiMode(settings) {
  if (SINGLE_MODE) return 'enterprise';
  if (!settings || typeof settings !== 'object') return 'simple';
  const m = settings.ui?.mode;
  if (m === 'enterprise') return 'enterprise';
  if (m === 'simple') return 'simple';
  if (settings.enterprise?.enabled === true) return 'enterprise';
  return 'simple';
}

export function isEnterpriseMode(settings) {
  if (process.env.RIPPER_ENTERPRISE_MODE === '1' || process.env.RIPPER_ENTERPRISE_MODE === 'true') return true;
  return getUiMode(settings) === 'enterprise';
}

/** Alinha ui.mode e enterprise.enabled após patch ou carga do banco. */
export function syncUiEnterprise(settings) {
  if (!settings || typeof settings !== 'object') return;
  if (!settings.ui || typeof settings.ui !== 'object') settings.ui = {};
  if (!settings.enterprise || typeof settings.enterprise !== 'object') settings.enterprise = {};
  const mode = getUiMode(settings);
  settings.ui.mode = mode;
  settings.enterprise.enabled = mode === 'enterprise';
}

/** Exige enterprise; lança Error com mensagem para HttpError 403. */
export function assertEnterpriseMode(settings) {
  if (!isEnterpriseMode(settings)) throw new Error('Trilha de auditoria corporativa exige modo enterprise.');
}
