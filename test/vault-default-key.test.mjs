import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('cofre funciona sem configuração: usa a chave local do Ripper', async () => {
  const prev = { ...process.env };
  delete process.env.RIPPER_VAULT_KEY; delete process.env.RIPPER_TOKEN;
  process.env.RIPPER_SECRET_KEY_FILE = join(mkdtempSync(join(tmpdir(), 'ripper-vk-')), 'secret.key');
  try {
    const v = await import('../lib/connection-vault.mjs?default-key');
    assert.equal(v.vaultConfigured(), true);
    assert.equal(v.vaultKeyMaterial().length, 32);
  } finally { process.env = prev; }
});
