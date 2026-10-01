import { MODELS, EFFORTS } from './router.mjs';
import { normalizeProviderRetry } from './provider-retry.mjs';
import { normalizeInputQueue } from './input-queue.mjs';
import { UI_MODES, syncUiEnterprise } from './enterprise.mjs';
import { normalizeTokenBudget } from './token-budget-governor.mjs';
import { normalizeRateLimit } from './rate-limit.mjs';
import { assertValidSettingsPatch, SettingsValidationError } from './settings-schema.mjs';
import { normalizeFeatureFlags, flagsMeta } from './feature-flags.mjs';
import { assertUiLocale } from './i18n.mjs';
import { patchContextPruningSettings } from './context-pruning.mjs';
import { mergeGoogleTasksAuth } from './google-tasks-oauth.mjs';
import { normalizeBackupSettings } from './backup-settings.mjs';

export { SettingsValidationError };

/**
 * Aplica PATCH de configurações com validação compartilhada (API e testes).
 * Retorna o objeto settings atualizado; lança Error com mensagem para 400.
 */
export function applyPluginsPatch(s, plugins, { mergePluginAuth }) {
  if (!Array.isArray(plugins)) return;
  s.plugins = plugins.filter(p => p?.name && /^[\w-]{1,40}$/.test(p.name)).map(p => {
    const prev = s.plugins.find(x => x.name === p.name);
    const auth = p.auth && typeof p.auth === 'object' ? mergePluginAuth(prev?.auth, p.auth) : prev?.auth;
    let hdr;
    if (Array.isArray(p.headers)) {
      hdr = Object.fromEntries(p.headers.slice(0, 4).filter(h => h?.name).map(h => [String(h.name).slice(0, 80), String(h.value || '').slice(0, 500)]));
    } else if (p.headers && typeof p.headers === 'object') {
      hdr = Object.fromEntries(Object.entries(p.headers).slice(0, 4).map(([k, v]) => [String(k).slice(0, 80), String(v ?? '').slice(0, 500)]));
    }
    return p.type === 'http'
      ? { name: p.name, type: 'http', url: String(p.url), enabled: p.enabled !== false, ...(auth ? { auth } : {}), ...(hdr ? { headers: hdr } : {}) }
      : { name: p.name, type: 'stdio', command: String(p.command), args: (p.args || []).map(String), enabled: p.enabled !== false };
  });
}

export function applySettingsPatch(s, b) {
  if (typeof b.name === 'string') s.name = b.name.slice(0, 80);
  if (typeof b.customInstructions === 'string') s.customInstructions = b.customInstructions.slice(0, 8000);
  if (b.defaultModel != null) {
    if (!(b.defaultModel in MODELS)) throw new Error('Modelo padrão desconhecido.');
    s.defaultModel = b.defaultModel;
  }
  if (typeof b.memory === 'boolean') s.memory = b.memory;
  if (b.approvalPolicy != null) {
    if (!['risky', 'always', 'never'].includes(b.approvalPolicy)) throw new Error('Política de aprovação inválida.');
    s.approvalPolicy = b.approvalPolicy;
  }
  if (b.inbox) {
    s.inbox = {
      maxPerHour: Math.max(1, Math.min(200, +b.inbox.maxPerHour || 20)),
      maxHops: Math.max(1, Math.min(10, +b.inbox.maxHops || 3))
    };
  }
  if (b.memoryLogInContext != null) s.memoryLogInContext = Math.max(0, Math.min(50, +b.memoryLogInContext || 0));
  if (b.claude) {
    s.claude = {
      mode: b.claude.mode === 'api' ? 'api' : 'subscription',
      useConnectors: !!b.claude.useConnectors,
      apiKey: b.claude.apiKey === '••••' ? s.claude.apiKey : String(b.claude.apiKey || '')
    };
  }
  if (b.chatgpt) s.chatgpt = { useConnectedApps: !!b.chatgpt.useConnectedApps };
  if (b.computer) {
    s.computer = {
      mode: ['boat', 'docker', 'local', 'off'].includes(b.computer.mode) ? b.computer.mode : s.computer.mode,
      vmSize: ['small', 'default', 'large'].includes(b.computer.vmSize) ? b.computer.vmSize : 'default',
      idleStopMinutes: Math.max(1, Math.min(1440, +b.computer.idleStopMinutes || 10)),
      boatApiKey: b.computer.boatApiKey === '••••' ? s.computer.boatApiKey : String(b.computer.boatApiKey || ''),
      allowLocalCommands: b.computer.allowLocalCommands === true,
      dockerImage: /^[\w./:-]{1,120}$/.test(b.computer.dockerImage || '')
        ? b.computer.dockerImage
        : (s.computer.dockerImage || 'node:22-bookworm')
    };
  }
  if (b.julia && typeof b.julia === 'object') {
    s.julia = { ...s.julia, ...(b.julia.url && /^https?:\/\//.test(b.julia.url) ? { url: b.julia.url } : {}) };
    if (b.julia.semanticCache && typeof b.julia.semanticCache === 'object') {
      s.julia.semanticCache = { ...s.julia.semanticCache };
      if (typeof b.julia.semanticCache.enabled === 'boolean') {
        s.julia.semanticCache.enabled = b.julia.semanticCache.enabled;
      }
      if (b.julia.semanticCache.minScore != null) {
        s.julia.semanticCache.minScore = +b.julia.semanticCache.minScore;
      }
      if (b.julia.semanticCache.ttlMs != null) {
        s.julia.semanticCache.ttlMs = +b.julia.semanticCache.ttlMs;
      }
      if (b.julia.semanticCache.maxEntries != null) {
        s.julia.semanticCache.maxEntries = +b.julia.semanticCache.maxEntries;
      }
    }
  }
  if (b.providerRetry && typeof b.providerRetry === 'object') {
    s.providerRetry = normalizeProviderRetry({ providerRetry: b.providerRetry });
  }
  if (b.tokenBudget && typeof b.tokenBudget === 'object') {
    s.tokenBudget = normalizeTokenBudget({ ...s.tokenBudget, ...b.tokenBudget });
  }
  if (b.logging && typeof b.logging === 'object') {
    s.logging = { ...s.logging, ...(typeof b.logging.json === 'boolean' ? { json: b.logging.json } : {}) };
  }
  if (b.ui && typeof b.ui === 'object') {
    if (b.ui.mode != null) {
      if (!UI_MODES.includes(b.ui.mode)) throw new Error('Modo de interface inválido.');
      s.ui = { ...(s.ui || {}), mode: b.ui.mode };
    }
    if (b.ui.locale != null) {
      s.ui = { ...(s.ui || {}), locale: assertUiLocale(b.ui.locale) };
    }
  }
  if (b.enterprise && typeof b.enterprise === 'object' && typeof b.enterprise.enabled === 'boolean') {
    s.enterprise = { ...(s.enterprise || {}), enabled: b.enterprise.enabled };
    if (b.ui?.mode == null) {
      s.ui = { ...(s.ui || {}), mode: b.enterprise.enabled ? 'enterprise' : 'simple' };
    }
  }
  syncUiEnterprise(s);
  if (b.rateLimit && typeof b.rateLimit === 'object') {
    s.rateLimit = normalizeRateLimit({ ...s.rateLimit, ...b.rateLimit });
  }
  if (b.flags && typeof b.flags === 'object') {
    s.flags = normalizeFeatureFlags(s, b.flags);
  }
  if (b.contextPruning != null) {
    s.contextPruning = patchContextPruningSettings(s.contextPruning, b.contextPruning);
  }
  if (b.taskSync?.google && typeof b.taskSync.google === 'object') {
    s.taskSync = s.taskSync || {};
    s.taskSync.google = mergeGoogleTasksAuth(s.taskSync.google, b.taskSync.google);
  }
  if (b.backup && typeof b.backup === 'object') {
    s.backup = normalizeBackupSettings({ ...s.backup, ...b.backup });
  }
  if (b.inputQueue && typeof b.inputQueue === 'object') {
    s.inputQueue = normalizeInputQueue({ inputQueue: { ...s.inputQueue, ...b.inputQueue } });
  }
  return s;
}

export function settingsMeta() {
  return {
    models: Object.keys(MODELS),
    efforts: EFFORTS,
    approvalPolicies: ['risky', 'always', 'never'],
    providerRetry: normalizeProviderRetry({}),
    tokenBudget: normalizeTokenBudget({}),
    rateLimit: normalizeRateLimit({}),
    flags: flagsMeta(),
    inputQueue: normalizeInputQueue({})
  };
}

/** Valida o corpo do PATCH e aplica sem gravar se inválido (muta `s` só após validação). */
export function patchSettings(s, b, pluginOpts = {}) {
  assertValidSettingsPatch(b, { flags: s.flags, existingKeys: new Set(Object.keys(s)) });
  applySettingsPatch(s, b);
  if (b.plugins !== undefined) applyPluginsPatch(s, b.plugins, pluginOpts);
  return s;
}
