import { MODELS, EFFORTS } from './router.mjs';
import { normalizeProviderRetry } from './provider-retry.mjs';
import { normalizeTokenBudget } from './token-budget-governor.mjs';

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
  if (b.julia?.url && /^https?:\/\//.test(b.julia.url)) s.julia = { url: b.julia.url };
  if (b.providerRetry && typeof b.providerRetry === 'object') {
    s.providerRetry = normalizeProviderRetry({ providerRetry: b.providerRetry });
  }
  if (b.tokenBudget && typeof b.tokenBudget === 'object') {
    s.tokenBudget = normalizeTokenBudget({ ...s.tokenBudget, ...b.tokenBudget });
  }
  return s;
}

export function settingsMeta() {
  return {
    models: Object.keys(MODELS),
    efforts: EFFORTS,
    approvalPolicies: ['risky', 'always', 'never'],
    providerRetry: normalizeProviderRetry({}),
    tokenBudget: normalizeTokenBudget({})
  };
}
