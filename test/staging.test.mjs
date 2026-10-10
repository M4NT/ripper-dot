import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, symlinkSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from './helpers/free-port.mjs';
import {
  COMPOSE_FILE,
  DEFAULT_PRODUCTION_DATA,
  DEFAULT_STAGING_DATA,
  ROOT,
  assertDestructiveAllowed,
  claimStagingDir,
  ensureStagingSecrets,
  ensureStagingToken,
  environHasExact,
  isAllowedStagingDir,
  isForbiddenStagingDir,
  isNewOrEmptyDir,
  isProductionDataDir,
  isStagingServerPid,
  parseArgs,
  readClaimRecord,
  readSeedDb,
  resolveConfig,
  seedDataDir,
  smokeEnv,
  stagingEnv,
  stagingInputEnv,
  stopPid,
  usage,
  waitForHealth,
  writePid
} from '../scripts/staging.mjs';

const stagingPath = fileURLToPath(new URL('../scripts/staging.mjs', import.meta.url));
const smokePath = fileURLToPath(new URL('../scripts/smoke.mjs', import.meta.url));
const dockerfile = fileURLToPath(new URL('../deploy/staging/Dockerfile', import.meta.url));
const envExample = fileURLToPath(new URL('../deploy/staging/.env.example', import.meta.url));

function tempClaim() {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-stg-claim-'));
  return {
    dir,
    claimFile: join(dir, 'claim'),
    envFile: join(dir, '.env'),
    password: 'x'.repeat(12)
  };
}

test('CLI: ajuda lista os comandos do staging', () => {
  const text = usage();
  for (const cmd of ['up', 'down', 'restart', 'status', 'smoke', 'seed', 'reset', 'serve']) {
    assert.match(text, new RegExp(`\\b${cmd}\\b`));
  }
  assert.match(text, /RIPPER_STAGING_TOKEN|RIPPER_ENV/);
  assert.doesNotMatch(text, /staging-ok-8/);
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
  assert.equal(ignored.password, '');
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

test('stagingEnv e smokeEnv não levam chaves reais nem o HOME real', () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  const prevHome = process.env.HOME;
  process.env.ANTHROPIC_API_KEY = 'sk-nao-deve-ir';
  process.env.GITHUB_TOKEN = 'ghp-nao-deve-ir';
  process.env.HOME = '/home/usuario-real';
  try {
    const cfg = {
      host: '127.0.0.1',
      port: 3010,
      dataDir: '/tmp/stg-home-isolado',
      token: 'abc',
      provider: 'stream',
      password: 'segredo-nao-imprimir',
      url: 'http://127.0.0.1:3010'
    };
    const sev = stagingEnv(cfg);
    assert.equal(sev.RIPPER_DATA, '/tmp/stg-home-isolado');
    assert.equal(sev.RIPPER_TOKEN, 'abc');
    assert.equal(sev.RIPPER_ENV, 'staging');
    assert.equal(sev.HOME, '/tmp/stg-home-isolado');
    assert.notEqual(sev.HOME, '/home/usuario-real');
    assert.equal(sev.ANTHROPIC_API_KEY, undefined);
    const smoke = smokeEnv(cfg);
    assert.equal(smoke.HOME, '/tmp/stg-home-isolado');
    assert.equal(smoke.USERPROFILE, '/tmp/stg-home-isolado');
    assert.notEqual(smoke.HOME, process.env.HOME);
    assert.equal(smoke.SMOKE_TEST_PROVIDER, '1');
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    delete process.env.GITHUB_TOKEN;
  }
});

test('seed: dados de exemplo, sem marcador interno, force só com reivindicação', async () => {
  const seed = readSeedDb();
  assert.equal(seed.schemaVersion, 2);
  assert.equal(seed.agents.length, 2);
  const { claimFile, envFile, password } = tempClaim();
  const dir = mkdtempSync(join(tmpdir(), 'ripper-stg-seed-'));
  const first = await seedDataDir(dir, { password, claimFile, envFile });
  assert.equal(first.seeded, true);
  assert.equal(existsSync(join(dir, 'db.json')), true);
  assert.equal(existsSync(join(dir, '.ripper-staging')), false);
  writeFileSync(join(dir, 'db.json'), '{"marcador":true}');
  const second = await seedDataDir(dir, { password, claimFile, envFile });
  assert.equal(second.seeded, false);
  assert.equal(existsSync(join(dir, '.ripper-staging')), false);
  assert.equal(JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8')).marcador, true);
  const forced = await seedDataDir(dir, {
    force: true,
    password,
    env: { RIPPER_ENV: 'staging' },
    claimFile,
    envFile
  });
  assert.equal(forced.seeded, true);
  assert.equal(JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8')).agents[0].id, 'stg-assistente');
});

test('up/serve não reivindicam pasta que já tem db.json; recusam produção', async () => {
  const { claimFile, envFile, password } = tempClaim();
  const existing = mkdtempSync(join(tmpdir(), 'ripper-stg-exist-'));
  writeFileSync(join(existing, 'db.json'), '{"ja":true}');
  const out = await seedDataDir(existing, { password, claimFile, envFile });
  assert.equal(out.seeded, false);
  assert.equal(out.claimed, false);
  assert.equal(existsSync(join(existing, '.ripper-staging')), false);
  assert.equal(isAllowedStagingDir(existing, { claimFile }), false);

  await assert.rejects(
    () => seedDataDir(DEFAULT_PRODUCTION_DATA, { password, claimFile, envFile }),
    /produção/
  );
  const prod = mkdtempSync(join(tmpdir(), 'ripper-prod-env-'));
  await assert.rejects(
    () => seedDataDir(prod, { password, claimFile, envFile, processEnv: { RIPPER_DATA: prod } }),
    /produção/
  );
  assert.equal(isProductionDataDir(DEFAULT_PRODUCTION_DATA), true);
  assert.equal(isProductionDataDir(DEFAULT_STAGING_DATA), false);
  assert.match(DEFAULT_STAGING_DATA, /\.staging-data$/);
  assert.equal(DEFAULT_STAGING_DATA.startsWith(DEFAULT_PRODUCTION_DATA + '/'), false);
  assert.equal(isForbiddenStagingDir(DEFAULT_STAGING_DATA), false);
  assert.equal(isForbiddenStagingDir(join(ROOT, 'data', 'staging')), true);
});

test('reset/seed --force recusam pasta não reivindicada, produção e symlink', async () => {
  const { claimFile, envFile, password } = tempClaim();
  const alien = mkdtempSync(join(tmpdir(), 'ripper-prod-data-'));
  writeFileSync(join(alien, 'db.json'), '{"prod":true}');
  assert.equal(isAllowedStagingDir(alien, { claimFile }), false);
  assert.throws(() => assertDestructiveAllowed(alien, { RIPPER_ENV: 'staging' }, { claimFile }), /registrada|produção|marcador/);
  assert.throws(() => assertDestructiveAllowed(DEFAULT_STAGING_DATA, {}), /RIPPER_ENV=staging/);
  assert.throws(
    () => assertDestructiveAllowed(DEFAULT_PRODUCTION_DATA, { RIPPER_ENV: 'staging' }, { claimFile }),
    /produção/
  );
  await assert.rejects(
    () => seedDataDir(alien, { force: true, password, env: { RIPPER_ENV: 'staging' }, claimFile, envFile }),
    /registrada|produção|marcador/
  );
  assert.equal(JSON.parse(readFileSync(join(alien, 'db.json'), 'utf8')).prod, true);

  const ok = mkdtempSync(join(tmpdir(), 'ripper-stg-ok-'));
  claimStagingDir(ok, { claimFile, envFile });
  assert.equal(isAllowedStagingDir(ok, { claimFile, envFile }), true);
  assertDestructiveAllowed(ok, { RIPPER_ENV: 'staging' }, { claimFile, envFile });
  const rec = readClaimRecord(claimFile);
  assert.ok(rec.id);
  assert.equal(rec.path, ok);

  const parent = mkdtempSync(join(tmpdir(), 'ripper-stg-link-'));
  const real = join(parent, 'real');
  const link = join(parent, 'staging');
  mkdirSync(real);
  symlinkSync(real, link);
  assert.throws(
    () => assertDestructiveAllowed(link, { RIPPER_ENV: 'staging' }, { claimFile }),
    /symlink/
  );
  await assert.rejects(
    () => seedDataDir(link, { force: true, password, env: { RIPPER_ENV: 'staging' }, claimFile, envFile }),
    /symlink/
  );
});

test('recusa pasta que contém ou está dentro da produção, ROOT, $HOME e /', () => {
  assert.equal(isForbiddenStagingDir(ROOT), true);
  assert.equal(isForbiddenStagingDir(homedir()), true);
  assert.equal(isForbiddenStagingDir('/'), true);
  assert.equal(isForbiddenStagingDir(DEFAULT_PRODUCTION_DATA), true);
  assert.equal(isForbiddenStagingDir(join(ROOT, 'data', 'staging')), true);
  assert.equal(isForbiddenStagingDir(DEFAULT_STAGING_DATA), false);

  const prod = mkdtempSync(join(tmpdir(), 'ripper-prod-anc-'));
  const processEnv = { RIPPER_DATA: prod, HOME: homedir() };
  assert.equal(isForbiddenStagingDir(prod, processEnv), true);
  assert.equal(isForbiddenStagingDir(join(prod, 'filho'), processEnv), true);
  assert.equal(isForbiddenStagingDir(join(prod, '..'), processEnv), true);
});

test('só marca pasta nova ou vazia; ID do .env tem que conferir', async () => {
  const { claimFile, envFile, password } = tempClaim();
  const nonempty = mkdtempSync(join(tmpdir(), 'ripper-stg-full-'));
  writeFileSync(join(nonempty, 'resto.txt'), 'x');
  assert.equal(isNewOrEmptyDir(nonempty), false);
  assert.throws(() => claimStagingDir(nonempty, { claimFile, envFile }), /nova ou vazia/);
  await assert.rejects(
    () => seedDataDir(nonempty, { password, claimFile, envFile }),
    /nova ou vazia|produção/
  );

  const empty = mkdtempSync(join(tmpdir(), 'ripper-stg-empty-'));
  assert.equal(isNewOrEmptyDir(empty), true);
  const claimed = claimStagingDir(empty, { claimFile, envFile });
  assert.ok(claimed.id);
  assert.equal(readClaimRecord(claimFile).id, claimed.id);

  const seeded = mkdtempSync(join(tmpdir(), 'ripper-stg-id-'));
  await seedDataDir(seeded, { password, claimFile, envFile });
  writeFileSync(envFile, 'RIPPER_STAGING_ID=id-errado\n');
  assert.throws(
    () => assertDestructiveAllowed(seeded, { RIPPER_ENV: 'staging' }, { claimFile, envFile }),
    /ID|confere/
  );
  await assert.rejects(
    () => seedDataDir(seeded, {
      force: true,
      password,
      env: { RIPPER_ENV: 'staging' },
      claimFile,
      envFile
    }),
    /ID|confere/
  );
  assert.equal(JSON.parse(readFileSync(join(seeded, 'db.json'), 'utf8')).agents[0].id, 'stg-assistente');
});

function refuseCli(cmd, extraEnv, cwd = ROOT) {
  return spawnSync(process.execPath, [stagingPath, ...cmd], {
    encoding: 'utf8',
    cwd,
    env: {
      PATH: process.env.PATH,
      ...extraEnv
    },
    timeout: 15_000
  });
}

test('up/seed/reset recusam RIPPER_STAGING_DATA=. e $HOME', () => {
  const realHome = homedir();
  const homeHadDb = existsSync(join(realHome, 'db.json'));
  for (const cmd of [['up', '--local'], ['seed'], ['reset']]) {
    const atRoot = refuseCli(cmd, {
      RIPPER_STAGING_DATA: '.',
      RIPPER_ENV: 'staging'
    }, ROOT);
    assert.notEqual(atRoot.status, 0, `${cmd.join(' ')} . deveria recusar`);
    assert.match((atRoot.stderr || atRoot.stdout), /produção|raiz|HOME|recusad/i);
    assert.equal(existsSync(join(ROOT, 'db.json')), false);

    const atHome = refuseCli(cmd, {
      RIPPER_STAGING_DATA: realHome,
      RIPPER_ENV: 'staging'
    });
    assert.notEqual(atHome.status, 0, `${cmd.join(' ')} $HOME deveria recusar`);
    assert.match((atHome.stderr || atHome.stdout), /produção|raiz|HOME|recusad/i);
    assert.equal(existsSync(join(realHome, 'db.json')), homeHadDb);
  }
});

test('compose publica só em 127.0.0.1 e exige token e senha', () => {
  const yml = readFileSync(COMPOSE_FILE, 'utf8');
  assert.match(yml, /127\.0\.0\.1:\$\{RIPPER_STAGING_PORT:-3010\}:3000/);
  assert.match(yml, /RIPPER_STAGING_TOKEN: \$\{RIPPER_STAGING_TOKEN:\?/);
  assert.match(yml, /RIPPER_STAGING_PASSWORD: \$\{RIPPER_STAGING_PASSWORD:\?/);
  assert.doesNotMatch(yml, /RIPPER_TOKEN: \$\{RIPPER_TOKEN/);
  assert.doesNotMatch(yml, /ripper-staging-token/);
  assert.doesNotMatch(yml, /staging-ok-8/);
  assert.match(yml, /RIPPER_ENV: staging/);
  const example = readFileSync(envExample, 'utf8');
  assert.doesNotMatch(example, /staging-ok-8/);
  const df = readFileSync(dockerfile, 'utf8');
  assert.match(df, /RIPPER_ENV=staging/);
  assert.doesNotMatch(df, /ENV NODE_ENV=/);
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(ci, /permissions:\s*\n\s+contents:\s*read/);
});

test('ensureStagingSecrets gera token e senha aleatórios', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-stg-env-'));
  const envFile = join(dir, '.env');
  const a = ensureStagingSecrets({}, { envFile });
  assert.equal(a.generated.token, true);
  assert.equal(a.generated.password, true);
  assert.ok(a.token.length >= 16);
  assert.ok(a.password.length >= 16);
  assert.notEqual(a.token, a.password);
  assert.notEqual(a.password, 'staging-ok-8');
  const b = ensureStagingSecrets({}, { envFile });
  assert.equal(b.generated.token, false);
  assert.equal(b.token, a.token);
  assert.equal(b.password, a.password);
  const c = ensureStagingToken({ RIPPER_STAGING_TOKEN: 'explicit' }, { envFile });
  assert.equal(c.token, 'explicit');
});

test('stopPid e environHasExact não confundem /staging com /staging-old', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-stg-pid-'));
  const cfg = { dataDir: '/x/staging', pidFile: join(dir, 'staging.pid') };
  assert.equal(environHasExact('RIPPER_DATA=/x/staging-old\0', 'RIPPER_DATA', '/x/staging'), false);
  assert.equal(environHasExact('RIPPER_DATA=/x/staging\0', 'RIPPER_DATA', '/x/staging'), true);
  assert.equal(isStagingServerPid(9, cfg, { command: 'node server.mjs', environ: 'RIPPER_DATA=/x/staging-old\0' }), false);
  assert.equal(isStagingServerPid(9, cfg, { command: 'node server.mjs', environ: 'RIPPER_DATA=/x/staging\0' }), true);
  assert.equal(isStagingServerPid(9, cfg, { command: 'node server.mjs', environ: 'HOME=/tmp\0RIPPER_ENV=staging\0' }), true);
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
  const { claimFile, envFile, password } = tempClaim();
  const dir = mkdtempSync(join(tmpdir(), 'ripper-stg-store-'));
  await seedDataDir(dir, { password, claimFile, envFile });
  const prev = process.env.RIPPER_DATA;
  process.env.RIPPER_DATA = dir;
  const store = await import('../lib/store.mjs');
  store._resetStoreForTests();
  try {
    const db = store.load();
    assert.equal(db.agents.length, 2);
    assert.deepEqual(db.agents.map(a => a.id).sort(), ['stg-assistente', 'stg-relator']);
  } finally {
    store._resetStoreForTests();
    process.env.RIPPER_DATA = prev;
  }
});

test('ajuda e reset sem RIPPER_ENV pela CLI não apagam dados', () => {
  const help = spawnSync(process.execPath, [stagingPath, 'help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /smoke/);
  assert.doesNotMatch(help.stdout, /staging-ok-8/);

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
  assert.match((r.stderr || r.stdout), /RIPPER_ENV=staging|produção/);
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
  const { claimFile, envFile } = tempClaim();
  const port = await freePort();
  const token = 'ripper-staging-itest-token';
  const password = 'ripper-staging-itest-pw';
  const url = `http://127.0.0.1:${port}`;
  const env = {
    PATH: process.env.PATH,
    LANG: process.env.LANG,
    TMPDIR: process.env.TMPDIR,
    RIPPER_STAGING_HOST: '127.0.0.1',
    RIPPER_STAGING_PORT: String(port),
    RIPPER_STAGING_DATA: dataDir,
    RIPPER_STAGING_TOKEN: token,
    RIPPER_STAGING_PASSWORD: password,
    RIPPER_STAGING_PROVIDER: 'stream',
    RIPPER_STAGING_URL: url,
    RIPPER_STAGING_CLAIM: claimFile,
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
    assert.equal(existsSync(join(dataDir, '.ripper-staging')), false);
    assert.equal(existsSync(claimFile), true);

    await stopServe(handle);
    handle = await startServe(env);
    await waitForHealth(url, token, 60_000);
    const again = await (await api('/api/state')).json();
    assert.ok(again.agents.some(a => a.id === 'stg-assistente'), 'agente de exemplo sumiu após o reinício');
    assert.ok(again.agents.some(a => a.id === 'stg-relator'), 'segundo agente sumiu após o reinício');

    const smoke = spawnSync(process.execPath, [smokePath], {
      env: smokeEnv({ url, token, password, dataDir }),
      encoding: 'utf8',
      timeout: 90_000
    });
    if (smoke.status !== 0) {
      throw new Error(`smoke falhou (${smoke.status}):\n${smoke.stdout}\n${smoke.stderr}`);
    }
    assert.match(smoke.stdout, /smoke ok/);
    assert.notEqual(smokeEnv({ url, token, password, dataDir }).HOME, process.env.HOME);
  } finally {
    await stopServe(handle);
  }
});
