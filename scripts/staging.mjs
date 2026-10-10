#!/usr/bin/env node
/**
 * Staging reproduzível do Ripper.
 *
 *   node scripts/staging.mjs up        # Docker Compose se houver; senão Node local
 *   node scripts/staging.mjs up --local
 *   node scripts/staging.mjs down
 *   node scripts/staging.mjs restart
 *   node scripts/staging.mjs status
 *   node scripts/staging.mjs smoke     # npm run smoke contra o staging (RIPPER_TEST_PROVIDER)
 *   node scripts/staging.mjs seed [--force]
 *   node scripts/staging.mjs reset
 *   node scripts/staging.mjs serve     # primeiro plano (CMD do Docker)
 *
 * Dados de exemplo em deploy/staging/seed/. O diretório RIPPER_DATA sobrevive a reinício.
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../lib/auth.mjs';

const SELF = fileURLToPath(import.meta.url);
export const ROOT = resolve(dirname(SELF), '..');
export const COMPOSE_DIR = join(ROOT, 'deploy', 'staging');
export const COMPOSE_FILE = join(COMPOSE_DIR, 'docker-compose.yml');
export const SEED_DIR = join(COMPOSE_DIR, 'seed');
export const SEED_DB = join(SEED_DIR, 'db.json');

export const DEFAULTS = {
  port: 3010,
  host: '127.0.0.1',
  token: 'ripper-staging-token',
  provider: 'stream',
  password: 'staging-ok-8',
  dataDirName: 'staging'
};

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

export function resolveConfig(env = process.env, opts = {}) {
  const hostPort = Number(env.RIPPER_STAGING_PORT || DEFAULTS.port);
  const listenPort = Number(env.PORT || (opts.docker ? 3000 : hostPort));
  const dataDir = resolve(env.RIPPER_DATA || join(ROOT, 'data', DEFAULTS.dataDirName));
  const token = env.RIPPER_TOKEN || DEFAULTS.token;
  const provider = env.RIPPER_TEST_PROVIDER || DEFAULTS.provider;
  const password = env.RIPPER_STAGING_PASSWORD || env.RIPPER_PASSWORD || DEFAULTS.password;
  const host = env.HOST || (opts.docker ? '0.0.0.0' : DEFAULTS.host);
  const url = (env.RIPPER_URL || `http://127.0.0.1:${hostPort}`).replace(/\/$/, '');
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

export function stagingEnv(cfg, extra = {}) {
  return {
    ...process.env,
    ...extra,
    HOST: cfg.host,
    PORT: String(cfg.port),
    RIPPER_DATA: cfg.dataDir,
    RIPPER_TOKEN: cfg.token,
    RIPPER_TEST_PROVIDER: cfg.provider,
    RIPPER_STAGING_PASSWORD: cfg.password,
    JULIA_AUTOSTART: extra.JULIA_AUTOSTART || '0',
    RIPPER_NO_PREWARM: extra.RIPPER_NO_PREWARM || '1',
    HOME: extra.HOME || cfg.dataDir,
    USERPROFILE: extra.USERPROFILE || cfg.dataDir
  };
}

export function smokeEnv(cfg) {
  return {
    ...process.env,
    RIPPER_URL: cfg.url,
    RIPPER_TOKEN: cfg.token,
    RIPPER_PASSWORD: cfg.password,
    SMOKE_TEST_PROVIDER: '1'
  };
}

/** Copia o db.json de exemplo e grava a senha conhecida. Não sobrescreve sem force. */
export async function seedDataDir(dataDir, { force = false, password = DEFAULTS.password } = {}) {
  if (!existsSync(SEED_DB)) throw new Error(`seed não encontrado: ${SEED_DB}`);
  mkdirSync(dataDir, { recursive: true });
  const dest = join(dataDir, 'db.json');
  const authPath = join(dataDir, 'auth.json');
  if (existsSync(dest) && !force) return { seeded: false, reason: 'exists', dataDir };
  copyFileSync(SEED_DB, dest);
  const hash = await hashPassword(password);
  writeFileSync(authPath, JSON.stringify({ hash, updatedAt: Date.now() }), { mode: 0o600 });
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
  return ['compose', '-f', COMPOSE_FILE, ...rest];
}

export function usage() {
  return `Uso: node scripts/staging.mjs <comando>

Comandos:
  up [--local]   Sobe o staging (Docker Compose, ou Node se não houver Docker / com --local)
  down           Para o staging
  restart        Reinicia sem apagar os dados
  status         Saúde em ${DEFAULTS.port} (ou RIPPER_STAGING_PORT / RIPPER_URL)
  smoke          Roda npm run smoke contra o staging (RIPPER_TEST_PROVIDER)
  seed [--force] Copia os dados de exemplo (não sobrescreve sem --force)
  reset          Apaga o RIPPER_DATA do staging e semeia de novo
  serve          Semeia se vazio e sobe o servidor em primeiro plano (CMD do Docker)

Padrões: porta ${DEFAULTS.port}, token ${DEFAULTS.token}, senha ${DEFAULTS.password},
provedor ${DEFAULTS.provider}. Volume / pasta de dados sobrevive a reinício.
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

function writePid(cfg, pid) {
  mkdirSync(cfg.dataDir, { recursive: true });
  writeFileSync(cfg.pidFile, String(pid));
}

export function readPid(cfg) {
  try {
    const n = Number(readFileSync(cfg.pidFile, 'utf8').trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function sleepSync(ms) {
  spawnSync(process.execPath, ['-e', `setTimeout(() => {}, ${Number(ms) || 0})`], { stdio: 'ignore' });
}

function stopPid(cfg) {
  const pid = readPid(cfg);
  if (pidAlive(pid)) {
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
    console.log(`Staging local já está no ar (pid ${readPid(cfg)}) em ${cfg.url}`);
    return;
  }
  if (!(await portFree(cfg.port))) {
    throw new Error(`porta ${cfg.port} em uso. Pare o processo ou mude RIPPER_STAGING_PORT / PORT.`);
  }
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
  console.log(`Staging local em ${cfg.url} (RIPPER_DATA=${cfg.dataDir}, provedor=${cfg.provider})`);
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

async function cmdUp(cfg, opts) {
  if (!opts.local && hasDockerCompose()) return upDocker(cfg);
  if (!opts.local && !hasDockerCompose()) {
    console.log('Docker Compose não encontrado; subindo o equivalente local (Node).');
  }
  return upLocal(cfg);
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

async function cmdRestart(cfg, opts) {
  if (!opts.local && hasDockerCompose()) {
    runCompose(['restart']);
    await waitForHealth(cfg.url, cfg.token, 120_000);
    console.log(`Staging reiniciado em ${cfg.url} (dados do volume mantidos).`);
    return;
  }
  stopPid(cfg);
  await upLocal(cfg);
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
  const args = [join(ROOT, 'scripts', 'smoke.mjs')];
  if (json) args.push('--json');
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: smokeEnv(cfg),
    stdio: 'inherit'
  });
  return r.status ?? 1;
}

async function cmdSeed(cfg, opts) {
  const out = await seedDataDir(cfg.dataDir, { force: opts.force, password: cfg.password });
  console.log(out.seeded
    ? `Seed gravado em ${cfg.dataDir}`
    : `Já havia dados em ${cfg.dataDir} (passe --force para substituir).`);
}

async function cmdReset(cfg, opts) {
  if (!opts.local && hasDockerCompose()) {
    runCompose(['down', '-v']);
  }
  stopPid(cfg);
  rmSync(cfg.dataDir, { recursive: true, force: true });
  await seedDataDir(cfg.dataDir, { force: true, password: cfg.password });
  console.log(`Staging resetado e semeado em ${cfg.dataDir}`);
}

async function cmdServe(cfg) {
  await seedDataDir(cfg.dataDir, { password: cfg.password });
  const child = spawn(process.execPath, [join(ROOT, 'server.mjs')], {
    cwd: ROOT,
    env: stagingEnv(cfg),
    stdio: 'inherit',
    windowsHide: true
  });
  const stop = sig => { try { child.kill(sig); } catch { /* ignore */ } };
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => stop(s));
  const code = await new Promise(r => child.on('exit', r));
  process.exit(code ?? 0);
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const opts = parseArgs(argv);
  if (opts.help || !opts.cmd) {
    console.log(usage());
    if (!opts.cmd && !opts.help) process.exitCode = 1;
    return;
  }
  const cfg = resolveConfig(env, { docker: opts.cmd === 'serve' });
  const cmds = {
    up: () => cmdUp(cfg, opts),
    down: () => cmdDown(cfg, opts),
    restart: () => cmdRestart(cfg, opts),
    status: () => cmdStatus(cfg),
    smoke: () => { const code = runSmoke(cfg, opts); process.exitCode = code; },
    seed: () => cmdSeed(cfg, opts),
    reset: () => cmdReset(cfg, opts),
    serve: () => cmdServe(cfg)
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
