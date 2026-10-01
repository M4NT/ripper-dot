/** Chaves conhecidas (allowlist) para settings.flags. */
export const KNOWN_FLAG_KEYS = ['chaosUi', 'x9Card', 'socialWebhooks', 'architectHub'];

/** Metadados para API/UI (rótulos em português). */
export const FLAG_CATALOG = [
  { key: 'chaosUi', label: 'Interface caótica', desc: 'Elementos visuais experimentais para testes internos.' },
  { key: 'x9Card', label: 'Cartão X9', desc: 'Painel e atalhos do modo X9 na interface.' },
  { key: 'socialWebhooks', label: 'Webhooks sociais', desc: 'Entrada e saída de eventos em canais sociais conectados.' },
  { key: 'architectHub', label: 'Hub Architect', desc: 'Área de planejamento e revisão do Architect.' }
];

export const DEFAULT_FLAGS = Object.fromEntries(
  [...KNOWN_FLAG_KEYS.map(k => [k, false]), ['allowCustom', false]]
);

/**
 * Normaliza settings.flags: só booleanos; chaves desconhecidas só se allowCustom.
 * @param {object} settings - objeto settings ou parcial com .flags
 * @param {object} [patch] - valores a mesclar antes de normalizar
 */
export function normalizeFeatureFlags(settings = {}, patch) {
  const prev = settings.flags && typeof settings.flags === 'object' ? settings.flags : {};
  const merged = patch && typeof patch === 'object' ? { ...prev, ...patch } : prev;
  const allowCustom = merged.allowCustom === true;

  const out = { allowCustom };
  for (const key of KNOWN_FLAG_KEYS) {
    out[key] = merged[key] === true;
  }
  if (allowCustom) {
    for (const [key, value] of Object.entries(merged)) {
      if (key === 'allowCustom' || KNOWN_FLAG_KEYS.includes(key)) continue;
      if (/^[\w]{1,40}$/.test(key) && typeof value === 'boolean') out[key] = value;
    }
  }
  return out;
}

/** Mapa efetivo de flags (sem allowCustom) para consumo em API/UI. */
export function effectiveFeatureFlags(settings = {}) {
  const n = normalizeFeatureFlags(settings);
  const { allowCustom, ...flags } = n;
  return flags;
}

/** @param {object} dbOrSettings - db com .settings ou settings direto */
export function isFlagEnabled(dbOrSettings, key) {
  if (!key || typeof key !== 'string') return false;
  const settings = dbOrSettings?.settings ? dbOrSettings.settings : dbOrSettings;
  const flags = effectiveFeatureFlags(settings);
  return flags[key] === true;
}

export function flagsMeta() {
  return { catalog: FLAG_CATALOG, known: KNOWN_FLAG_KEYS };
}
