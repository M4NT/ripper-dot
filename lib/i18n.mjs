/** Idiomas suportados na interface (settings.ui.locale). */
export const DEFAULT_LOCALE = 'pt-BR';
export const UI_LOCALES = ['pt-BR', 'en'];

const UI_LOCALE_SET = new Set(UI_LOCALES);

/** Normaliza entrada do usuário ou do SO para um locale suportado. */
export function normalizeLocale(value) {
  if (value === 'en' || value === 'en-US') return 'en';
  if (value === 'pt-BR' || value === 'pt') return 'pt-BR';
  return DEFAULT_LOCALE;
}

/** Valida valor persistido em settings.ui.locale; lança se inválido. */
export function assertUiLocale(value) {
  if (!UI_LOCALE_SET.has(value)) throw new Error('Idioma da interface inválido.');
  return value;
}

const API_ERROR_EN = {
  'Modelo padrão desconhecido.': 'Unknown default model.',
  'Política de aprovação inválida.': 'Invalid approval policy.',
  'Idioma da interface inválido.': 'Invalid interface language.'
};

/** Mapa fino para alguns erros 400 expostos ao usuário (logs continuam em PT). */
export function translateApiError(message, locale) {
  if (!message || normalizeLocale(locale) !== 'en') return message;
  return API_ERROR_EN[message] || message;
}

const RELATIVE = {
  'pt-BR': {
    now: 'agora',
    min: n => `${n} min`,
    h: n => `${n} h`,
    d: n => `${n} d`,
    date: t => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
  },
  en: {
    now: 'now',
    min: n => `${n} min`,
    h: n => `${n} h`,
    d: n => `${n} d`,
    date: t => new Date(t).toLocaleDateString('en-US', { day: '2-digit', month: 'short' })
  }
};

export function fmtAgoLocalized(timestamp, locale = DEFAULT_LOCALE) {
  const r = RELATIVE[normalizeLocale(locale)] || RELATIVE[DEFAULT_LOCALE];
  const s = (Date.now() - timestamp) / 1000;
  if (s < 60) return r.now;
  if (s < 3600) return r.min(Math.floor(s / 60));
  if (s < 86400) return r.h(Math.floor(s / 3600));
  if (s < 7 * 86400) return r.d(Math.floor(s / 86400));
  return r.date(timestamp);
}

let cachedUiLocale = DEFAULT_LOCALE;

/** Locale da UI fora do React (ex.: api() antes do Provider montar). */
export function getCachedUiLocale() {
  return cachedUiLocale;
}

export function setCachedUiLocale(locale) {
  cachedUiLocale = normalizeLocale(locale);
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem('ripper.uiLocale', JSON.stringify(cachedUiLocale));
  } catch {}
}

if (typeof localStorage !== 'undefined') {
  try {
    const stored = localStorage.getItem('ripper.uiLocale');
    if (stored != null) cachedUiLocale = normalizeLocale(JSON.parse(stored));
  } catch {}
}

/** Resolve chave com fallback; substitui {name} por vars.name */
export function translateKey(catalog, fallbackCatalog, key, vars) {
  let text = catalog?.[key] ?? fallbackCatalog?.[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}
