import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import {
  assertVaultStoreBody,
  isVaultRef,
  sealCredentialWithDek,
  unwrapSealedCredential,
  resolveCredentialValue,
  validateSealedBlob,
  generateVaultRef
} from '../lib/credential-vault.mjs';

const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

test('seal e unwrap roundtrip', () => {
  const dek = Buffer.alloc(32, 7);
  const sealed = sealCredentialWithDek('minha-senha-bancária', dek, { label: 'Banco', purpose: 'test' });
  validateSealedBlob(sealed);
  const plain = unwrapSealedCredential(sealed, dek);
  assert.equal(plain, 'minha-senha-bancária');
});

test('isVaultRef e generateVaultRef', () => {
  const ref = generateVaultRef();
  assert.match(ref, /^vlt_/);
  assert.equal(isVaultRef(ref), true);
  assert.equal(isVaultRef('sk-ant-x'), false);
});

test('assertVaultStoreBody rejeita plaintext', () => {
  assert.throws(() => assertVaultStoreBody({ plaintext: 'x' }), /plaintext/);
  assert.throws(() => assertVaultStoreBody({}), /sealed/);
});

test('resolveCredentialValue com DEK de sessão', async () => {
  const dek = Buffer.alloc(32, 3);
  const sealed = sealCredentialWithDek('token-abc', dek);
  const ref = generateVaultRef();
  const out = await resolveCredentialValue(ref, { dek, entries: { [ref]: { sealed } } });
  assert.equal(out, 'token-abc');
});

test('API /api/vault/entries aceita só blob selado', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-vault-'));
  const port = await freePort();
  const dek = Buffer.alloc(32, 9);
  const sealed = sealCredentialWithDek('hush', dek);
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TOKEN: 'vault-token' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: 'Bearer vault-token', 'content-type': 'application/json' };
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(base + '/api/health', { headers: auth })).ok) break;
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    const bad = await fetch(base + '/api/vault/entries', {
      method: 'POST', headers: auth, body: JSON.stringify({ plaintext: 'nope' })
    });
    assert.equal(bad.status, 400);
    const ok = await fetch(base + '/api/vault/entries', {
      method: 'POST', headers: auth, body: JSON.stringify({ sealed, label: 'Teste' })
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.match(body.ref, /^vlt_/);
    const list = await fetch(base + '/api/vault/entries', { headers: auth });
    const entries = (await list.json()).entries;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].hasSealed, true);
    assert.equal(entries[0].sealed, undefined);
  } finally {
    child.kill('SIGTERM');
  }
});
