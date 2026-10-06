import { MODELS, EFFORTS } from './router.mjs';
import { normalizeRepo } from './github.mjs';
import { normalizeProviderRetry } from './provider-retry.mjs';
import { normalizeInputQueue } from './input-queue.mjs';
import { UI_MODES, syncUiEnterprise, isEnterpriseMode } from './enterprise.mjs';
import { normalizeTokenBudget } from './token-budget-governor.mjs';
import { normalizeRateLimit } from './rate-limit.mjs';
import { assertValidSettingsPatch, SettingsValidationError } from './settings-schema.mjs';
import { normalizeFeatureFlags, flagsMeta } from './feature-flags.mjs';
import { assertUiLocale } from './i18n.mjs';
import { patchContextPruningSettings } from './context-pruning.mjs';
import { mergeGoogleTasksAuth } from './google-tasks-oauth.mjs';
import { normalizeBackupSettings } from './backup-settings.mjs';
import { existsSync } from 'node:fs';

const CONSENT_HOW = new Set(['mensagem', 'formulario', 'contrato', 'verbal', 'outro']);
/** Registro de consentimento do WhatsApp: { dígitos: { at, how, note? } }; máx. 2000. */
export function normalizeConsents(raw) {
  const out = {};
  for (const [n, c] of Object.entries(raw && typeof raw === 'object' ? raw : {}).slice(0, 2000)) {
    const d = String(n).replace(/\D/g, '');
    if (d.length < 10 || !c || typeof c !== 'object') continue;
    out[d] = { at: Number.isFinite(+c.at) && +c.at > 0 ? +c.at : Date.now(), how: CONSENT_HOW.has(c.how) ? c.how : 'outro', ...(c.note ? { note: String(c.note).slice(0, 200) } : {}) };
  }
  return out;
}
import { isAbsolute } from 'node:path';
import { sandboxDefaults } from './exec-sandbox.mjs';
import { DEFAULT_LGPD_SETTINGS, normalizeLgpdSettings } from './lgpd-pii.mjs';
import { sanitizeStyleFields } from './agent-style.mjs';
import { applyRetentionSettingsPatch } from './retention-ttl.mjs';
import { applySocialWebhooksPatch } from './social-webhooks.mjs';
import { applyChaosPatch, chaosDefaultsForStore } from './chaos.mjs';
import { normalizeBrand } from './brand.mjs';
import { normalizeModelPolicy } from './router.mjs';
import { normalizeOpenRouter, syncOpenRouterModels } from './openrouter.mjs';
import { normalizeBilling } from './paid-usage.mjs';
import { normalizeAccounts, PRINCIPAL } from './claude-accounts.mjs';
import { normalizeWhatsapp } from './whatsapp.mjs';

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
    // A API devolve headers mascarados; salvar a lista de volta não pode trocar o valor real por "••••".
    if (hdr) for (const [k, v] of Object.entries(hdr)) if (v === '••••' && prev?.headers?.[k] != null) hdr[k] = prev.headers[k];
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
      maxHops: Math.max(1, Math.min(10, +b.inbox.maxHops || 3)),
      callTimeoutSeconds: Math.max(5, Math.min(300, +b.inbox.callTimeoutSeconds || 120))
    };
  }
  if (b.memoryLogInContext != null) s.memoryLogInContext = Math.max(0, Math.min(50, +b.memoryLogInContext || 0));
  if (b.claude) {
    const prevDefault = s.claude?.defaultAccount;
    s.claude = {
      mode: b.claude.mode === 'api' ? 'api' : 'subscription',
      useConnectors: !!b.claude.useConnectors,
      apiKey: b.claude.apiKey === '••••' ? s.claude.apiKey : String(b.claude.apiKey || ''),
      accounts: normalizeAccounts(b.claude.accounts, s.claude.accounts),
      autoSwitch: (b.claude.autoSwitch ?? s.claude.autoSwitch) !== false
    };
    const ids = [PRINCIPAL, ...s.claude.accounts.map(a => a.id)];
    const want = b.claude.defaultAccount ?? prevDefault;
    s.claude.defaultAccount = ids.includes(want) ? want : PRINCIPAL;
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
    if (b.julia.cascade && typeof b.julia.cascade === 'object') {
      s.julia.cascade = { ...s.julia.cascade, ...b.julia.cascade };
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
  if (b.github && typeof b.github === 'object') {
    const g = b.github, cur = s.github || {};
    s.github = { ...cur,
      token: typeof g.token === 'string' && g.token && g.token !== '••••' ? g.token.trim().slice(0, 300) : cur.token || '',
      repos: Array.isArray(g.repos) ? [...new Set(g.repos.map(normalizeRepo).filter(Boolean))].slice(0, 20) : cur.repos || [],
      agentId: 'agentId' in g ? (g.agentId || null) : cur.agentId ?? null,
      everyMinutes: Number.isInteger(g.everyMinutes) ? Math.min(60, Math.max(2, g.everyMinutes)) : cur.everyMinutes ?? 5
    };
  }
  if (b.email && typeof b.email === 'object') {
    const e = b.email, cur = s.email || {};
    s.email = {
      enabled: 'enabled' in e ? e.enabled === true : !!cur.enabled,
      user: typeof e.user === 'string' ? e.user.trim().slice(0, 200) : cur.user || '',
      pass: typeof e.pass === 'string' && e.pass && e.pass !== '••••' ? e.pass.slice(0, 500) : cur.pass || '', // máscara = manter
      imapHost: typeof e.imapHost === 'string' ? e.imapHost.trim().slice(0, 200) : cur.imapHost || '',
      smtpHost: typeof e.smtpHost === 'string' ? e.smtpHost.trim().slice(0, 200) : cur.smtpHost || '',
      imapPort: Number.isInteger(e.imapPort) ? e.imapPort : cur.imapPort ?? 993,
      smtpPort: Number.isInteger(e.smtpPort) ? e.smtpPort : cur.smtpPort ?? 465
    };
  }
  if (b.pulse && typeof b.pulse === 'object') {
    s.pulse = {
      enabled: 'enabled' in b.pulse ? b.pulse.enabled !== false : s.pulse?.enabled !== false,
      hour: Number.isInteger(b.pulse.hour) ? Math.min(23, Math.max(0, b.pulse.hour)) : (s.pulse?.hour ?? 8),
      whatsapp: 'whatsapp' in b.pulse ? b.pulse.whatsapp === true : !!s.pulse?.whatsapp,
      whatsappTo: typeof b.pulse.whatsappTo === 'string' ? b.pulse.whatsappTo.replace(/\D/g, '').slice(0, 15) : (s.pulse?.whatsappTo || '')
    };
  }
  if (b.backup && typeof b.backup === 'object') {
    const copyTo = typeof b.backup.copyTo === 'string' ? b.backup.copyTo.trim() : '';
    if (copyTo && copyTo !== s.backup?.copyTo && (!isAbsolute(copyTo) || !existsSync(copyTo))) throw new Error(`A pasta da cópia extra não existe ou não é um caminho completo: ${copyTo}`);
    s.backup = normalizeBackupSettings({ ...s.backup, ...b.backup, ...('enabled' in b.backup && b.backup.enabled !== s.backup?.enabled ? { choseAt: Date.now() } : {}) });
  }
  if (b.inputQueue && typeof b.inputQueue === 'object') {
    s.inputQueue = normalizeInputQueue({ inputQueue: { ...s.inputQueue, ...b.inputQueue } });
  }
  if (b.sandbox && typeof b.sandbox === 'object') {
    const base = { ...sandboxDefaults(), ...(s.sandbox || {}) };
    const net = b.sandbox.network;
    s.sandbox = {
      enabled: !!b.sandbox.enabled,
      image: /^[\w./:@-]{1,120}$/.test(b.sandbox.image || '') ? String(b.sandbox.image) : base.image,
      network: net === 'bridge' ? 'bridge' : 'none',
      memory: /^[\w.]{1,16}$/.test(b.sandbox.memory || '') ? String(b.sandbox.memory) : base.memory,
      cpus: /^[\d.]{1,8}$/.test(String(b.sandbox.cpus ?? '')) ? String(b.sandbox.cpus) : base.cpus,
      timeoutSeconds: Math.max(5, Math.min(3600, +b.sandbox.timeoutSeconds || base.timeoutSeconds))
    };
  }
  if (b.social && typeof b.social === 'object') {
    if (b.social.webhooks != null) applySocialWebhooksPatch(s, b.social.webhooks);
  }
  if (b.lgpd && typeof b.lgpd === 'object') {
    s.lgpd = normalizeLgpdSettings({
      ...s.lgpd,
      ...b.lgpd,
      categories: { ...(s.lgpd?.categories || {}), ...(b.lgpd.categories || {}) }
    });
  }
  if (b.whatsappWeb && typeof b.whatsappWeb === 'object') {
    const prev = s.whatsappWeb || {}, w = b.whatsappWeb;
    const next = {
      enabled: (w.enabled ?? prev.enabled) === true,
      paused: (w.paused ?? prev.paused) === true,
      agentId: String(w.agentId ?? prev.agentId ?? ''),
      // só dígitos, sem repetidos; máx. 200
      allowlist: [...new Set((w.allowlist ?? prev.allowlist ?? []).map(n => String(n).replace(/\D/g, '')).filter(n => n.length >= 10))].slice(0, 200),
      // opt-in: guardar e ler todas as conversas individuais (contatos, histórico, seu estilo)
      readAll: (w.readAll ?? prev.readAll) === true,
      // grupos: só leitura, e só junto com readAll
      readGroups: (w.readGroups ?? prev.readGroups) === true && (w.readAll ?? prev.readAll) === true,
      // autonomia por contato: auto (responde sozinho) | draft (rascunho para aprovar) | read (só lê)
      contactModes: Object.fromEntries(Object.entries(w.contactModes ?? prev.contactModes ?? {})
        .map(([n, m]) => [String(n).replace(/\D/g, ''), m]).filter(([n, m]) => n.length >= 10 && ['auto', 'draft', 'read'].includes(m)).slice(0, 2000)),
      // consentimento do cliente: exigir (opt-in) e o registro { número: { at, how } }
      requireConsent: (w.requireConsent ?? prev.requireConsent) === true,
      consents: normalizeConsents(w.consents ?? prev.consents)
    };
    if (next.enabled && !isEnterpriseMode(s)) throw new Error('WhatsApp por QR disponível apenas no modo enterprise.');
    s.whatsappWeb = next;
  }
  if (b.whatsapp && typeof b.whatsapp === 'object') {
    const next = normalizeWhatsapp(b.whatsapp, s.whatsapp || {});
    if (next.enabled && !isEnterpriseMode(s)) throw new Error('Canal WhatsApp disponível apenas no modo enterprise.');
    s.whatsapp = next;
  }
  if (b.billing && typeof b.billing === 'object') s.billing = normalizeBilling(b.billing, s.billing);
  if (b.openrouter && typeof b.openrouter === 'object') {
    s.openrouter = normalizeOpenRouter(b.openrouter, s.openrouter);
    syncOpenRouterModels(s); // antes da política de modelos, que só aceita ids registrados
  }
  for (const prov of ['openai', 'gemini', 'ollama']) {
    if (!b[prov] || typeof b[prov] !== 'object') continue;
    s[prov] = normalizeOpenRouter(b[prov], s[prov] || {});
    syncOpenRouterModels(s);
  }
  if (b.models && typeof b.models === 'object') {
    s.models = normalizeModelPolicy({
      enabled: { ...(s.models?.enabled || {}), ...(b.models.enabled || {}) },
      maxEffort: { ...(s.models?.maxEffort || {}), ...(b.models.maxEffort || {}) }
    });
    // Teto removido na tela chega como '' ou null: tira do mapa.
    for (const [id, v] of Object.entries(b.models.maxEffort || {})) if (!v) delete s.models.maxEffort[id];
  }
  if (b.defaults && typeof b.defaults === 'object') {
    s.defaults = s.defaults || { agentStyle: {} };
    if (b.defaults.agentStyle && typeof b.defaults.agentStyle === 'object') {
      s.defaults.agentStyle = sanitizeStyleFields(b.defaults.agentStyle, s.defaults.agentStyle || {});
    }
  }
  if (b.privacy && typeof b.privacy === 'object') {
    s.privacy = {
      ...(s.privacy || {}),
      ...(typeof b.privacy.lgpdEnabled === 'boolean' ? { lgpdEnabled: b.privacy.lgpdEnabled } : {})
    };
  }
  if (b.dataRetention && typeof b.dataRetention === 'object') {
    s.dataRetention = {
      ...(s.dataRetention || {}),
      ...(typeof b.dataRetention.autoPurgeEnabled === 'boolean' ? { autoPurgeEnabled: b.dataRetention.autoPurgeEnabled } : {}),
      ...(b.dataRetention.purgeAfterDays != null ? { purgeAfterDays: Math.max(1, Math.min(3650, +b.dataRetention.purgeAfterDays || 90)) } : {})
    };
  }
  if (b.retention && typeof b.retention === 'object') {
    applyRetentionSettingsPatch(s, b.retention);
  }
  if (b.chaos && typeof b.chaos === 'object') {
    applyChaosPatch(s, b.chaos);
  }
  if (b.brand && typeof b.brand === 'object') {
    if (!isEnterpriseMode(s)) throw new Error('Marca personalizada disponível apenas no modo enterprise.');
    s.brand = normalizeBrand({ ...(s.brand || {}), ...b.brand, links: { ...(s.brand?.links || {}), ...(b.brand.links || {}) } });
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
    inputQueue: normalizeInputQueue({}),
    sandbox: sandboxDefaults(),
    lgpd: DEFAULT_LGPD_SETTINGS,
    chaos: chaosDefaultsForStore()
  };
}

/** Valida o corpo do PATCH e aplica sem gravar se inválido (muta `s` só após validação). */
export function patchSettings(s, b, pluginOpts = {}) {
  assertValidSettingsPatch(b, { flags: s.flags, existingKeys: new Set(Object.keys(s)) });
  applySettingsPatch(s, b);
  if (b.plugins !== undefined) applyPluginsPatch(s, b.plugins, pluginOpts);
  return s;
}
