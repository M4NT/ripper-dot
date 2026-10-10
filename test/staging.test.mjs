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
  DEFAULTS,
  SEED_DB,
  parseArgs,
  readSeedDb,
  resolveConfig,
  seedDataDir,
  smokeEnv,
  stagingEnv,
  usage,
  waitForHealth
} from '../scripts/staging.mjs';

const stagingPath = fileURLToPath(new URL('../scripts/staging.mjs', import.meta.url));
const smokePath = fileURLToPath(new URL('../scripts/smoke.mjs', import.meta.url));
const dockerfile = fileURLToPath(new URL('../deploy/staging/Dockerfile', import.meta.url));

test('CLI: ajuda lista os comandos do staging', () => {
  const text = usage();
  for (const cmd of ['up', 'down', 'restart', 'status', 'smoke', 'seed', 'reset', 'serve']) {
    assert.match(text, new RegExp(`\\b${cmd}\\b`));
  }
  assert.match(text, /RIPPER_TEST_PROVIDER|provedor/);
  const parsed = parseArgs(['up', '--local', '--force']);
  assert.equal(parsed.cmd, 'up');
  assert.equal(parsed.local, true);
  assert.equal(parsed.force, true);
});

test('resolveConfig e smokeEnv apontam para o staging com provedor de teste', () => {
  const cfg = resolveConfig({
    RIPPER_DATA: '/tmp/ripper-stg',
    RIPPER_STAGING_PORT: '3010',
    RIPPER_TOKEN: 'tok',
    RIPPER_TEST_PROVIDER: 'stream'
  });
  assert.equal(cfg.hostPort, 3010);
  assert.equal(cfg.token, 'tok');
  assert.equal(cfg.provider, 'stream');
  assert.equal(cfg.url, 'http://127.0.0.1:3010');
  const env = smokeEnv(cfg);
  assert.equal(env.RIPPER_URL, 'http://127.0.0.1:3010');
  assert.equal(env.RIPPER_TOKEN, 'tok');
  assert.equal(env.SMOKE_TEST_PROVIDER, '1');
  const sev = stagingEnv(cfg);
  assert.equal(sev.RIPPER_TEST_PROVIDER, 'stream');
  assert.equal(sev.RIPPER_DATA, cfg.dataDir);
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
  writeFileSync(join(dir, 'db.json'), '{"marcador":true}');
  const second = await seedDataDir(dir);
  assert.equal(second.seeded, false);
  assert.equal(JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8')).marcador, true);
  const forced = await seedDataDir(dir, { force: true, password: 'staging-ok-8' });
  assert.equal(forced.seeded, true);
  assert.equal(JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8')).agents[0].id, 'stg-assistente');
});

test('compose e Dockerfile descrevem volume persistente e provedor de teste', () => {
  const yml = readFileSync(COMPOSE_FILE, 'utf8');
  assert.match(yml, /RIPPER_TEST_PROVIDER/);
  assert.match(yml, /ripper-staging-data/);
  assert.match(yml, /restart:\s*unless-stopped/);
  assert.match(yml, /healthcheck:/);
  assert.match(yml, /RIPPER_DATA: \/data/);
  const df = readFileSync(dockerfile, 'utf8');
  assert.match(df, /scripts\/staging\.mjs/);
  assert.match(df, /RIPPER_TEST_PROVIDER=stream/);
  assert.match(df, /VOLUME \["\/data"\]/);
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

test('ajuda pela CLI não sobe servidor', () => {
  const r = spawnSync(process.execPath, [stagingPath, 'help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /smoke/);
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
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    RIPPER_STAGING_PORT: String(port),
    RIPPER_DATA: dataDir,
    RIPPER_TOKEN: token,
    RIPPER_TEST_PROVIDER: 'stream',
    RIPPER_STAGING_PASSWORD: 'staging-ok-8',
    RIPPER_URL: url,
    JULIA_AUTOSTART: '0',
    RIPPER_NO_PREWARM: '1',
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

    await stopServe(handle);
    handle = await startServe(env);
    await waitForHealth(url, token, 60_000);
    const again = await (await api('/api/state')).json();
    assert.ok(again.agents.some(a => a.id === 'stg-assistente'), 'agente de exemplo sumiu após o reinício');
    assert.ok(again.agents.some(a => a.id === 'stg-relator'), 'segundo agente sumiu após o reinício');
    assert.ok((again.memoriesByAgent || {})['stg-assistente'] >= 1, 'memória de exemplo sumiu após o reinício');

    const smoke = spawnSync(process.execPath, [smokePath], {
      env: smokeEnv({ url, token, password: 'staging-ok-8' }),
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
