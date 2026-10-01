import { accessSync, constants, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{ level: 'warn' | 'error', code: string, message: string }} BootLintFinding */

const POSITIVE_INT_ENV = [
  { key: 'RIPPER_SHUTDOWN_MS', min: 1 },
  { key: 'RIPPER_MAX_BODY_BYTES', min: 1 }
];

const NON_NEGATIVE_INT_ENV = [
  { key: 'RIPPER_LIMIT_5H_CHARS', min: 0 },
  { key: 'RIPPER_LIMIT_WEEK_CHARS', min: 0 }
];

const NON_NEGATIVE_NUM_ENV = [
  { key: 'RIPPER_CLOUD_CREDITS_USD', min: 0 },
  { key: 'RIPPER_CLOUD_CREDITS_USED', min: 0 }
];

export function isBootLintStrict(env = process.env) {
  return env.NODE_ENV === 'production' || env.RIPPER_STRICT === '1';
}

/**
 * @param {string} raw
 * @param {{ min?: number, max?: number, integer?: boolean }} rule
 */
export function validateNumericEnv(raw, rule = {}) {
  const { min = 0, max = Number.POSITIVE_INFINITY, integer = true } = rule;
  const trimmed = String(raw).trim();
  if (!trimmed) return { ok: false, reason: 'vazio' };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { ok: false, reason: 'NaN' };
  if (integer && !Number.isInteger(n)) return { ok: false, reason: 'não é inteiro' };
  if (n < min) return { ok: false, reason: `menor que ${min}` };
  if (n > max) return { ok: false, reason: `maior que ${max}` };
  return { ok: true, value: n };
}

function validatePortEnv(raw) {
  return validateNumericEnv(raw, { min: 1, max: 65535, integer: true });
}

function dataDirPath(env = process.env) {
  if (env.RIPPER_DATA) return resolve(env.RIPPER_DATA);
  return fileURLToPath(new URL('../data/', import.meta.url));
}

/**
 * @param {string} dir
 * @param {{ mkdir?: boolean }} [opts]
 */
export function checkDataDirWritable(dir, opts = {}) {
  try {
    if (opts.mkdir) mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    const probe = resolve(dir, `.ripper-boot-lint-${process.pid}`);
    writeFileSync(probe, 'ok', 'utf8');
    unlinkSync(probe);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e?.message || String(e) };
  }
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {{ host?: string, port?: number, token?: string, dataDir?: string, skipDataDir?: boolean }} [ctx]
 * @returns {BootLintFinding[]}
 */
export function collectBootLintFindings(env = process.env, ctx = {}) {
  const findings = /** @type {BootLintFinding[]} */ ([]);
  const push = (code, message, level = 'error') => findings.push({ level, code, message });

  const strict = isBootLintStrict(env);
  const token = ctx.token ?? env.RIPPER_TOKEN ?? '';
  if (strict && !String(token).trim()) {
    push(
      'RIPPER_TOKEN_MISSING',
      'RIPPER_TOKEN não definido (obrigatório com NODE_ENV=production ou RIPPER_STRICT=1).',
      'error'
    );
  }

  if (env.PORT !== undefined && env.PORT !== '') {
    const portCheck = validatePortEnv(env.PORT);
    if (!portCheck.ok) {
      push('ENV_PORT_INVALID', `PORT inválido (${portCheck.reason}): "${env.PORT}"`);
    }
  }

  const resolvedPort = ctx.port ?? (+env.PORT || 3000);
  if (!Number.isInteger(resolvedPort) || resolvedPort < 1 || resolvedPort > 65535) {
    push('ENV_PORT_INVALID', `Porta de escuta inválida: ${resolvedPort}`);
  }

  for (const { key, min } of POSITIVE_INT_ENV) {
    const raw = env[key];
    if (raw === undefined || raw === '') continue;
    const check = validateNumericEnv(raw, { min, integer: true });
    if (!check.ok) push('ENV_NUMERIC_INVALID', `${key} inválido (${check.reason}): "${raw}"`);
  }

  for (const { key, min } of NON_NEGATIVE_INT_ENV) {
    const raw = env[key];
    if (raw === undefined || raw === '') continue;
    const check = validateNumericEnv(raw, { min, integer: true });
    if (!check.ok) push('ENV_NUMERIC_INVALID', `${key} inválido (${check.reason}): "${raw}"`);
  }

  for (const { key, min } of NON_NEGATIVE_NUM_ENV) {
    const raw = env[key];
    if (raw === undefined || raw === '') continue;
    const check = validateNumericEnv(raw, { min, integer: false });
    if (!check.ok) push('ENV_NUMERIC_INVALID', `${key} inválido (${check.reason}): "${raw}"`);
  }

  for (const key of Object.keys(env)) {
    if (!key.startsWith('RIPPER_CB_')) continue;
    const raw = env[key];
    if (raw === undefined || raw === '') continue;
    const check = validateNumericEnv(raw, { min: 0, integer: true });
    if (!check.ok) push('ENV_NUMERIC_INVALID', `${key} inválido (${check.reason}): "${raw}"`);
  }

  if (!ctx.skipDataDir) {
    const dir = ctx.dataDir ?? dataDirPath(env);
    const writable = checkDataDirWritable(dir, { mkdir: true });
    if (!writable.ok) {
      push(
        'RIPPER_DATA_NOT_WRITABLE',
        `Diretório de dados não gravável (${dir}): ${writable.message}`
      );
    }
  }

  return findings;
}

function logFinding(finding, strict, log = console) {
  const level = strict ? finding.level : finding.level === 'error' ? 'warn' : finding.level;
  const line = JSON.stringify({ level, code: finding.code, message: finding.message });
  if (level === 'error') (log.error ?? console.error)(line);
  else (log.warn ?? console.warn)(line);
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, host?: string, port?: number, token?: string, log?: Console, exit?: (code: number) => void, skipDataDir?: boolean }} [opts]
 */
export function runBootLint(opts = {}) {
  const env = opts.env ?? process.env;
  const strict = isBootLintStrict(env);
  const findings = collectBootLintFindings(env, {
    host: opts.host,
    port: opts.port,
    token: opts.token ?? env.RIPPER_TOKEN,
    skipDataDir: opts.skipDataDir
  });
  const log = opts.log ?? console;
  for (const f of findings) logFinding(f, strict, log);
  const shouldExit = strict && findings.some(f => f.level === 'error');
  if (shouldExit) (opts.exit ?? process.exit)(1);
  return { strict, findings, shouldExit };
}
