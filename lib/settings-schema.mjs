import { MODELS } from './router.mjs';
import { UI_MODES } from './enterprise.mjs';
import { UI_LOCALES } from './i18n.mjs';

export { UI_LOCALES };

/** Chaves de primeiro nível aceitas em PATCH /api/settings */
export const SETTINGS_PATCH_KEYS = new Set([
  'name',
  'customInstructions',
  'defaultModel',
  'memory',
  'approvalPolicy',
  'inbox',
  'memoryLogInContext',
  'claude',
  'chatgpt',
  'computer',
  'julia',
  'providerRetry',
  'contextPruning',
  'tokenBudget',
  'logging',
  'rateLimit',
  'plugins',
  'flags',
  'ui',
  'enterprise',
  'taskSync'
]);

/** Alinhado a lib/feature-flags.mjs (#62) — validação sem depender do módulo no boot. */
export const KNOWN_FLAG_KEYS = ['chaosUi', 'x9Card', 'socialWebhooks', 'architectHub'];

const APPROVAL_POLICIES = ['risky', 'always', 'never'];
const CLAUDE_MODES = ['subscription', 'api'];
const COMPUTER_MODES = ['boat', 'docker', 'local', 'off'];
const VM_SIZES = ['small', 'default', 'large'];
const PLUGIN_TYPES = new Set(['http', 'stdio']);
const PLUGIN_ITEM_KEYS = new Set(['name', 'type', 'url', 'command', 'args', 'enabled', 'auth', 'headers']);

/**
 * @param {unknown} patch
 * @param {{ flags?: object, existingKeys?: Set<string> }} [ctx] settings atuais
 * @returns {{ path: string, message: string }[]}
 */
export function validateSettingsPatch(patch, ctx = {}) {
  const details = [];
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    details.push({ path: '', message: 'Corpo deve ser um objeto JSON.' });
    return details;
  }

  const legacy = ctx.existingKeys instanceof Set ? ctx.existingKeys : null;
  for (const key of Object.keys(patch)) {
    if (!SETTINGS_PATCH_KEYS.has(key) && !(legacy && legacy.has(key))) {
      details.push({ path: key, message: 'Chave de configuração desconhecida.' });
    }
  }

  if (typeof patch.name === 'string' && patch.name.length > 80) {
    details.push({ path: 'name', message: 'Nome longo demais (máx. 80 caracteres).' });
  }
  if (patch.name != null && typeof patch.name !== 'string') {
    details.push({ path: 'name', message: 'Deve ser texto.' });
  }

  if (typeof patch.customInstructions === 'string' && patch.customInstructions.length > 8000) {
    details.push({ path: 'customInstructions', message: 'Instruções longas demais (máx. 8000 caracteres).' });
  }
  if (patch.customInstructions != null && typeof patch.customInstructions !== 'string') {
    details.push({ path: 'customInstructions', message: 'Deve ser texto.' });
  }

  if (patch.defaultModel != null && !(patch.defaultModel in MODELS)) {
    details.push({ path: 'defaultModel', message: 'Modelo padrão desconhecido.' });
  }

  if (patch.memory != null && typeof patch.memory !== 'boolean') {
    details.push({ path: 'memory', message: 'Deve ser booleano.' });
  }

  if (patch.approvalPolicy != null && !APPROVAL_POLICIES.includes(patch.approvalPolicy)) {
    details.push({ path: 'approvalPolicy', message: 'Política de aprovação inválida.' });
  }

  if (patch.memoryLogInContext != null && !Number.isFinite(+patch.memoryLogInContext)) {
    details.push({ path: 'memoryLogInContext', message: 'Deve ser número.' });
  }

  if (patch.inbox != null) {
    details.push(...validateInbox(patch.inbox));
  }

  if (patch.claude != null) {
    details.push(...validateClaude(patch.claude));
  }

  if (patch.chatgpt != null) {
    details.push(...validateChatgpt(patch.chatgpt));
  }

  if (patch.computer != null) {
    details.push(...validateComputer(patch.computer));
  }

  if (patch.julia != null) {
    details.push(...validateJulia(patch.julia));
  }

  if (patch.providerRetry != null) {
    details.push(...validateProviderRetry(patch.providerRetry));
  }

  if (patch.contextPruning != null) {
    details.push(...validateContextPruning(patch.contextPruning));
  }

  if (patch.tokenBudget != null) {
    details.push(...validateTokenBudget(patch.tokenBudget));
  }

  if (patch.logging != null) {
    details.push(...validateLogging(patch.logging));
  }

  if (patch.rateLimit != null) {
    details.push(...validateRateLimit(patch.rateLimit));
  }

  if (patch.plugins != null) {
    details.push(...validatePlugins(patch.plugins));
  }

  if (patch.flags != null) {
    details.push(...validateFlags(patch.flags, ctx.flags));
  }

  if (patch.ui != null) {
    details.push(...validateUi(patch.ui));
  }

  if (patch.enterprise != null) {
    details.push(...validateEnterprise(patch.enterprise));
  }

  return details;
}

function unknownKeys(obj, allowed, prefix) {
  const details = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    details.push({ path: prefix, message: 'Deve ser um objeto.' });
    return details;
  }
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      details.push({ path: prefix ? `${prefix}.${key}` : key, message: 'Chave desconhecida.' });
    }
  }
  return details;
}

function validateInbox(inbox) {
  const allowed = new Set(['maxPerHour', 'maxHops']);
  const details = unknownKeys(inbox, allowed, 'inbox');
  if (inbox.maxPerHour != null && !Number.isFinite(+inbox.maxPerHour)) {
    details.push({ path: 'inbox.maxPerHour', message: 'Deve ser número.' });
  }
  if (inbox.maxHops != null && !Number.isFinite(+inbox.maxHops)) {
    details.push({ path: 'inbox.maxHops', message: 'Deve ser número.' });
  }
  return details;
}

function validateClaude(claude) {
  const allowed = new Set(['mode', 'useConnectors', 'apiKey']);
  const details = unknownKeys(claude, allowed, 'claude');
  if (claude.mode != null && !CLAUDE_MODES.includes(claude.mode)) {
    details.push({ path: 'claude.mode', message: 'Modo Claude inválido.' });
  }
  if (claude.useConnectors != null && typeof claude.useConnectors !== 'boolean') {
    details.push({ path: 'claude.useConnectors', message: 'Deve ser booleano.' });
  }
  if (claude.apiKey != null && typeof claude.apiKey !== 'string') {
    details.push({ path: 'claude.apiKey', message: 'Deve ser texto.' });
  }
  return details;
}

function validateChatgpt(chatgpt) {
  const allowed = new Set(['useConnectedApps']);
  const details = unknownKeys(chatgpt, allowed, 'chatgpt');
  if (chatgpt.useConnectedApps != null && typeof chatgpt.useConnectedApps !== 'boolean') {
    details.push({ path: 'chatgpt.useConnectedApps', message: 'Deve ser booleano.' });
  }
  return details;
}

function validateComputer(computer) {
  const allowed = new Set(['mode', 'vmSize', 'idleStopMinutes', 'boatApiKey', 'allowLocalCommands', 'dockerImage']);
  const details = unknownKeys(computer, allowed, 'computer');
  if (computer.mode != null && !COMPUTER_MODES.includes(computer.mode)) {
    details.push({ path: 'computer.mode', message: 'Modo de computador inválido.' });
  }
  if (computer.vmSize != null && !VM_SIZES.includes(computer.vmSize)) {
    details.push({ path: 'computer.vmSize', message: 'Tamanho de VM inválido.' });
  }
  if (computer.idleStopMinutes != null && !Number.isFinite(+computer.idleStopMinutes)) {
    details.push({ path: 'computer.idleStopMinutes', message: 'Deve ser número.' });
  }
  if (computer.allowLocalCommands != null && typeof computer.allowLocalCommands !== 'boolean') {
    details.push({ path: 'computer.allowLocalCommands', message: 'Deve ser booleano.' });
  }
  if (computer.boatApiKey != null && typeof computer.boatApiKey !== 'string') {
    details.push({ path: 'computer.boatApiKey', message: 'Deve ser texto.' });
  }
  if (computer.dockerImage != null) {
    if (typeof computer.dockerImage !== 'string' || !/^[\w./:-]{1,120}$/.test(computer.dockerImage)) {
      details.push({ path: 'computer.dockerImage', message: 'Imagem Docker inválida.' });
    }
  }
  return details;
}

function validateJulia(julia) {
  const allowed = new Set(['url', 'semanticCache', 'cascade']);
  const details = unknownKeys(julia, allowed, 'julia');
  if (julia.url != null) {
    if (typeof julia.url !== 'string' || !/^https?:\/\//.test(julia.url)) {
      details.push({ path: 'julia.url', message: 'URL do Julia inválida.' });
    }
  }
  if (julia.semanticCache != null) {
    if (typeof julia.semanticCache !== 'object' || Array.isArray(julia.semanticCache)) {
      details.push({ path: 'julia.semanticCache', message: 'Deve ser um objeto.' });
    } else {
      details.push(...unknownKeys(julia.semanticCache, new Set(['enabled', 'minScore', 'ttlMs', 'maxEntries']), 'julia.semanticCache'));
    }
  }
  if (julia.cascade != null) {
    if (typeof julia.cascade !== 'object' || Array.isArray(julia.cascade)) {
      details.push({ path: 'julia.cascade', message: 'Deve ser um objeto.' });
    } else {
      details.push(...unknownKeys(
        julia.cascade,
        new Set(['enabled', 'catalogPath', 'minSuccessRate', 'modelOverrides', 'policy']),
        'julia.cascade'
      ));
      if (julia.cascade.enabled != null && typeof julia.cascade.enabled !== 'boolean') {
        details.push({ path: 'julia.cascade.enabled', message: 'Deve ser booleano.' });
      }
      if (julia.cascade.catalogPath != null && typeof julia.cascade.catalogPath !== 'string') {
        details.push({ path: 'julia.cascade.catalogPath', message: 'Deve ser string.' });
      }
      if (julia.cascade.minSuccessRate != null && !Number.isFinite(+julia.cascade.minSuccessRate)) {
        details.push({ path: 'julia.cascade.minSuccessRate', message: 'Deve ser número.' });
      }
    }
  }
  return details;
}

function validateProviderRetry(pr) {
  const allowed = new Set(['maxAttempts', 'baseDelayMs', 'maxDelayMs']);
  const details = unknownKeys(pr, allowed, 'providerRetry');
  for (const key of allowed) {
    if (pr[key] != null && !Number.isFinite(+pr[key])) {
      details.push({ path: `providerRetry.${key}`, message: 'Deve ser número.' });
    }
  }
  return details;
}

function validateContextPruning(cp) {
  const allowed = new Set(['enabled', 'maxMessages', 'maxTokens', 'keepRecent']);
  const details = unknownKeys(cp, allowed, 'contextPruning');
  if (cp.enabled != null && typeof cp.enabled !== 'boolean') {
    details.push({ path: 'contextPruning.enabled', message: 'Deve ser booleano.' });
  }
  for (const key of ['maxMessages', 'maxTokens', 'keepRecent']) {
    if (cp[key] != null && !Number.isFinite(+cp[key])) {
      details.push({ path: `contextPruning.${key}`, message: 'Deve ser número.' });
    }
  }
  return details;
}

function validatePlugins(plugins) {
  const details = [];
  if (!Array.isArray(plugins)) {
    details.push({ path: 'plugins', message: 'Deve ser uma lista.' });
    return details;
  }
  plugins.forEach((p, i) => {
    const base = `plugins[${i}]`;
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      details.push({ path: base, message: 'Entrada inválida.' });
      return;
    }
    for (const key of Object.keys(p)) {
      if (!PLUGIN_ITEM_KEYS.has(key)) {
        details.push({ path: `${base}.${key}`, message: 'Chave desconhecida.' });
      }
    }
    if (!p.name || typeof p.name !== 'string' || !/^[\w-]{1,40}$/.test(p.name)) {
      details.push({ path: `${base}.name`, message: 'Nome do conector inválido.' });
    }
    if (!PLUGIN_TYPES.has(p.type)) {
      details.push({ path: `${base}.type`, message: 'Tipo de conector inválido.' });
    }
    if (p.type === 'http' && (typeof p.url !== 'string' || !p.url)) {
      details.push({ path: `${base}.url`, message: 'URL obrigatória para conector HTTP.' });
    }
    if (p.type === 'stdio' && typeof p.command !== 'string') {
      details.push({ path: `${base}.command`, message: 'Comando obrigatório para conector stdio.' });
    }
    if (p.enabled != null && typeof p.enabled !== 'boolean') {
      details.push({ path: `${base}.enabled`, message: 'Deve ser booleano.' });
    }
    if (p.args != null && !Array.isArray(p.args)) {
      details.push({ path: `${base}.args`, message: 'Deve ser uma lista.' });
    }
    if (p.auth != null && (typeof p.auth !== 'object' || Array.isArray(p.auth))) {
      details.push({ path: `${base}.auth`, message: 'Deve ser um objeto.' });
    }
    if (p.headers != null && typeof p.headers !== 'object') {
      details.push({ path: `${base}.headers`, message: 'Deve ser objeto ou lista.' });
    }
  });
  return details;
}

function validateFlags(flags, currentFlags = {}) {
  const details = [];
  if (typeof flags !== 'object' || Array.isArray(flags)) {
    details.push({ path: 'flags', message: 'Deve ser um objeto.' });
    return details;
  }
  const allowCustom = flags.allowCustom === true || currentFlags?.allowCustom === true;
  const allowed = new Set(['allowCustom', ...KNOWN_FLAG_KEYS]);
  for (const [key, value] of Object.entries(flags)) {
    if (allowed.has(key)) {
      if (typeof value !== 'boolean') {
        details.push({ path: `flags.${key}`, message: 'Deve ser booleano.' });
      }
      continue;
    }
    if (!allowCustom) {
      details.push({ path: `flags.${key}`, message: 'Flag desconhecida (ative flags.allowCustom para chaves extras).' });
      continue;
    }
    if (!/^[\w]{1,40}$/.test(key)) {
      details.push({ path: `flags.${key}`, message: 'Nome de flag inválido.' });
    } else if (typeof value !== 'boolean') {
      details.push({ path: `flags.${key}`, message: 'Deve ser booleano.' });
    }
  }
  return details;
}

function validateUi(ui) {
  const allowed = new Set(['locale', 'mode']);
  const details = unknownKeys(ui, allowed, 'ui');
  if (ui.locale != null && !UI_LOCALES.includes(ui.locale)) {
    details.push({ path: 'ui.locale', message: 'Idioma da interface inválido.' });
  }
  if (ui.mode != null && !UI_MODES.includes(ui.mode)) {
    details.push({ path: 'ui.mode', message: 'Modo de interface inválido.' });
  }
  return details;
}

function validateEnterprise(enterprise) {
  const allowed = new Set(['enabled']);
  const details = unknownKeys(enterprise, allowed, 'enterprise');
  if (enterprise.enabled != null && typeof enterprise.enabled !== 'boolean') {
    details.push({ path: 'enterprise.enabled', message: 'Deve ser booleano.' });
  }
  return details;
}

function validateLogging(logging) {
  const allowed = new Set(['json']);
  const details = unknownKeys(logging, allowed, 'logging');
  if (logging.json != null && typeof logging.json !== 'boolean') {
    details.push({ path: 'logging.json', message: 'Deve ser booleano.' });
  }
  return details;
}

function validateRateLimit(rl) {
  const allowed = new Set(['enabled', 'chatPerMinute', 'apiPerMinute', 'windowMs']);
  const details = unknownKeys(rl, allowed, 'rateLimit');
  if (rl.enabled != null && typeof rl.enabled !== 'boolean') {
    details.push({ path: 'rateLimit.enabled', message: 'Deve ser booleano.' });
  }
  for (const key of ['chatPerMinute', 'apiPerMinute', 'windowMs']) {
    if (rl[key] != null && !Number.isFinite(+rl[key])) {
      details.push({ path: `rateLimit.${key}`, message: 'Deve ser número.' });
    }
  }
  return details;
}

function validateTokenBudget(tb) {
  const allowed = new Set(['enabled', 'periodHours', 'globalMaxTokens', 'agents', 'loopDetection']);
  const details = unknownKeys(tb, allowed, 'tokenBudget');
  if (tb.enabled != null && typeof tb.enabled !== 'boolean') {
    details.push({ path: 'tokenBudget.enabled', message: 'Deve ser booleano.' });
  }
  if (tb.periodHours != null && !Number.isFinite(+tb.periodHours)) {
    details.push({ path: 'tokenBudget.periodHours', message: 'Deve ser número.' });
  }
  if (tb.globalMaxTokens != null && tb.globalMaxTokens !== '' && !Number.isFinite(+tb.globalMaxTokens)) {
    details.push({ path: 'tokenBudget.globalMaxTokens', message: 'Deve ser número ou nulo.' });
  }
  if (tb.agents != null) {
    if (typeof tb.agents !== 'object' || Array.isArray(tb.agents)) {
      details.push({ path: 'tokenBudget.agents', message: 'Deve ser um objeto.' });
    } else {
      for (const [id, row] of Object.entries(tb.agents)) {
        if (!id || typeof id !== 'string' || id.length > 80) {
          details.push({ path: `tokenBudget.agents.${id}`, message: 'Id de agente inválido.' });
        } else if (row != null && typeof row === 'object' && !Array.isArray(row)) {
          const rowAllowed = new Set(['maxTokens']);
          details.push(...unknownKeys(row, rowAllowed, `tokenBudget.agents.${id}`));
          if (row.maxTokens != null && row.maxTokens !== '' && !Number.isFinite(+row.maxTokens)) {
            details.push({ path: `tokenBudget.agents.${id}.maxTokens`, message: 'Deve ser número.' });
          }
        } else {
          details.push({ path: `tokenBudget.agents.${id}`, message: 'Deve ser um objeto.' });
        }
      }
    }
  }
  if (tb.loopDetection != null) {
    const loopAllowed = new Set(['enabled', 'sameToolThreshold', 'windowSeconds']);
    details.push(...unknownKeys(tb.loopDetection, loopAllowed, 'tokenBudget.loopDetection'));
    if (tb.loopDetection.enabled != null && typeof tb.loopDetection.enabled !== 'boolean') {
      details.push({ path: 'tokenBudget.loopDetection.enabled', message: 'Deve ser booleano.' });
    }
    for (const key of ['sameToolThreshold', 'windowSeconds']) {
      if (tb.loopDetection[key] != null && !Number.isFinite(+tb.loopDetection[key])) {
        details.push({ path: `tokenBudget.loopDetection.${key}`, message: 'Deve ser número.' });
      }
    }
  }
  return details;
}

export class SettingsValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'SettingsValidationError';
    this.details = details;
  }
}

/** Valida o PATCH; lança SettingsValidationError com details[]. */
export function assertValidSettingsPatch(patch, ctx = {}) {
  const details = validateSettingsPatch(patch, ctx);
  if (details.length) throw new SettingsValidationError('Configurações inválidas.', details);
}
