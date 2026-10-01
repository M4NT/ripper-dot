/**
 * Cofre global de credenciais de conexão (criptografado em repouso).
 * Compartilha OAuth/chaves entre agentes sem duplicar segredos em db.json.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyOAuthTokensToPlugin, mergePluginAuth } from './mcp-oauth.mjs';
import { withPersistMutex, _resetPersistCoordForTests } from './persist-coord.mjs';

const SENSITIVE_HEADER = /(authorization|api[-_]?key|x-api-key|token|secret|password|passwd|cookie|credential)/i;

export const VAULT_FORMAT = 1;
const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const KEY_RE = /^[\w.-]{1,64}$/;

let _dir;
function dataDir() {
  if (!_dir) {
    _dir = process.env.RIPPER_DATA
      ? pathToFileURL(resolve(process.env.RIPPER_DATA) + '/')
      : new URL('../data/', import.meta.url);
  }
  return _dir;
}

function vaultFileUrl() {
  return new URL('connection-vault.json', dataDir());
}

/** Chave AES-256: RIPPER_VAULT_KEY (hex 64 ou passphrase) ou derivação de RIPPER_TOKEN. */
export function vaultKeyMaterial() {
  const explicit = process.env.RIPPER_VAULT_KEY?.trim();
  if (explicit) {
    if (/^[0-9a-fA-F]{64}$/.test(explicit)) return Buffer.from(explicit, 'hex');
    return createHash('sha256').update(explicit, 'utf8').digest();
  }
  const token = process.env.RIPPER_TOKEN?.trim();
  if (token) return scryptSync(token, 'ripper-connection-vault-v1', KEY_LEN);
  return null;
}

export function vaultConfigured() {
  return vaultKeyMaterial() != null;
}

function requireKey() {
  const key = vaultKeyMaterial();
  if (!key) {
    throw new Error(
      'Cofre indisponível: defina RIPPER_VAULT_KEY ou RIPPER_TOKEN para criptografar credenciais.'
    );
  }
  return key;
}

function sealObject(obj, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const plain = Buffer.from(JSON.stringify(obj), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return {
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: enc.toString('base64url')
  };
}

function openObject(sealed, key) {
  const iv = Buffer.from(sealed.iv, 'base64url');
  const tag = Buffer.from(sealed.tag, 'base64url');
  const data = Buffer.from(sealed.data, 'base64url');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

function normalizeScope(scope) {
  const agents = Array.isArray(scope?.agents) ? scope.agents.map(String).slice(0, 200) : ['*'];
  if (!agents.length) agents.push('*');
  return { agents };
}

export function agentAllowedByScope(scope, agentId) {
  if (!agentId) return false;
  const agents = scope?.agents || ['*'];
  if (agents.includes('*')) return true;
  return agents.includes(String(agentId));
}

function readVaultFile() {
  const f = vaultFileUrl();
  if (!existsSync(f)) return { format: VAULT_FORMAT, entries: {} };
  const parsed = JSON.parse(readFileSync(f, 'utf8'));
  if (!parsed || typeof parsed !== 'object') throw new Error('Arquivo do cofre inválido.');
  if (parsed.format !== VAULT_FORMAT) throw new Error('Formato do cofre não reconhecido.');
  parsed.entries = parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {};
  return parsed;
}

function writeVaultFile(snapshot) {
  mkdirSync(dataDir(), { recursive: true });
  const tmp = new URL('connection-vault.json.tmp', dataDir());
  writeFileSync(tmp, JSON.stringify(snapshot));
  renameSync(tmp, vaultFileUrl());
}

let cache;
export function _resetVaultForTests() {
  cache = undefined;
  _dir = undefined;
  _resetPersistCoordForTests();
}

export function loadVaultStore() {
  if (cache) return cache;
  withPersistMutex(() => {
    cache = readVaultFile();
  });
  return cache;
}

function persistVaultStore(store) {
  cache = store;
  withPersistMutex(() => {
    writeVaultFile(store);
  });
}

function entryMeta(key, row) {
  return {
    key,
    label: row.label || key,
    connector: row.connector || undefined,
    scope: row.scope || { agents: ['*'] },
    updatedAt: row.updatedAt || 0,
    hasCredential: !!row.sealed
  };
}

export function listVaultEntries() {
  if (!vaultConfigured()) return { configured: false, entries: [] };
  const store = loadVaultStore();
  return {
    configured: true,
    entries: Object.entries(store.entries).map(([k, v]) => entryMeta(k, v))
  };
}

function decryptEntry(row) {
  if (!row?.sealed) return null;
  return openObject(row.sealed, requireKey());
}

export function getVaultCredential(key, { agentId, internal = false } = {}) {
  if (!KEY_RE.test(key)) throw new Error('Chave do cofre inválida.');
  if (!vaultConfigured()) throw new Error('Cofre não configurado.');
  const store = loadVaultStore();
  const row = store.entries[key];
  if (!row) return null;
  if (!internal && !agentAllowedByScope(row.scope, agentId)) {
    throw new Error('Agente sem permissão para esta credencial.');
  }
  return decryptEntry(row);
}

export function putVaultCredential(key, body) {
  if (!KEY_RE.test(key)) throw new Error('Chave do cofre inválida (use letras, números, ., -, _; até 64).');
  const credential = body?.credential;
  if (!credential || typeof credential !== 'object') throw new Error('Informe credential (auth e/ou headers).');
  const store = loadVaultStore();
  const prev = store.entries[key];
  const prevPayload = prev ? decryptEntry(prev) : null;
  const payload = {
    auth: credential.auth ? mergePluginAuth(prevPayload?.auth, credential.auth) : prevPayload?.auth,
    headers: credential.headers && typeof credential.headers === 'object'
      ? { ...(prevPayload?.headers || {}), ...credential.headers }
      : prevPayload?.headers
  };
  const sealed = sealObject(payload, requireKey());
  store.entries[key] = {
    key,
    label: String(body.label || prev?.label || key).slice(0, 120),
    connector: body.connector != null ? String(body.connector).slice(0, 40) : prev?.connector,
    scope: normalizeScope(body.scope || prev?.scope),
    updatedAt: Date.now(),
    sealed
  };
  persistVaultStore(store);
  return entryMeta(key, store.entries[key]);
}

export function deleteVaultCredential(key) {
  if (!KEY_RE.test(key)) throw new Error('Chave do cofre inválida.');
  const store = loadVaultStore();
  if (!store.entries[key]) return false;
  delete store.entries[key];
  persistVaultStore(store);
  return true;
}

export function pluginHasInlineSecrets(plugin) {
  const auth = plugin?.auth;
  if (auth?.apiKey || auth?.clientSecret) return true;
  if (auth?.oauth?.accessToken || auth?.oauth?.refreshToken) return true;
  if (plugin?.headers && Object.entries(plugin.headers).some(([k, v]) => v && SENSITIVE_HEADER.test(k))) return true;
  return false;
}

export function extractCredentialFromPlugin(plugin) {
  const auth = plugin.auth ? structuredClone(plugin.auth) : undefined;
  const headers = {};
  if (plugin.headers) {
    for (const [k, v] of Object.entries(plugin.headers)) {
      if (v && SENSITIVE_HEADER.test(k)) headers[k] = v;
    }
  }
  return {
    auth,
    headers: Object.keys(headers).length ? headers : undefined
  };
}

export function stripInlineSecretsFromPlugin(plugin) {
  const out = { ...plugin };
  if (out.auth) {
    const auth = { ...out.auth };
    delete auth.apiKey;
    delete auth.clientSecret;
    if (auth.oauth) {
      auth.oauth = {
        ...auth.oauth,
        accessToken: '',
        refreshToken: ''
      };
    }
    out.auth = auth;
  }
  if (out.headers) {
    out.headers = Object.fromEntries(
      Object.entries(out.headers).filter(([k]) => !SENSITIVE_HEADER.test(k))
    );
  }
  return out;
}

/**
 * Move segredos inline de conectores globais (e agent.secrets legado) para o cofre.
 */
export function migrateLegacySecretsToVault(db) {
  if (!vaultConfigured()) throw new Error('Cofre não configurado.');
  const migrated = [];
  const plugins = (db.settings.plugins || []).map(p => {
    if (p.auth?.vaultRef || !pluginHasInlineSecrets(p)) return p;
    const key = `connector-${p.name}`.slice(0, 64);
    putVaultCredential(key, {
      label: `Conector ${p.name}`,
      connector: p.name,
      scope: { agents: ['*'] },
      credential: extractCredentialFromPlugin(p)
    });
    migrated.push({ kind: 'connector', plugin: p.name, vaultKey: key });
    const stripped = stripInlineSecretsFromPlugin(p);
    stripped.auth = { ...(stripped.auth || {}), vaultRef: key };
    return stripped;
  });
  db.settings.plugins = plugins;

  for (const agent of db.agents || []) {
    if (!agent.secrets || typeof agent.secrets !== 'object') continue;
    for (const [name, payload] of Object.entries(agent.secrets)) {
      const slug = String(name).replace(/[^\w.-]/g, '-').slice(0, 32);
      const key = `agent-${agent.id.slice(0, 8)}-${slug}`.slice(0, 64);
      putVaultCredential(key, {
        label: `${name} (${agent.name || agent.id})`,
        scope: { agents: [agent.id] },
        credential: payload && typeof payload === 'object' ? payload : { auth: { apiKey: String(payload) } }
      });
      migrated.push({ kind: 'agent', agentId: agent.id, name, vaultKey: key });
    }
    delete agent.secrets;
  }

  return { migrated, count: migrated.length };
}

/** Mescla credencial do cofre no plugin (runtime MCP). */
export function resolvePluginWithVault(plugin, { agentId, internal = false } = {}) {
  if (!plugin?.auth?.vaultRef) return plugin;
  if (!internal && !agentId) return plugin;
  let cred;
  try {
    cred = getVaultCredential(plugin.auth.vaultRef, { agentId });
  } catch {
    return plugin;
  }
  if (!cred) return plugin;
  const auth = cred.auth ? mergePluginAuth(plugin.auth, cred.auth) : plugin.auth;
  const headers = { ...(plugin.headers || {}), ...(cred.headers || {}) };
  return { ...plugin, auth, headers };
}

export function persistOAuthTokensInVault(plugin, tokens, flow) {
  const ref = plugin.auth?.vaultRef;
  if (!ref) return applyOAuthTokensToPlugin(plugin, tokens, flow);
  const prevCred = getVaultCredential(ref, { internal: true }) || {};
  const withTokens = applyOAuthTokensToPlugin({ auth: prevCred.auth || {} }, tokens, flow);
  putVaultCredential(ref, {
    credential: { auth: withTokens.auth, headers: prevCred.headers }
  });
  const publicAuth = { ...(plugin.auth || {}) };
  if (flow?.clientId) publicAuth.clientId = flow.clientId;
  if (flow?.tokenEndpoint) publicAuth.tokenEndpoint = flow.tokenEndpoint;
  if (publicAuth.oauth) {
    publicAuth.oauth = {
      ...publicAuth.oauth,
      accessToken: '',
      refreshToken: '',
      expiresAt: tokens.expiresAt,
      tokenType: tokens.tokenType,
      scope: tokens.scope
    };
  }
  delete publicAuth.clientSecret;
  return { ...plugin, auth: publicAuth };
}
