/** Cliente: modo enterprise (espelha lib/enterprise.mjs). */
export function isEnterpriseMode(settings) {
  if (!settings) return false;
  if (settings.enterprise?.enabled === true) return true;
  return settings.ui?.mode === 'enterprise';
}
