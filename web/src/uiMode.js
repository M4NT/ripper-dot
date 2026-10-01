/** Modo de interface: simples (padrão) ou enterprise (mais opções visíveis). */
export function uiMode(settings) {
  const m = settings?.ui?.mode;
  return m === 'enterprise' ? 'enterprise' : 'simple';
}

export function isEnterpriseUi(settings) {
  return uiMode(settings) === 'enterprise';
}
