import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'ripper-secret-'));
process.env.RIPPER_SECRET_KEY_FILE = join(dir, 'secret.key');
process.env.RIPPER_DATA = join(dir, 'data');
const { encryptSecret, decryptSecret } = await import('../lib/local-secret.mjs');
const store = await import('../lib/store.mjs');

test('cifra e decifra; texto de outra chave volta vazio', () => {
  const enc = encryptSecret('sk-ant-123');
  assert.match(enc, /^enc:v1:/);
  assert.equal(decryptSecret(enc), 'sk-ant-123');
  assert.equal(encryptSecret(enc), enc, 'não cifra duas vezes');
  assert.equal(decryptSecret('enc:v1:lixo'), '');
  assert.equal(decryptSecret('texto antigo'), 'texto antigo', 'valor antigo em texto puro continua lido');
});

test('db.json no disco não tem a chave em texto puro; em memória tem', () => {
  const db = store.load();
  db.settings.claude.apiKey = 'sk-ant-segredo-999';
  store.flush();
  const disk = readFileSync(join(dir, 'data', 'db.json'), 'utf8');
  assert.ok(!disk.includes('sk-ant-segredo-999'));
  assert.equal(db.settings.claude.apiKey, 'sk-ant-segredo-999');
});
