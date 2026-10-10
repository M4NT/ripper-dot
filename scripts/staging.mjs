#!/usr/bin/env node
/**
 * Staging reproduzível do Ripper.
 *
 *   node scripts/staging.mjs up        # Docker Compose se houver; senão Node local
 *   node scripts/staging.mjs up --local
 *   node scripts/staging.mjs down
 *   node scripts/staging.mjs restart
 *   node scripts/staging.mjs status
 *   node scripts/staging.mjs smoke
 *   RIPPER_ENV=staging node scripts/staging.mjs seed [--force]
 *   RIPPER_ENV=staging node scripts/staging.mjs reset
 *   node scripts/staging.mjs serve     # primeiro plano (CMD do Docker)
 *
 * Só lê RIPPER_STAGING_* (nunca RIPPER_DATA / RIPPER_TOKEN / HOST / PORT de produção).
 * reset e seed --force exigem RIPPER_ENV=staging e pasta sob data/staging ou marcador .ripper-staging.
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../lib/auth.mjs';

const SELF = fileURLToPath(import.meta.url);
export const ROOT = resolve(dirname(SELF), '..');
export const COMPOSE_DIR = join(ROOT, 'deploy', 'staging');
export const COMPOSE_FILE = join(COMPOSE_DIR, 'docker-compose.yml');
export const COMPOSE_ENV_FILE = join(COMPOSE_DIR, '.env');
export const SEED_DIR = join(COMPOSE_DIR, 'seed');
export const SEED_DB = join(SEED_DIR, 'db.json');
export const STAGING_MARKER = '.ripper-staging';
export const DEFAULT_STAGING_DATA = join(ROOT, 'data', 'staging');

export const DEFAULTS = {
  port: 3010,
  host: '127.0.0.1',
  provider: 'stream',
  password: 'staging-ok-8',
  listenInContainer: 3000
};

export const STAGING_ENV_KEYS = [
  'RIPPER_STAGING_DATA',
  'RIPPER_STAGING_TOKEN',
  'RIPPER_STAGING_HOST',
  'RIPPER_STAGING_PORT',
  'RIPPER_STAGING_LISTEN',
  'RIPPER_STAGING_PASSWORD',
  'RIPPER_STAGING_URL',
  'RIPPER_STAGING_PROVIDER',
  'RIPPER_ENV'
];

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set();
  const positional = [];
  for (const a of argv) {
    if (a.startsWith('--')) flags.add(a.slice(2));
    else positional.push(a);
  }
  return {
    cmd: positional[0] || '',
    force: flags.has('force'),
    local: flags.has('local'),
    json: flags.has('json'),
    help: flags.has('help') || positional[0] === 'help' || positional[0] === '-h'
  };
}

export function loadStagingDotEnv(path = COMPOSE_ENV_FILE) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    if (!STAGING_ENV_KEYS.includes(key) && key !== 'RIPPER_STAGING_TOKEN') continue;
    out[key] = t.slice(i + 1).trim();
  }
  return out;
}

/** Só chaves de staging: ignora RIPPER_DATA / RIPPER_TOKEN / HOST / PORT / RIPPER_PASSWORD de produção.
 * RIPPER_ENV não vem do .env — precisa estar no processo (guarda de reset/seed). */
export function stagingInputEnv(processEnv = process.env, fileEnv = loadStagingDotEnv()) {
  const out = {};
  for (const k of STAGING_ENV_KEYS) {
    if (k === 'RIPPER_ENV') continue;
    if (fileEnv[k]) out[k] = fileEnv[k];
    if (processEnv[k] != null && processEnv[k] !== '') out[k] = processEnv[k];
  }
  if (processEnv.RIPPER_ENV) out.RIPPER_ENV = processEnv.RIPPER_ENV;
  if (processEnv.NODE_ENV) out.NODE_ENV = processEnv.NODE_ENV;
  return out;
}

export function resolveConfig(env = {}, opts = {}) {
  const hostPort = Number(env.RIPPER_STAGING_PORT || DEFAULTS.port);
  const listenPort = Number(env.RIPPER_STAGING_LISTEN || env.RIPPER_STAGING_PORT || (opts.docker ? DEFAULTS.listenInContainer : DEFAULTS.port));
  const dataDir = resolve(env.RIPPER_STAGING_DATA || DEFAULT_STAGING_DATA);
  const token = env.RIPPER_STAGING_TOKEN || '';
  const provider = env.RIPPER_STAGING_PROVIDER || DEFAULTS.provider;
  const password = env.RIPPER_STAGING_PASSWORD || DEFAULTS.password;
  const host = env.RIPPER_STAGING_HOST || DEFAULTS.host;
  const url = (env.RIPPER_STAGING_URL || `http://127.0.0.1:${hostPort}`).replace(/\/$/, '');
  return {
    dataDir,
    host,
    port: listenPort,
    hostPort,
    token,
    provider,
    password,
    url,
    pidFile: join(dataDir, 'staging.pid')
  };
}

function pickPathEnv() {
  const out = {};
  for (const k of ['PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'WINDIR', 'PATHEXT', 'COMSPEC']) {
    if (process.env[k]) out[k] = process.env[k];
  }
  return out;
}

/** Env mínimo do processo de staging: sem chaves de produção. */
export function stagingEnv(cfg, extra = {}) {
  return {
    ...pickPathEnv(),
    ...extra,
    HOST: cfg.host,
    PORT: String(cfg.port),
    RIPPER_DATA: cfg.dataDir,
    RIPPER_TOKEN: cfg.token,
    RIPPER_TEST_PROVIDER: cfg.provider,
    RIPPER_ENV: 'staging',
    RIPPER_STAGING_PASSWORD: cfg.password,
    JULIA_AUTOSTART: extra.JULIA_AUTOSTART || '0',
    RIPPER_NO_PREWARM: extra.RIPPER_NO_PREWARM || '1',
    HOME: extra.HOME || cfg.dataDir,
    USERPROFILE: extra.USERPROFILE || cfg.dataDir
  };
}

export function smokeEnv(cfg) {
  return {
    ...pickPathEnv(),
    HOME: process.env.HOME || cfg.dataDir,
    USERPROFILE: process.env.USERPROFILE || cfg.dataDir,
    RIPPER_URL: cfg.url,
    RIPPER_TOKEN: cfg.token,
    RIPPER_PASSWORD: cfg.password,
    SMOKE_TEST_PROVIDER: '1',
    RIPPER_ENV: 'staging'
  };
}

export function markerPath(dataDir) {
  return join(dataDir, STAGING_MARKER);
}

export function writeStagingMarker(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(markerPath(dataDir), 'ripper-staging\n', { mode: 0o644 });
}

export function isAllowedStagingDir(dataDir) {
  const resolved = resolve(dataDir);
  const root = resolve(DEFAULT_STAGING_DATA);
  if (resolved === root || resolved.startsWith(root + sep)) return true;
  try {
    return readFileSync(markerPath(resolved), 'utf8').includes('ripper-staging');
  } catch {
    return false;
  }
}

export function assertDestructiveAllowed(dataDir, env = {}) {
  if (env.RIPPER_ENV !== 'staging') {
    throw new Error('Recusado: reset/seed --force exigem RIPPER_ENV=staging (não usa a pasta de produção).');
  }
  if (!isAllowedStagingDir(dataDir)) {
    throw new Error(`Recusado: ${resolve(dataDir)} não é data/staging e não tem o marcador ${STAGING_MARKER}.`);
  }
}

export function generateStagingToken() {
  return randomBytes(24).toString('base64url');
}

function upsertDotEnv(path, values) {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const lines = existing ? existing.split(/\r?\n/) : [];
  const seen = new Set();
  const next = lines.map(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line;
    const i = t.indexOf('=');
    if (i < 1) return line;
    const key = t.slice(0, i).trim();
    if (values[key] == null) return line;
    seen.add(key);
    return `${key}=${values[key]}`;
  });
  for (const [k, v] of Object.entries(values)) {
    if (!seen.has(k)) next.push(`${k}=${v}`);
  }
  if (!existing) {
    next.unshift('# gerado por scripts/staging.mjs — não commitar');
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next.filter((l, i, a) => l !== '' || i < a.length - 1).join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
}

/** Gera RIPPER_STAGING_TOKEN no primeiro up e grava em deploy/staging/.env. */
export function ensureStagingToken(env = {}, { envFile = COMPOSE_ENV_FILE } = {}) {
  if (env.RIPPER_STAGING_TOKEN) return { token: env.RIPPER_STAGING_TOKEN, generated: false };
  const fromFile = loadStagingDotEnv(envFile).RIPPER_STAGING_TOKEN;
  if (fromFile) return { token: fromFile, generated: false, fromFile: true };
  const token = generateStagingToken();
  upsertDotEnv(envFile, { RIPPER_STAGING_TOKEN: token });
  return { token, generated: true, envFile };
}

/** Copia o db.json de exemplo e grava a senha. force exige RIPPER_ENV=staging + pasta/marcador. */
export async function seedDataDir(dataDir, {
  force = false,
  password = DEFAULTS.password,
  env = {},
  skipGuard = false
} = {}) {
  if (!existsSync(SEED_DB)) throw new Error(`seed não encontrado: ${SEED_DB}`);
  if (force && !skipGuard) assertDestructiveAllowed(dataDir, env);
  mkdirSync(dataDir, { recursive: true });
  const dest = join(dataDir, 'db.json');
  const authPath = join(dataDir, 'auth.json');
  if (existsSync(dest) && !force) {
    if (!existsSync(markerPath(dataDir))) writeStagingMarker(dataDir);
    return { seeded: false, reason: 'exists', dataDir };
  }
  copyFileSync(SEED_DB, dest);
  const hash = await hashPassword(password);
  writeFileSync(authPath, JSON.stringify({ hash, updatedAt: Date.now() }), { mode: 0o600 });
  writeStagingMarker(dataDir);
  try { rmSync(join(dataDir, 'setup-code.txt'), { force: true }); } catch { /* senha já existe */ }
  return { seeded: true, dataDir };
}

export function readSeedDb() {
  return JSON.parse(readFileSync(SEED_DB, 'utf8'));
}

export function hasDockerCompose() {
  try {
    execFileSync('docker', ['compose', 'version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function composeArgs(rest) {
  const extra = existsSync(COMPOSE_ENV_FILE) ? ['--env-file', COMPOSE_ENV_FILE] : [];
  return ['compose', '-f', COMPOSE_FILE, ...extra, ...rest];
}

export function usage() {
  return `Uso: node scripts/staging.mjs <comando>

Comandos:
  up [--local]   Sobe o staging (Docker Compose, ou Node se não houver Docker / com --local)
  down           Para o staging
  restart        Reinicia sem apagar os dados
  status         Saúde em ${DEFAULTS.port} (ou RIPPER_STAGING_PORT / RIPPER_STAGING_URL)
  smoke          Roda npm run smoke contra o staging (provedor de teste)
  seed [--force] Copia os dados de exemplo (--force exige RIPPER_ENV=staging)
  reset          Apaga só a pasta/volume de staging e semeia (exige RIPPER_ENV=staging)
  serve          Semeia se vazio e sobe o servidor em primeiro plano (CMD do Docker)

Variáveis: RIPPER_STAGING_DATA, RIPPER_STAGING_TOKEN, RIPPER_STAGING_PORT, RIPPER_STAGING_HOST.
Não lê RIPPER_DATA / RIPPER_TOKEN / HOST / PORT de produção.
Token: RIPPER_STAGING_TOKEN ou gerado no primeiro up (deploy/staging/.env).
reset/seed --force: RIPPER_ENV=staging e pasta sob data/staging ou marcador ${STAGING_MARKER}.
Guia: docs/instalacao.md (seção Staging).`;
}

export async function waitForHealth(url, token, ms = 60_000) {
  const deadline = Date.now() + ms;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url.replace(/\/$/, '') + '/healthz');
      if (r.ok) {
        const body = await r.json().catch(() => ({}));
        if (body.ok) return body;
      }
      last = `healthz ${r.status}`;
    } catch (e) {
      last = e.message;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`staging não respondeu em ${url} (${last})`);
}

export function writePid(cfg, pid) {
  mkdirSync(cfg.dataDir, { recursive: true });
  writeFileSync(cfg.pidFile, JSON.stringify({ pid, dataDir: cfg.dataDir, createdAt: Date.now() }));
}

export function readPid(cfg) {
  try {
    const raw = readFileSync(cfg.pidFile, 'utf8').trim();
    if (raw.startsWith('{')) {
      const n = Number(JSON.parse(raw).pid);
      return Number.isInteger(n) && n > 0 ? n : null;
    }
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function readProcessInspection(pid) {
  try {
    const command = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
    let environ = '';
    try { environ = readFileSync(`/proc/${pid}/environ`, 'utf8'); } catch { /* sem permissão */ }
    return { command, environ };
  } catch {
    try {
      const raw = execFileSync('ps', ['eww', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return { command: raw, environ: raw };
    } catch {
      return null;
    }
  }
}

export function isStagingServerPid(pid, cfg, inspection = readProcessInspection(pid)) {
  if (!pid || !inspection) return false;
  const cmd = String(inspection.command || '');
  if (!/(^|[\s/])server\.mjs(\s|$)/.test(cmd)) return false;
  const env = String(inspection.environ || '');
  if (env.includes('RIPPER_ENV=staging')) return true;
  if (cfg?.dataDir && env.includes(`RIPPER_DATA=${cfg.dataDir}`)) return true;
  return false;
}

function sleepSync(ms) {
  spawnSync(process.execPath, ['-e', `setTimeout(() => {}, ${Number(ms) || 0})`], { stdio: 'ignore' });
}

export function stopPid(cfg, { inspect = readProcessInspection } = {}) {
  const pid = readPid(cfg);
  if (pidAlive(pid)) {
    const inspection = inspect(pid);
    if (!isStagingServerPid(pid, cfg, inspection)) {
      throw new Error(`PID ${pid} não é o servidor de staging (cmdline/RIPPER_ENV); não vou matar.`);
    }
    try { process.kill(pid, 'SIGTERM'); } catch { /* já saiu */ }
    const t0 = Date.now();
    while (pidAlive(pid) && Date.now() - t0 < 8_000) sleepSync(100);
    if (pidAlive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
  }
  try { rmSync(cfg.pidFile, { force: true }); } catch { /* ignore */ }
}

function portFree(port, host = '127.0.0.1') {
  return new Promise(resolvePort => {
    const s = createServer();
    s.once('error', () => resolvePort(false));
    s.listen(port, host, () => s.close(() => resolvePort(true)));
  });
}

async function upLocal(cfg) {
  await seedDataDir(cfg.dataDir, { password: cfg.password });
  if (pidAlive(readPid(cfg))) {
    const pid = readPid(cfg);
    if (isStagingServerPid(pid, cfg)) {
      console.log(`Staging local já está no ar (pid ${pid}) em ${cfg.url}`);
      return;
    }
    try { rmSync(cfg.pidFile, { force: true }); } catch { /* stale */ }
  }
  if (!(await portFree(cfg.port, cfg.host))) {
    throw new Error(`porta ${cfg.port} em uso. Pare o processo ou mude RIPPER_STAGING_PORT.`);
  }
  if (!cfg.token) throw new Error('RIPPER_STAGING_TOKEN ausente. Rode o up de novo (ele gera o token) ou defina a variável.');
  const child = spawn(process.execPath, [join(ROOT, 'server.mjs')], {
    cwd: ROOT,
    env: stagingEnv(cfg),
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
  writePid(cfg, child.pid);
  await waitForHealth(cfg.url, cfg.token);
  console.log(`Staging local em ${cfg.url} (RIPPER_STAGING_DATA=${cfg.dataDir}, provedor=${cfg.provider})`);
  console.log(`Entre com ?token=${cfg.token} ou senha ${cfg.password}`);
}

function runCompose(args, { inherit = true } = {}) {
  const r = spawnSync('docker', composeArgs(args), {
    cwd: COMPOSE_DIR,
    stdio: inherit ? 'inherit' : 'pipe',
    encoding: 'utf8'
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || '').toString().trim() || `docker compose saiu com código ${r.status}`;
    throw new Error(err);
  }
  return r;
}

async function upDocker(cfg) {
  runCompose(['up', '-d', '--build']);
  await waitForHealth(cfg.url, cfg.token, 120_000);
  console.log(`Staging Docker em ${cfg.url} (volume ripper-staging-data, provedor=${cfg.provider})`);
  console.log(`Entre com ?token=${cfg.token} ou senha ${cfg.password}`);
}

function withToken(cfg, env) {
  const ensured = ensureStagingToken(env);
  return { ...cfg, token: ensured.token, generatedToken: ensured.generated };
}

async function cmdUp(cfg, opts, env) {
  const ready = withToken(cfg, env);
  if (!opts.local && hasDockerCompose()) return upDocker(ready);
  if (!opts.local && !hasDockerCompose()) {
    console.log('Docker Compose não encontrado; subindo o equivalente local (Node).');
  }
  return upLocal(ready);
}

function cmdDown(cfg, opts) {
  if (!opts.local && hasDockerCompose()) {
    try { runCompose(['down']); return; } catch (e) {
      console.warn(e.message);
    }
  }
  stopPid(cfg);
  console.log('Staging parado (dados mantidos).');
}

async function cmdRestart(cfg, opts, env) {
  const ready = withToken(cfg, env);
  if (!opts.local && hasDockerCompose()) {
    runCompose(['restart']);
    await waitForHealth(ready.url, ready.token, 120_000);
    console.log(`Staging reiniciado em ${ready.url} (dados do volume mantidos).`);
    return;
  }
  stopPid(ready);
  await upLocal(ready);
}

async function cmdStatus(cfg) {
  try {
    const z = await fetch(cfg.url + '/healthz');
    const body = z.ok ? await z.json() : { ok: false, status: z.status };
    const ready = await fetch(cfg.url + '/readyz').then(r => r.json()).catch(() => ({ ok: false }));
    const out = { url: cfg.url, healthz: body, readyz: ready, provider: cfg.provider };
    console.log(JSON.stringify(out, null, 2));
    if (!body.ok || ready.ok === false) process.exitCode = 1;
  } catch (e) {
    console.log(JSON.stringify({ url: cfg.url, ok: false, error: e.message }, null, 2));
    process.exitCode = 1;
  }
}

export function runSmoke(cfg, { json = false } = {}) {
  if (!cfg.token) throw new Error('RIPPER_STAGING_TOKEN ausente. Rode `up` antes do smoke.');
  const args = [join(ROOT, 'scripts', 'smoke.mjs')];
  if (json) args.push('--json');
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: smokeEnv(cfg),
    stdio: 'inherit'
  });
  return r.status ?? 1;
}

async function cmdSeed(cfg, opts, env) {
  const out = await seedDataDir(cfg.dataDir, { force: opts.force, password: cfg.password, env });
  console.log(out.seeded
    ? `Seed gravado em ${cfg.dataDir}`
    : `Já havia dados em ${cfg.dataDir} (passe --force para substituir; exige RIPPER_ENV=staging).`);
}

async function cmdReset(cfg, opts, env) {
  assertDestructiveAllowed(cfg.dataDir, env);
  if (!opts.local && hasDockerCompose()) {
    runCompose(['down', '-v']);
  }
  try { stopPid(cfg); } catch { /* processo alheio: pasta mesmo assim é de staging */ }
  rmSync(cfg.dataDir, { recursive: true, force: true });
  await seedDataDir(cfg.dataDir, { force: true, password: cfg.password, env, skipGuard: true });
  console.log(`Staging resetado e semeado em ${cfg.dataDir}`);
}

async function cmdServe(cfg, env) {
  const ready = withToken(cfg, env);
  await seedDataDir(ready.dataDir, { password: ready.password });
  const child = spawn(process.execPath, [join(ROOT, 'server.mjs')], {
    cwd: ROOT,
    env: stagingEnv(ready),
    stdio: 'inherit',
    windowsHide: true
  });
  const stop = sig => { try { child.kill(sig); } catch { /* ignore */ } };
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => stop(s));
  const code = await new Promise(r => child.on('exit', r));
  process.exit(code ?? 0);
}

export async function main(argv = process.argv.slice(2), processEnv = process.env) {
  const opts = parseArgs(argv);
  if (opts.help || !opts.cmd) {
    console.log(usage());
    if (!opts.cmd && !opts.help) process.exitCode = 1;
    return;
  }
  const env = stagingInputEnv(processEnv);
  const cfg = resolveConfig(env, { docker: opts.cmd === 'serve' });
  const cmds = {
    up: () => cmdUp(cfg, opts, env),
    down: () => cmdDown(cfg, opts),
    restart: () => cmdRestart(cfg, opts, env),
    status: () => cmdStatus(cfg),
    smoke: () => { const code = runSmoke(withToken(cfg, env), opts); process.exitCode = code; },
    seed: () => cmdSeed(cfg, opts, env),
    reset: () => cmdReset(cfg, opts, env),
    serve: () => cmdServe(cfg, env)
  };
  const fn = cmds[opts.cmd];
  if (!fn) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }
  await fn();
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  main().catch(e => {
    console.error(e.message || e);
    process.exit(1);
  });
}
