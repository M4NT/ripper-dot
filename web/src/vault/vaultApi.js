import { api } from '../lib.js';
import { sealCredential } from './crypto.js';

/** Selar no cliente e registrar no servidor (somente blob selado). */
export async function storeVaultCredential(plaintext, { label, purpose } = {}) {
  const sealed = await sealCredential(plaintext, { label, purpose });
  return api('/api/vault/entries', { method: 'POST', body: { sealed, label, purpose } });
}
