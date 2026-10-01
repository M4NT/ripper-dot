import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function withDataDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-store-'));
  const prev = process.env.RIPPER_DATA;
  process.env.RIPPER_DATA = dir;
  return import('../lib/store.mjs').then(store => {
    store._resetStoreForTests();
    return fn(store, dir).finally(() => {
      store._resetStoreForTests();
      process.env.RIPPER_DATA = prev;
    });
  });
}

test('load cria schema v2 e agente padrão quando não há db.json', () =>
  withDataDir(async ({ load, flush }, dir) => {
    const db = load();
    assert.equal(db.schemaVersion, 2);
    assert.ok(db.settings.computer);
    assert.equal(db.agents.length, 1);
    assert.equal(db.agents[0].name, 'Assistente');
    flush();
    const raw = JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8'));
    assert.equal(raw.schemaVersion, 2);
    assert.ok(existsSync(join(dir, 'coord.sqlite')));
  }));

test('flush persiste alterações com gravação atômica (tmp + rename)', () =>
  withDataDir(async ({ load, flush, save }, dir) => {
    const db = load();
    db.settings.name = 'Teste';
    save();
    flush();
    const onDisk = JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8'));
    assert.equal(onDisk.settings.name, 'Teste');
    assert.equal(existsSync(join(dir, 'db.json.tmp')), false);
  }));

test('flush serializado sob save() rápido não deixa db.json inválido', () =>
  withDataDir(async ({ load, flush, save }, dir) => {
    const db = load();
    for (let i = 0; i < 40; i++) {
      db.settings.name = `n${i}`;
      save();
      flush();
    }
    const parsed = JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8'));
    assert.equal(parsed.settings.name, 'n39');
    assert.equal(parsed.schemaVersion, 2);
    assert.equal(existsSync(join(dir, 'db.json.tmp')), false);
  }));

test('migração v1 faz backup e normaliza schemaVersion', () =>
  withDataDir(async ({ load, _resetStoreForTests }, dir) => {
    writeFileSync(join(dir, 'db.json'), JSON.stringify({
      schemaVersion: 1,
      settings: { name: 'Legado' },
      agents: [{ id: 'a1', name: 'Mimosa', cow: true, tools: ['web'], avatar: { type: 'circle' } }],
      chats: [],
      files: [],
      memories: [],
      routines: [{ id: 'r1', name: 'x', prompt: 'y', lastRun: 1, lastStatus: 'running' }],
      projects: [],
      artifacts: [],
      messages: [],
      approvals: [],
      skills: []
    }));
    _resetStoreForTests();
    const db = load();
    assert.equal(db.schemaVersion, 2);
    assert.equal(db.agents[0].name, 'Assistente');
    assert.equal(db.routines[0].lastStatus, 'failed');
    assert.ok(existsSync(join(dir, 'db.pre-v2.backup.json')));
  }));

test('db.json inválido lança ao carregar', () =>
  withDataDir(async ({ load, _resetStoreForTests }, dir) => {
    writeFileSync(join(dir, 'db.json'), '{ not json');
    _resetStoreForTests();
    assert.throws(() => load(), /JSON|Unexpected token/);
  }));

test('vários load no mesmo processo compartilham o cache em memória', () =>
  withDataDir(async ({ load }, dir) => {
    const a = load();
    a.settings.name = 'Um';
    const b = load();
    assert.equal(b.settings.name, 'Um');
    assert.ok(existsSync(join(dir, 'coord.sqlite')));
  }));

test('checkStoreReady reflete acesso à pasta de dados', () =>
  withDataDir(async ({ load, checkStoreReady }, dir) => {
    load();
    assert.deepEqual(checkStoreReady(), { ok: true });
    chmodSync(dir, 0);
    try {
      const bad = checkStoreReady();
      assert.equal(bad.ok, false);
      assert.ok(bad.reason);
    } finally {
      chmodSync(dir, 0o700);
    }
  }));

test('patchAgent filtra campos e ferramentas desconhecidas', async () => {
  const { newAgent, patchAgent } = await import('../lib/store.mjs');
  const a = newAgent({ tools: ['web', 'bogus'] });
  assert.deepEqual(a.tools, ['web']);
  patchAgent(a, { name: 'X'.repeat(300), effort: 'bogus', tools: ['memory', 'nope'] });
  assert.equal(a.name.length, 200);
  assert.equal(a.effort, 'auto');
  assert.deepEqual(a.tools, ['memory']);
});
