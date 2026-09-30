import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const worker = fileURLToPath(new URL('./helpers/mp-worker.mjs', import.meta.url));

function runWorker(env, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`timeout worker ${env.RIPPER_MP_CMD}: ${err}`));
    }, timeoutMs);
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`worker ${env.RIPPER_MP_CMD} exit ${code}: ${err || out}`));
    });
  });
}

function runWorkersParallel(envList) {
  return Promise.all(envList.map(env => runWorker(env)));
}

test('dois processos podem load() na mesma pasta sem exit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-mp-load-'));
  await runWorkersParallel([
    { RIPPER_DATA: dir, RIPPER_MP_CMD: 'load' },
    { RIPPER_DATA: dir, RIPPER_MP_CMD: 'load' }
  ]);
  assert.ok(existsSync(join(dir, 'coord.sqlite')));
  assert.ok(existsSync(join(dir, 'db.json')));
});

test('appends simultâneos de usage events não corrompem SQLite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-mp-usage-'));
  const n = 40;
  const [a, b] = await runWorkersParallel([
    { RIPPER_DATA: dir, RIPPER_MP_CMD: 'usage-burst', RIPPER_MP_N: String(n) },
    { RIPPER_DATA: dir, RIPPER_MP_CMD: 'usage-burst', RIPPER_MP_N: String(n) }
  ]);
  assert.equal(+a, n);
  assert.equal(+b, n);
  const prev = process.env.RIPPER_DATA;
  process.env.RIPPER_DATA = dir;
  const { _resetStoreForTests, load } = await import('../lib/store.mjs');
  const { countUsageEvents, _resetUsageEventsForTests } = await import('../lib/usage-events.mjs');
  _resetStoreForTests();
  _resetUsageEventsForTests();
  load();
  assert.equal(countUsageEvents(), n * 2);
  process.env.RIPPER_DATA = prev;
});

test('flush simultâneo preserva db.json válido e mescla agentes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-mp-store-'));
  writeFileSync(join(dir, 'db.json'), JSON.stringify({
    schemaVersion: 2,
    settings: { name: '' },
    agents: [{ id: 'seed', name: 'Seed', tools: ['web'], avatar: { type: 'circle' }, createdAt: 1 }],
    chats: [],
    files: [],
    memories: [],
    routines: [],
    projects: [],
    artifacts: [],
    messages: [],
    approvals: [],
    skills: []
  }));
  await runWorkersParallel([
    { RIPPER_DATA: dir, RIPPER_MP_CMD: 'agent-patch', RIPPER_MP_SUFFIX: 'P1' },
    { RIPPER_DATA: dir, RIPPER_MP_CMD: 'agent-patch', RIPPER_MP_SUFFIX: 'P2' }
  ]);
  const raw = JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8'));
  assert.equal(raw.schemaVersion, 2);
  assert.ok(Array.isArray(raw.agents));
  assert.ok(raw.agents.some(a => a.name === 'Agente-P1' || a.name === 'Agente-P2'));
});

test('lock obsoleto (.lock legado) não impede segundo processo', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-mp-stale-'));
  writeFileSync(join(dir, '.lock'), '999999999');
  await runWorkersParallel([
    { RIPPER_DATA: dir, RIPPER_MP_CMD: 'load' },
    { RIPPER_DATA: dir, RIPPER_MP_CMD: 'load' }
  ]);
});
