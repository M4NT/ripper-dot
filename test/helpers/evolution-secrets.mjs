// Lê data/evolution.json de um servidor de teste (HOME=dataDir) e decifra com a chave dele.
import { createDecipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readEvolutionSecrets(dataDir) {
  const key = Buffer.from(readFileSync(join(dataDir, '.ripper', 'secret.key'), 'utf8').trim(), 'base64');
  const raw = JSON.parse(readFileSync(join(dataDir, 'evolution.json'), 'utf8'));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => {
    const buf = Buffer.from(v.slice('enc:v1:'.length), 'base64url');
    const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return [k, Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')];
  }));
}
