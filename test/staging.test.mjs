import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from './helpers/free-port.mjs';
import {
  COMPOSE_FILE,
  DEFAULT_STAGING_DATA,
  ROOT,
  STAGING_MARKER,
  assertDestructiveAllowed,
  ensureStagingToken,
  isAllowedStagingDir,
  isStagingServerPid,
  parseArgs,
  readSeedDb,
  resolveConfig,
  seedDataDir,
  smokeEnv,
  stagingEnv,
  stagingInputEnv,
  stopPid,
  usage,
  waitForHealth,
  writePid,
  writeStagingMarker
} from '../scripts/staging.mjs';

const stagingPath = fileURLToPath(new URL('../scripts/staging.mjs', import.meta.url));
const smokePath = fileURLToPath(new URL('../scripts/smoke.mjs', import.meta.url));
const dockerfile = fileURLToPath(new URL('../deploy/staging/Dockerfile', import.meta.url));

test('CLI: ajuda lista os comandos do staging', () => {
  const text = usage();
  for (const cmd of ['up', 'down', 'restart', 'status', 'smoke', 'seed', 'reset', 'serve']) {
    assert.match(text, new RegExp(`\\b${cmd}\\b`));
  }
  assert.match(text, /RIPPER_STAGING_TOKEN|RIPPER_ENV/);
  const parsed = parseArgs(['up', '--local', '--force']);
  assert.equal(parsed.cmd, 'up');
  assert.equal(parsed.local, true);
  assert.equal(parsed.force, true);
});

test('resolveConfig ignora RIPPER_DATA / RIPPER_TOKEN / HOST / PORT de produção', () => {
  const cfg = resolveConfig({
    RIPPER_DATA: '/var/ripper-prod',
    RIPPER_TOKEN: 'token-de-producao',
    HOST: '0.0.0.0',
    PORT: '80',
    RIPPER_PASSWORD: 'senha-prod',
    RIPPER_URL: 'http://prod.example',
    RIPPER_STAGING_DATA: '/tmp/ripper-stg',
    RIPPER_STAGING_PORT: '3010',
    RIPPER_STAGING_TOKEN: 'tok-stg',
    RIPPER_STAGING_PROVIDER: 'stream'
  });
  assert.equal(cfg.dataDir, '/tmp/ripper-stg');
  assert.notEqual(cfg.dataDir, '/var/ripper-prod');
  assert.equal(cfg.token, 'tok-stg');
  assert.notEqual(cfg.token, 'token-de-producao');
  assert.equal(cfg.host, '127.0.0.1');
  assert.equal(cfg.hostPort, 3010);
  assert.equal(cfg.url, 'http://127.0.0.1:3010');
  const ignored = resolveConfig({
    RIPPER_DATA: '/var/ripper-prod',
    RIPPER_TOKEN: 'token-de-producao'
  });
  assert.equal(ignored.dataDir, DEFAULT_STAGING_DATA);
  assert.equal(ignored.token, '');
});

test('stagingInputEnv só copia chaves RIPPER_STAGING_*', () => {
  const got = stagingInputEnv({
    RIPPER_DATA: '/prod',
    RIPPER_TOKEN: 'prod-token',
    ANTHROPIC_API_KEY: 'sk-real',
    RIPPER_STAGING_TOKEN: 'stg',
    RIPPER_ENV: 'staging',
    NODE_ENV: 'development'
  }, {});
  assert.equal(got.RIPPER_STAGING_TOKEN, 'stg');
  assert.equal(got.RIPPER_ENV, 'staging');
  assert.equal(got.RIPPER_DATA, undefined);
  assert.equal(got.RIPPER_TOKEN, undefined);
  assert.equal(got.ANTHROPIC_API_KEY, undefined);
});

test('stagingEnv e smokeEnv não levam chaves reais do process.env', () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-nao-deve-ir';
  process.env.GITHUB_TOKEN = 'ghp-nao-deve-ir';
  try {
    const cfg = {
      host: '127.0.0.1',
      port: 3010,
      dataDir: '/tmp/stg',
      token: 'abc',
      provider: 'stream',
      password: 'staging-ok-8',
      url: 'http://127.0.0.1:3010'
    };
    const sev = stagingEnv(cfg);
    assert.equal(sev.RIPPER_DATA, '/tmp/stg');
    assert.equal(sev.RIPPER_TOKEN, 'abc');
    assert.equal(sev.RIPPER_ENV, 'staging');
    assert.equal(sev.RIPPER_TEST_PROVIDER, 'stream');
    assert.equal(sev.ANTHROPIC_API_KEY, undefined);
    assert.equal(sev.GITHUB_TOKEN, undefined);
    const smoke = smokeEnv(cfg);
    assert.equal(smoke.RIPPER_URL, 'http://127.0.0.1:3010');
    assert.equal(smoke.SMOKE_TEST_PROVIDER, '1');
    assert.equal(smoke.ANTHROPIC_API_KEY, undefined);
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
    delete process.env.GITHUB_TOKEN;
  }
});

test('seed: dados de exemplo têm dois agentes e não sobrescrevem sem --force', async () => {
  const seed = readSeedDb();
  assert.equal(seed.schemaVersion, 2);
  assert.equal(seed.agents.length, 2);
  assert.ok(seed.agents.some(a => a.id === 'stg-assistente'));
  assert.ok(seed.agents.some(a => a.id === 'stg-relator'));
  assert.equal(seed.settings.onboarded, true);
  assert.equal(seed.settings.computer.mode, 'none');

  const dir = mkdtempSync(join(tmpdir(), 'ripper-stg-seed-'));
  const first = await seedDataDir(dir, { password: 'staging-ok-8' });
  assert.equal(first.seeded, true);
  assert.equal(existsSync(join(dir, 'db.json')), true);
  assert.equal(existsSync(join(dir, 'auth.json')), true);
  assert.equal(existsSync(join(dir, STAGING_MARKER)), true);
  writeFileSync(join(dir, 'db.json'), '{"marcador":true}');
  const second = await seedDataDir(dir);
  assert.equal(second.seeded, false);
  assert.equal(JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8')).marcador, true);
  const forced = await seedDataDir(dir, { force: true, password: 'staging-ok-8', env: { RIPPER_ENV: 'staging' } });
  assert.equal(forced.seeded, true);
  assert.equal(JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8')).agents[0].id, 'stg-assistente');
});

test('reset/seed --force recusam pasta fora de data/staging sem marcador', async () => {
  const alien = mkdtempSync(join(tmpdir(), 'ripper-prod-data-'));
  writeFileSync(join(alien, 'db.json'), '{"prod":true}');
  assert.equal(isAllowedStagingDir(alien), false);
  assert.throws(() => assertDestructiveAllowed(alien, { RIPPER_ENV: 'staging' }), /marcador|data\/staging/);
  assert.throws(() => assertDestructiveAllowed(DEFAULT_STAGING_DATA, {}), /RIPPER_ENV=staging/);
  await assert.rejects(
    () => seedDataDir(alien, { force: true, env: { RIPPER_ENV: 'staging' } }),
    /marcador|data\/staging/
  );
  assert.equal(JSON.parse(readFileSync(join(alien, 'db.json'), 'utf8')).prod, true);

  writeStagingMarker(alien);
  assert.equal(isAllowedStagingDir(alien), true);
  assertDestructiveAllowed(alien, { RIPPER_ENV: 'staging' });
  assert.throws(() => assertDestructiveAllowed(alien, { NODE_ENV: 'production' }), /RIPPER_ENV=staging/);

  const under = join(DEFAULT_STAGING_DATA, 'nested-test');
  assert.equal(isAllowedStagingDir(under), true);
});

test('compose publica só em 127.0.0.1 e exige RIPPER_STAGING_TOKEN', () => {
  const yml = readFileSync(COMPOSE_FILE, 'utf8');
  assert.match(yml, /127\.0\.0\.1:\$\{RIPPER_STAGING_PORT:-3010\}:3000/);
  assert.match(yml, /RIPPER_STAGING_TOKEN: \$\{RIPPER_STAGING_TOKEN:\?/);
  assert.doesNotMatch(yml, /RIPPER_TOKEN: \$\{RIPPER_TOKEN/);
  assert.doesNotMatch(yml, /ripper-staging-token/);
  assert.match(yml, /RIPPER_ENV: staging/);
  assert.match(yml, /ripper-staging-data/);
  assert.match(yml, /restart:\s*unless-stopped/);
  const df = readFileSync(dockerfile, 'utf8');
  assert.match(df, /RIPPER_ENV=staging/);
  assert.doesNotMatch(df, /^\s*NODE_ENV=production\b/m);
  assert.doesNotMatch(df, /ENV NODE_ENV=/);
  assert.match(df, /scripts\/staging\.mjs/);
  assert.match(df, /VOLUME \["\/data"\]/);
});

test('ensureStagingToken gera aleatório e não usa fallback fixo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-stg-env-'));
  const envFile = join(dir, '.env');
  const a = ensureStagingToken({}, { envFile });
  assert.equal(a.generated, true);
  assert.ok(a.token.length >= 16);
  assert.notEqual(a.token, 'ripper-staging-token');
  const b = ensureStagingToken({}, { envFile });
  assert.equal(b.generated, false);
  assert.equal(b.token, a.token);
  const c = ensureStagingToken({ RIPPER_STAGING_TOKEN: 'explicit' }, { envFile });
  assert.equal(c.token, 'explicit');
  assert.equal(c.generated, false);
});

test('stopPid só mata processo que é o servidor de staging', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-stg-pid-'));
  const cfg = { dataDir: dir, pidFile: join(dir, 'staging.pid') };
  assert.equal(isStagingServerPid(1, cfg, { command: '/usr/sbin/sshd', environ: '' }), false);
  assert.equal(isStagingServerPid(9, cfg, { command: 'node server.mjs', environ: 'HOME=/tmp\0RIPPER_ENV=staging\0' }), true);
  assert.equal(isStagingServerPid(9, cfg, { command: 'node server.mjs', environ: `RIPPER_DATA=${dir}\0` }), true);
  assert.equal(isStagingServerPid(9, cfg, { command: 'node server.mjs', environ: 'RIPPER_DATA=/var/ripper-prod\0' }), false);
  assert.equal(isStagingServerPid(9, cfg, { command: 'node other.mjs', environ: 'RIPPER_ENV=staging\0' }), false);

  const decoy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  writePid(cfg, decoy.pid);
  try {
    assert.throws(() => stopPid(cfg), /não é o servidor de staging/);
    assert.equal(existsSync(cfg.pidFile), true);
    process.kill(decoy.pid, 0);
  } finally {
    decoy.kill('SIGKILL');
  }
});

test('seed carrega no store sem inventar um terceiro agente', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-stg-store-'));
  await seedDataDir(dir, { password: 'staging-ok-8' });
  const prev = process.env.RIPPER_DATA;
  process.env.RIPPER_DATA = dir;
  const store = await import('../lib/store.mjs');
  store._resetStoreForTests();
  try {
    const db = store.load();
    assert.equal(db.agents.length, 2);
    assert.deepEqual(db.agents.map(a => a.id).sort(), ['stg-assistente', 'stg-relator']);
    assert.ok(db.memories.some(m => m.id === 'stg-mem-1'));
    assert.ok(db.routines.some(r => r.id === 'stg-rotina-resumo'));
  } finally {
    store._resetStoreForTests();
    process.env.RIPPER_DATA = prev;
  }
});

test('ajuda e reset sem RIPPER_ENV pela CLI não apagam dados', () => {
  const help = spawnSync(process.execPath, [stagingPath, 'help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /smoke/);

  const alien = mkdtempSync(join(tmpdir(), 'ripper-cli-prod-'));
  writeFileSync(join(alien, 'db.json'), '{"prod":true}');
  const r = spawnSync(process.execPath, [stagingPath, 'reset'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      RIPPER_STAGING_DATA: alien,
      RIPPER_DATA: alien,
      NODE_ENV: 'production'
    }
  });
  assert.notEqual(r.status, 0);
  assert.match((r.stderr || r.stdout), /RIPPER_ENV=staging/);
  assert.equal(JSON.parse(readFileSync(join(alien, 'db.json'), 'utf8')).prod, true);
});

async function startServe(env) {
  const child = spawn(process.execPath, [stagingPath, 'serve'], { env, stdio: 'ignore' });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  return { child, exited };
}

async function stopServe(handle) {
  if (!handle?.child || handle.child.killed) return;
  handle.child.kill('SIGTERM');
  await Promise.race([
    handle.exited,
    new Promise(r => setTimeout(r, 8_000))
  ]);
  if (handle.child.exitCode === null && handle.child.signalCode === null) {
    handle.child.kill('SIGKILL');
    await handle.exited.catch(() => {});
  }
}

test('serve sobrevive a reinício e o smoke passa contra o staging', { timeout: 180_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-stg-live-'));
  const port = await freePort();
  const token = 'ripper-staging-itest-token';
  const url = `http://127.0.0.1:${port}`;
  const env = {
    PATH: process.env.PATH,
    LANG: process.env.LANG,
    TMPDIR: process.env.TMPDIR,
    RIPPER_STAGING_HOST: '127.0.0.1',
    RIPPER_STAGING_PORT: String(port),
    RIPPER_STAGING_DATA: dataDir,
    RIPPER_STAGING_TOKEN: token,
    RIPPER_STAGING_PROVIDER: 'stream',
    RIPPER_STAGING_PASSWORD: 'staging-ok-8',
    RIPPER_STAGING_URL: url,
    RIPPER_ENV: 'staging',
    HOME: dataDir,
    USERPROFILE: dataDir
  };
  const api = (path, tokenOverride = token) => fetch(url + path, {
    headers: { authorization: `Bearer ${tokenOverride}` }
  });

  let handle = await startServe(env);
  try {
    await waitForHealth(url, token, 60_000);
    const first = await (await api('/api/state')).json();
    assert.ok(first.agents.some(a => a.id === 'stg-assistente'));
    assert.ok(first.agents.some(a => a.id === 'stg-relator'));
    assert.ok((first.memoriesByAgent || {})['stg-assistente'] >= 1, 'memória de exemplo não carregou');
    assert.equal(existsSync(join(dataDir, STAGING_MARKER)), true);

    await stopServe(handle);
    handle = await startServe(env);
    await waitForHealth(url, token, 60_000);
    const again = await (await api('/api/state')).json();
    assert.ok(again.agents.some(a => a.id === 'stg-assistente'), 'agente de exemplo sumiu após o reinício');
    assert.ok(again.agents.some(a => a.id === 'stg-relator'), 'segundo agente sumiu após o reinício');
    assert.ok((again.memoriesByAgent || {})['stg-assistente'] >= 1, 'memória de exemplo sumiu após o reinício');

    const smoke = spawnSync(process.execPath, [smokePath], {
      env: smokeEnv({ url, token, password: 'staging-ok-8', dataDir }),
      encoding: 'utf8',
      timeout: 90_000
    });
    if (smoke.status !== 0) {
      throw new Error(`smoke falhou (${smoke.status}):\n${smoke.stdout}\n${smoke.stderr}`);
    }
    assert.match(smoke.stdout, /smoke ok/);
  } finally {
    await stopServe(handle);
  }
});
