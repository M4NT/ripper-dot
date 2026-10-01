/** Criptografia do cofre no navegador (AES-256-GCM). O servidor só vê blobs selados. */

const DEK_KEY = 'ripper.vault.dek';

function b64url(bytes) {
  let s = '';
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function getVaultDekB64url() {
  let raw = sessionStorage.getItem(DEK_KEY);
  if (!raw) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    raw = b64url(bytes);
    sessionStorage.setItem(DEK_KEY, raw);
  }
  return raw;
}

export async function sealCredential(plaintext, meta = {}) {
  const dek = b64urlDecode(getVaultDekB64url());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', dek, 'AES-GCM', false, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(String(plaintext)));
  return {
    v: 1,
    alg: 'A256GCM',
    iv: b64url(iv),
    ct: b64url(new Uint8Array(ct)),
    ...(meta.label ? { label: String(meta.label).slice(0, 120) } : {}),
    ...(meta.purpose ? { purpose: String(meta.purpose).slice(0, 80) } : {})
  };
}
