// Segredos das configurações (chaves de API, tokens) cifrados no db.json — e, portanto, nos backups
// e na cópia extra (OneDrive/Drive). A chave fica FORA da pasta de dados: ~/.ripper/secret.key
// (ou RIPPER_SECRET_KEY_FILE). Em memória o Ripper continua vendo o texto normal.
// Backup restaurado em outra máquina sem a chave: os campos voltam vazios e o usuário redigita.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const PREFIX = 'enc:v1:';
// Caminhos dentro de settings que guardam segredo (mesma lista que a API mascara).
export const SECRET_PATHS = [
  ['claude', 'apiKey'], ['openrouter', 'apiKey'], ['computer', 'boatApiKey'],
  ['whatsapp', 'accessToken'], ['whatsapp', 'appSecret'], ['taskSync', 'google', 'clientSecret'], ['email', 'pass'], ['github', 'token'], ['openai', 'apiKey'], ['gemini', 'apiKey'], ['push', 'vapidPrivateKey']
];

let key = null;
export function secretKey() {
  if (key) return key;
  const file = process.env.RIPPER_SECRET_KEY_FILE || join(homedir(), '.ripper', 'secret.key');
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  key = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  return key;
}

export function encryptSecret(plain) {
  if (!plain || String(plain).startsWith(PREFIX)) return plain;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', secretKey(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}

/** Texto cifrado com outra chave (outra máquina) volta vazio em vez de derrubar o servidor. */
export function decryptSecret(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  try {
    const buf = Buffer.from(value.slice(PREFIX.length), 'base64url');
    const d = createDecipheriv('aes-256-gcm', secretKey(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  } catch { return ''; }
}

/** Aplica fn em cada segredo de settings, numa cópia (não altera o original). */
export function mapSettingsSecrets(settings, fn) {
  if (!settings) return settings;
  const out = structuredClone(settings);
  for (const path of SECRET_PATHS) {
    const parent = path.slice(0, -1).reduce((o, k) => o?.[k], out);
    const leaf = path.at(-1);
    if (parent && parent[leaf]) parent[leaf] = fn(parent[leaf]);
  }
  return out;
}
