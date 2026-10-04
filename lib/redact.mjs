import { redactPluginAuth } from './mcp-oauth.mjs';
import { redactSettingsSecrets, redactPlugin as redactConnectorPlugin } from './mcp-connectors.mjs';
import { redactVaultMap } from './credential-vault.mjs';
import { lgpdShouldRedactInLogs, normalizeLgpdSettings, redactBrazilianPii } from './lgpd-pii.mjs';
import { redactSocialWebhooks } from './social-webhooks.mjs';

export const LOG_REDACTED = '[REDACTED]';

const SENSITIVE_NAME = /(authorization|api[-_]?key|x-api-key|token|secret|password|passwd|cookie|credential)/i;
const BEARER = /Bearer\s+[A-Za-z0-9._\-+/=]+/gi;
const SK_ANT = /sk-ant-[A-Za-z0-9_-]+/gi;
const OPENAI_SK = /\bsk-[A-Za-z0-9]{20,}\b/gi;
const GITHUB_PAT = /\b(ghp_|github_pat_)[A-Za-z0-9_]+\b/gi;
const AWS_ACCESS_KEY = /\bAKIA[0-9A-Z]{16}\b/g;
const BOAT_KEY = /boat_[A-Za-z0-9]+/gi;
const LONG_SECRET = /\b[A-Za-z0-9+/=_-]{32,}\b/g;

const ERROR_LIKE_KEYS = /^(error|message|warn|detail|stack|lastError|userMessage|debug)$/i;

/** Valor de header/campo sensível → máscara (preserva vazio). */
export function redactSecretValue(value) {
  if (value == null || value === '') return value;
  return '••••';
}

export function isSensitiveName(name) {
  return SENSITIVE_NAME.test(String(name || ''));
}

function applySecretPatterns(text, { forLog }) {
  if (text == null || text === '') return text;
  let s = String(text);
  const longMask = forLog ? LOG_REDACTED : '••••';
  if (forLog) {
    s = s.replace(BEARER, `Bearer ${LOG_REDACTED}`);
    s = s.replace(SK_ANT, LOG_REDACTED);
    s = s.replace(OPENAI_SK, LOG_REDACTED);
    s = s.replace(GITHUB_PAT, LOG_REDACTED);
    s = s.replace(AWS_ACCESS_KEY, LOG_REDACTED);
    s = s.replace(BOAT_KEY, LOG_REDACTED);
  } else {
    s = s.replace(BEARER, 'Bearer ••••');
    s = s.replace(SK_ANT, 'sk-ant-••••');
    s = s.replace(OPENAI_SK, 'sk-••••');
    s = s.replace(GITHUB_PAT, 'ghp_••••');
    s = s.replace(AWS_ACCESS_KEY, 'AKIA••••');
    s = s.replace(BOAT_KEY, 'boat_••••');
  }
  // Só letras e "_" (ex.: mcp__claude_ai_Google_Calendar__list_events) é nome de ferramenta, não segredo:
  // tokens e chaves sempre misturam dígitos. Antes a linha de ações mostrava "Usando ••••".
  s = s.replace(LONG_SECRET, m => (m.length >= 40 && !/^[A-Za-z_]+$/.test(m) ? longMask : m));
  return s;
}

export function redactHeaders(headers) {
  if (!headers || typeof headers !== 'object') return headers;
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = isSensitiveName(name) ? redactSecretValue(value) : value;
  }
  return out;
}

export function redactPlugin(plugin) {
  if (!plugin || typeof plugin !== 'object') return plugin;
  const out = { ...plugin };
  if (out.auth) {
    out.auth = redactPluginAuth(out.auth);
    if (Array.isArray(out.auth.headers)) {
      out.auth = {
        ...out.auth,
        headers: out.auth.headers.map(h => ({
          ...h,
          value: isSensitiveName(h.name) ? redactSecretValue(h.value) : h.value
        }))
      };
    }
  }
  if (out.headers) out.headers = redactHeaders(out.headers);
  return out;
}

/** Rotina exposta na API: segredo do webhook nunca sai. */
export function redactRoutine(r) {
  if (!r || typeof r !== 'object') return r;
  const { hookSecret, ...rest } = r;
  return { ...rest, hasSecret: !!hookSecret };
}

function applyLgpdPiiIfEnabled(text, settings) {
  if (!settings || !lgpdShouldRedactInLogs(settings)) return text;
  return redactBrazilianPii(text, normalizeLgpdSettings(settings.lgpd)).text;
}

/** Remove padrões comuns de segredo de strings (SSE, erros JSON, respostas). */
export function redactSecretsInText(text, settings) {
  return applyLgpdPiiIfEnabled(applySecretPatterns(text, { forLog: false }), settings);
}

/** Mesmos padrões, placeholder explícito para logs do servidor. */
export function redactSecretsInLogText(text, settings) {
  return applyLgpdPiiIfEnabled(applySecretPatterns(text, { forLog: true }), settings);
}

function settingsFromLogContext(first) {
  return first && typeof first === 'object' && !Array.isArray(first)
    && ('lgpd' in first || 'claude' in first || 'name' in first) ? first : undefined;
}

export function redactForLog(first, ...parts) {
  const settings = settingsFromLogContext(first);
  const rest = settings ? parts : [first, ...parts];
  return rest.map(p => {
    if (typeof p === 'string') return redactSecretsInLogText(p, settings);
    if (p instanceof Error) {
      const copy = new Error(redactSecretsInLogText(p.message, settings));
      if (p.stack) copy.stack = redactSecretsInLogText(p.stack, settings);
      return copy;
    }
    return p;
  });
}

/** Percorre objeto/array e sanitiza strings (SSE, payloads de erro). */
export function redactStringsDeep(value, depth = 0, maxDepth = 5, settings) {
  if (value == null || depth > maxDepth) return value;
  if (typeof value === 'string') return redactSecretsInText(value, settings);
  if (Array.isArray(value)) return value.map(v => redactStringsDeep(v, depth + 1, maxDepth, settings));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = typeof v === 'string' ? redactSecretsInText(v, settings) : redactStringsDeep(v, depth + 1, maxDepth, settings);
  }
  return out;
}

/** Sanitiza um evento SSE antes de serializar (inclui tool/detail/debug). */
export function redactSseEvent(event, settings) {
  if (!event || typeof event !== 'object') return event;
  return redactStringsDeep(event, 0, 6, settings);
}

/** Resposta JSON genérica: redact settings aninhados e campos de erro. */
export function redactJsonPayload(data, depth = 0) {
  if (data == null) return data;
  if (typeof data === 'string') return redactSecretsInText(data);
  if (typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(item => redactJsonPayload(item, depth + 1));
  const out = { ...data };
  if (out.settings) out.settings = redactSettingsSecrets(out.settings);
  if (out.connector) out.connector = redactConnectorPlugin(out.connector);
  if (out.credentialVault) out.credentialVault = redactVaultMap(out.credentialVault);
  if (out.vault) out.vault = redactVaultMap(out.vault);
  if (out.sealed && typeof out.sealed === 'object') out.sealed = '[sealed]';
  if (out.auth) out.auth = redactPluginAuth(out.auth);
  if (out.headers) out.headers = redactHeaders(out.headers);
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (typeof v === 'string' && ERROR_LIKE_KEYS.test(k)) {
      out[k] = redactSecretsInText(v);
    } else if (v && typeof v === 'object' && depth < 6) {
      out[k] = redactJsonPayload(v, depth + 1);
    }
  }
  return out;
}
