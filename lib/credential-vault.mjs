/**
 * Cofre de credenciais: o servidor guarda apenas blobs selados (AES-256-GCM).
 * O plaintext só existe no navegador ou em memória no servidor no momento do uso MCP.
 */

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { isSensitiveName } from './redact.mjs';

export const VAULT_REF_PREFIX = 'vlt_';
const VAULT_REF_RE = /^vlt_[A-Za-z0-9_-]{16,64}$/;

export function isVaultRef(value) {
  return typeof value === 'string' && VAULT_REF_RE.test(value);
}

export function generateVaultRef() {
  return VAULT_REF_PREFIX + randomUUID().replace(/-/g, '');
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function b64urlDecode(s) {
  return Buffer.from(String(s), 'base64url');
}

/** @param {object} sealed */
export function validateSealedBlob(sealed) {
  if (!sealed || typeof sealed !== 'object' || Array.isArray(sealed)) {
    throw new Error('Blob selado inválido.');
  }
  if (sealed.v !== 1 || sealed.alg !== 'A256GCM') {
    throw new Error('Versão ou algoritmo do cofre não suportado.');
  }
  if (typeof sealed.iv !== 'string' || typeof sealed.ct !== 'string') {
    throw new Error('Blob selado incompleto (iv/ct).');
  }
  if ('plaintext' in sealed || 'password' in sealed || 'secret' in sealed) {
    throw new Error('Não envie plaintext no blob selado.');
  }
  const iv = b64urlDecode(sealed.iv);
  const ct = b64urlDecode(sealed.ct);
  if (iv.length !== 12) throw new Error('IV inválido.');
  if (ct.length < 17) throw new Error('Ciphertext inválido.');
  const label = sealed.label != null ? String(sealed.label).slice(0, 120) : undefined;
  const purpose = sealed.purpose != null ? String(sealed.purpose).slice(0, 80) : undefined;
  return { iv, ct, label, purpose };
}

export function sealCredentialWithDek(plaintext, dekBytes, meta = {}) {
  const dek = Buffer.from(dekBytes);
  if (dek.length !== 32) throw new Error('DEK deve ter 32 bytes.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ct = Buffer.concat([enc, tag]);
  return {
    v: 1,
    alg: 'A256GCM',
    iv: b64url(iv),
    ct: b64url(ct),
    ...(meta.label ? { label: String(meta.label).slice(0, 120) } : {}),
    ...(meta.purpose ? { purpose: String(meta.purpose).slice(0, 80) } : {})
  };
}

export function unwrapSealedCredential(sealed, dekInput) {
  const { iv, ct } = validateSealedBlob(sealed);
  const dek = Buffer.isBuffer(dekInput) ? dekInput : b64urlDecode(dekInput);
  if (dek.length !== 32) throw new Error('DEK inválida.');
  const tag = ct.subarray(ct.length - 16);
  const data = ct.subarray(0, ct.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', dek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function vaultContextFromSession(mcpSession, db) {
  const dekB64 = mcpSession?.vaultDek;
  if (!dekB64 || typeof dekB64 !== 'string') return { dek: null, entries: db.credentialVault || {} };
  try {
    const dek = b64urlDecode(dekB64);
    if (dek.length !== 32) return { dek: null, entries: db.credentialVault || {} };
    return { dek, entries: db.credentialVault || {} };
  } catch {
    return { dek: null, entries: db.credentialVault || {} };
  }
}

export async function resolveCredentialValue(value, vaultCtx) {
  if (value == null || value === '') return value;
  const s = String(value);
  if (!isVaultRef(s)) return s;
  if (!vaultCtx?.dek) {
    throw Object.assign(new Error('Credencial no cofre indisponível nesta sessão.'), { code: 'vault_dek_missing' });
  }
  const entry = vaultCtx.entries?.[s];
  if (!entry?.sealed) {
    throw Object.assign(new Error('Referência de cofre desconhecida.'), { code: 'vault_ref_missing' });
  }
  return unwrapSealedCredential(entry.sealed, vaultCtx.dek);
}

export async function resolvePluginVaultSecrets(plugin, vaultCtx) {
  if (!plugin || !vaultCtx?.dek) return plugin;
  const p = structuredClone(plugin);
  if (p.headers && typeof p.headers === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(p.headers)) {
      out[k] = await resolveCredentialValue(v, vaultCtx);
    }
    p.headers = out;
  }
  if (p.auth?.apiKey) {
    p.auth = { ...p.auth, apiKey: await resolveCredentialValue(p.auth.apiKey, vaultCtx) };
  }
  if (p.auth?.clientSecret) {
    p.auth = { ...p.auth, clientSecret: await resolveCredentialValue(p.auth.clientSecret, vaultCtx) };
  }
  return p;
}

export async function resolvePluginsVaultSecrets(plugins, vaultCtx) {
  if (!Array.isArray(plugins) || !vaultCtx?.dek) return plugins;
  return Promise.all(plugins.map(p => resolvePluginVaultSecrets(p, vaultCtx)));
}

/** Rejeita corpos de API do cofre que tentam enviar segredo em claro. */
export function assertVaultStoreBody(body) {
  if (!body || typeof body !== 'object') throw new Error('Corpo inválido.');
  for (const k of ['plaintext', 'password', 'secret', 'value', 'apiKey', 'token']) {
    if (body[k] != null && String(body[k]).length > 0) {
      throw new Error('Use apenas blob selado; plaintext não é aceito nesta API.');
    }
  }
  if (!body.sealed) throw new Error('Campo sealed é obrigatório.');
}

export function sanitizeHeaderValueForStorage(name, value) {
  const v = String(value ?? '').slice(0, 500);
  if (!v) return v;
  if (isVaultRef(v)) return v;
  if (isSensitiveName(name) && v.length > 0 && !isVaultRef(v)) {
    // Legado: ainda aceita texto, mas novos fluxos devem usar vlt_…
    return v;
  }
  return v;
}

export function redactVaultEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  return {
    label: entry.label,
    purpose: entry.purpose,
    createdAt: entry.createdAt,
    hasSealed: !!entry.sealed
  };
}

export function redactVaultMap(map) {
  if (!map || typeof map !== 'object') return map;
  return Object.fromEntries(Object.entries(map).map(([ref, e]) => [ref, redactVaultEntry(e)]));
}
