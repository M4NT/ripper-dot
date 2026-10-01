import { redactPluginAuth } from './mcp-oauth.mjs';
import { redactSettingsSecrets, redactPlugin as redactConnectorPlugin } from './mcp-connectors.mjs';

const SENSITIVE_NAME = /(authorization|api[-_]?key|x-api-key|token|secret|password|passwd|cookie|credential)/i;
const BEARER = /Bearer\s+[A-Za-z0-9._\-+/=]+/gi;
const SK_ANT = /sk-ant-[A-Za-z0-9_-]+/gi;
const BOAT_KEY = /boat_[A-Za-z0-9]+/gi;
const LONG_SECRET = /\b[A-Za-z0-9+/=_-]{32,}\b/g;

/** Valor de header/campo sensível → máscara (preserva vazio). */
export function redactSecretValue(value) {
  if (value == null || value === '') return value;
  return '••••';
}

export function isSensitiveName(name) {
  return SENSITIVE_NAME.test(String(name || ''));
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

/** Configurações expostas na API / state (nunca chaves reais). */
export function redactSettings(s) {
  if (!s || typeof s !== 'object') return s;
  return {
    ...s,
    claude: { ...s.claude, apiKey: s.claude?.apiKey ? '••••' : '' },
    computer: { ...s.computer, boatApiKey: s.computer?.boatApiKey ? '••••' : '' },
    plugins: (s.plugins || []).map(redactPlugin)
  };
}

/** Rotina exposta na API: segredo do webhook nunca sai. */
export function redactRoutine(r) {
  if (!r || typeof r !== 'object') return r;
  const { hookSecret, ...rest } = r;
  return { ...rest, hasSecret: !!hookSecret };
}

/** Remove padrões comuns de segredo de strings (logs, SSE warn, erros). */
export function redactSecretsInText(text) {
  if (text == null || text === '') return text;
  let s = String(text);
  s = s.replace(BEARER, 'Bearer ••••');
  s = s.replace(SK_ANT, 'sk-ant-••••');
  s = s.replace(BOAT_KEY, 'boat_••••');
  // Tokens longos sem espaço (evita mascarar UUIDs curtos em IDs).
  s = s.replace(LONG_SECRET, m => (m.length >= 40 ? '••••' : m));
  return s;
}

export function redactForLog(...parts) {
  return parts.map(p => (typeof p === 'string' ? redactSecretsInText(p) : p));
}

/** Sanitiza um evento SSE antes de serializar (profundidade limitada). */
export function redactSseEvent(event) {
  if (!event || typeof event !== 'object') return event;
  const out = { ...event };
  if (typeof out.warn === 'string') out.warn = redactSecretsInText(out.warn);
  if (typeof out.error === 'string') out.error = redactSecretsInText(out.error);
  if (out.quota && typeof out.quota.userMessage === 'string') {
    out.quota = { ...out.quota, userMessage: redactSecretsInText(out.quota.userMessage) };
  }
  return out;
}

/** Resposta JSON genérica: redact settings aninhados se existirem. */
export function redactJsonPayload(data) {
  if (data == null || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(redactJsonPayload);
  const out = { ...data };
  if (out.settings) out.settings = redactSettingsSecrets(out.settings);
  if (out.connector) out.connector = redactConnectorPlugin(out.connector);
  if (out.auth) out.auth = redactPluginAuth(out.auth);
  if (out.headers) out.headers = redactHeaders(out.headers);
  for (const k of Object.keys(out)) {
    if (typeof out[k] === 'string' && (k === 'error' || k === 'message' || k === 'warn')) {
      out[k] = redactSecretsInText(out[k]);
    }
  }
  return out;
}
