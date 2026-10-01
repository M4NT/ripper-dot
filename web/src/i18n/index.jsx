import { createContext, useContext, useEffect, useMemo } from 'react';
import { DEFAULT_LOCALE, normalizeLocale, setCachedUiLocale, translateKey } from '../../../lib/i18n.mjs';
import pt from './pt-BR.js';
import en from './en.js';

const catalogs = { 'pt-BR': pt, en };
const fallback = catalogs[DEFAULT_LOCALE];

const I18nCtx = createContext({ locale: DEFAULT_LOCALE, t: k => k });

export function createTranslator(locale) {
  const loc = normalizeLocale(locale);
  const dict = catalogs[loc] || fallback;
  return (key, vars) => translateKey(dict, fallback, key, vars);
}

export function I18nProvider({ locale, children }) {
  const normalized = normalizeLocale(locale);
  const value = useMemo(() => ({ locale: normalized, t: createTranslator(normalized) }), [normalized]);
  useEffect(() => {
    setCachedUiLocale(normalized);
    document.documentElement.lang = normalized === 'en' ? 'en' : 'pt-BR';
  }, [normalized]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n() {
  return useContext(I18nCtx);
}

export function useT() {
  return useI18n().t;
}

/** Abas de configurações com rótulos traduzidos. */
export function settingsTabs(t) {
  return [
    ['profile', t('settings.tab.profile'), 'agents', t('settings.tab.profileHint')],
    ['models', t('settings.tab.models'), 'bolt', t('settings.tab.modelsHint')],
    ['computer', t('settings.tab.computer'), 'terminal', t('settings.tab.computerHint')],
    ['plugins', t('settings.tab.plugins'), 'plug', t('settings.tab.pluginsHint')],
    ['security', t('settings.tab.security'), 'key', t('settings.tab.securityHint')],
    ['memory', t('settings.tab.memory'), 'brain', t('settings.tab.memoryHint')],
    ['appearance', t('settings.tab.appearance'), 'sun', t('settings.tab.appearanceHint')],
    ['advanced', t('settings.tab.advanced'), 'layers', t('settings.tab.advancedHint')]
  ];
}
