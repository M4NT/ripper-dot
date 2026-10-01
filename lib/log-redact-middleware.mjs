import { redactSecretsInLogText } from './redact.mjs';

let installed = false;

function redactLogArg(value) {
  if (value == null) return value;
  if (typeof value === 'string') return redactSecretsInLogText(value);
  if (value instanceof Error) {
    const copy = new Error(redactSecretsInLogText(value.message));
    if (value.stack) copy.stack = redactSecretsInLogText(value.stack);
    copy.name = value.name;
    return copy;
  }
  if (typeof value === 'object') {
    try {
      return JSON.parse(redactSecretsInLogText(JSON.stringify(value)));
    } catch {
      return value;
    }
  }
  return value;
}

/** Intercepta console.* e censura segredos antes de escrever no stderr/stdout do servidor. */
export function installLogRedactionMiddleware() {
  if (installed) return;
  installed = true;
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level].bind(console);
    console[level] = (...args) => original(...args.map(redactLogArg));
  }
}

export function isLogRedactionInstalled() {
  return installed;
}
