import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  collectBootLintFindings,
  isBootLintStrict,
  runBootLint,
  validateNumericEnv,
  checkDataDirWritable
} from '../lib/boot-lint.mjs';

const bootLintPath = fileURLToPath(new URL('../lib/boot-lint.mjs', import.meta.url));

test('validateNumericEnv rejeita NaN e negativos', () => {
  assert.equal(validateNumericEnv('abc').ok, false);
  assert.equal(validateNumericEnv('-1', { min: 0 }).ok, false);
  assert.equal(validateNumericEnv('3.5', { integer: true }).ok, false);
  assert.equal(validateNumericEnv('42', { min: 1, integer: true }).ok, true);
});

test('collectBootLintFindings detecta env numérico inválido', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-bootlint-'));
  const findings = collectBootLintFindings(
    {
      RIPPER_SHUTDOWN_MS: 'nope',
      RIPPER_CB_FAILURE_THRESHOLD: '-3',
      PORT: '70000'
    },
    { dataDir: dir, token: 'secret', skipDataDir: false }
  );
  assert.ok(findings.some(f => f.code === 'ENV_NUMERIC_INVALID' && f.message.includes('RIPPER_SHUTDOWN_MS')));
  assert.ok(findings.some(f => f.code === 'ENV_NUMERIC_INVALID' && f.message.includes('RIPPER_CB_FAILURE_THRESHOLD')));
  assert.ok(findings.some(f => f.code === 'ENV_PORT_INVALID'));
  rmSync(dir, { recursive: true, force: true });
});

test('isBootLintStrict com production ou RIPPER_STRICT', () => {
  assert.equal(isBootLintStrict({ NODE_ENV: 'production' }), true);
  assert.equal(isBootLintStrict({ RIPPER_STRICT: '1' }), true);
  assert.equal(isBootLintStrict({ NODE_ENV: 'development' }), false);
});

test('runBootLint em modo estrito falha sem token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-bootlint-strict-'));
  let exitCode = null;
  const findings = runBootLint({
    env: { RIPPER_STRICT: '1', RIPPER_DATA: dir },
    token: '',
    exit: code => {
      exitCode = code;
    }
  });
  assert.equal(exitCode, 1);
  assert.ok(findings.findings.some(f => f.code === 'RIPPER_TOKEN_MISSING'));
  rmSync(dir, { recursive: true, force: true });
});

test('runBootLint em dev continua com env inválido (só warn)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-bootlint-dev-'));
  const logs = [];
  const log = {
    warn: line => logs.push(['warn', line]),
    error: line => logs.push(['error', line])
  };
  let exitCode = null;
  runBootLint({
    env: { NODE_ENV: 'development', RIPPER_SHUTDOWN_MS: 'bad', RIPPER_DATA: dir },
    token: '',
    log,
    exit: code => {
      exitCode = code;
    }
  });
  assert.equal(exitCode, null);
  assert.ok(logs.some(([level, line]) => level === 'warn' && line.includes('ENV_NUMERIC_INVALID')));
  assert.equal(logs.some(([level]) => level === 'error'), false);
  rmSync(dir, { recursive: true, force: true });
});

test('checkDataDirWritable falha em diretório inexistente sem mkdir', () => {
  const missing = join(tmpdir(), `ripper-missing-${Date.now()}`);
  assert.equal(checkDataDirWritable(missing, { mkdir: false }).ok, false);
});

test('processo boot-lint estrito com PORT inválido sai com código 1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-bootlint-proc-'));
  const child = spawn(
    process.execPath,
    ['-e', `import { runBootLint } from ${JSON.stringify(bootLintPath)}; runBootLint({ env: process.env, token: 'x' });`],
    {
      env: {
        ...process.env,
        RIPPER_STRICT: '1',
        RIPPER_DATA: dir,
        PORT: 'not-a-port'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  const code = await new Promise(resolve => child.on('exit', resolve));
  assert.equal(code, 1);
  rmSync(dir, { recursive: true, force: true });
});
