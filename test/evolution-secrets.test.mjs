import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'ripper-evo-'));
process.env.RIPPER_DATA = dir;
process.env.RIPPER_SECRET_KEY_FILE = join(dir, 'secret.key');
const { evolutionSecrets } = await import('../lib/evolution.mjs');

test('evolution.json: texto puro migra para cifrado e continua legível', () => {
  const file = join(dir, 'evolution.json');
  const plain = { apiKey: 'k1', dbPassword: 'p1', hookToken: 't1' };
  writeFileSync(file, JSON.stringify(plain));
  assert.deepEqual(evolutionSecrets(), plain);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(Object.values(raw).every(v => v.startsWith('enc:v1:')));
  assert.deepEqual(evolutionSecrets(), plain);
});
