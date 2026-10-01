import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('middleware de log censura segredos no console.error do processo', () => {
  const script = `
    import { installLogRedactionMiddleware } from './lib/log-redact-middleware.mjs';
    installLogRedactionMiddleware();
    const leak = 'Bearer ripper_leak_abcdefghijklmnopqrstuvwxyz0123456789';
    console.error('falha auth', leak);
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    encoding: 'utf8'
  });
  const out = (r.stderr || '') + (r.stdout || '');
  assert.match(out, /\[REDACTED\]/);
  assert.doesNotMatch(out, /ripper_leak_abcdefghijklmnopqrstuvwxyz0123456789/);
});
