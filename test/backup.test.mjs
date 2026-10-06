import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildBackupPayload,
  restoreBackupPayload,
  parseBackupPayload,
  BACKUP_FORMAT,
  createDataSnapshot,
  listDataSnapshots,
  restoreDataSnapshot,
  pruneOldSnapshots,
  verifySnapshot,
  unreadableTarEntries
} from '../lib/backup.mjs';
import { _resetStoreForTests, load, save, flush } from '../lib/store.mjs';

function tarOk() {
  return spawnSync('tar', ['--version'], { encoding: 'utf8' }).status === 0;
}

test('buildBackupPayload e parse', () => {
  const db = { schemaVersion: 2, settings: { name: 'a' }, agents: [{ id: '1' }], chats: [] };
  const payload = buildBackupPayload(db);
  assert.equal(payload.format, BACKUP_FORMAT);
  const parsed = parseBackupPayload(payload);
  assert.equal(parsed.db.settings.name, 'a');
});

test('restoreBackupPayload grava backup automático', async () =>
  withDataDir(async dir => {
    _resetStoreForTests();
    const db = load();
    db.settings.name = 'antes';
    save();
    flush();
    const payload = buildBackupPayload({ ...db, settings: { ...db.settings, name: 'depois' } });
    restoreBackupPayload(db, payload);
    assert.equal(db.settings.name, 'depois');
    const files = readdirSync(dir);
    assert.ok(files.some(f => f.startsWith('db.pre-restore.')));
    const onDisk = JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8'));
    assert.equal(onDisk.settings.name, 'depois');
  }));

test('snapshot create/list/restore roundtrip', { skip: !tarOk() }, async () =>
  withDataDir(async dir => {
    _resetStoreForTests();
    const db = load();
    db.settings.name = 'antes-snapshot';
    writeFileSync(join(dir, 'usage.sqlite'), 'fake-usage');
    save();
    flush();
    const created = await createDataSnapshot({ reason: 'test' });
    assert.ok(created.id.startsWith('ripper-snapshot-'));
    const list = listDataSnapshots();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, created.id);
    db.settings.name = 'mutado';
    save();
    flush();
    const out = await restoreDataSnapshot(db, { confirm: true, id: created.id });
    assert.equal(out.kind, 'snapshot');
    assert.equal(db.settings.name, 'antes-snapshot');
    assert.ok(existsSync(join(dir, 'usage.sqlite')));
    pruneOldSnapshots(1);
    assert.equal(listDataSnapshots().length, 1);
  }));

test('teste de restauração: snapshot extraído numa pasta temporária tem o db.json certo', { skip: !tarOk() }, async () =>
  withDataDir(async dir => {
    _resetStoreForTests();
    const db = load();
    db.settings.name = 'conferir-restauracao';
    save();
    flush();
    mkdirSync(join(dir, 'sandbox', 'a'), { recursive: true });
    writeFileSync(join(dir, 'sandbox', 'a', 'nota.txt'), 'conteudo');
    const created = await createDataSnapshot({ reason: 'test' });
    assert.equal(await verifySnapshot(created.fileName), true);
    const out = mkdtempSync(join(tmpdir(), 'ripper-restore-check-'));
    const tar = process.platform === 'win32' && process.env.SystemRoot ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
    assert.equal(spawnSync(tar, ['-xzf', join(dir, 'backups', created.fileName), '-C', out]).status, 0);
    assert.equal(JSON.parse(readFileSync(join(out, 'db.json'), 'utf8')).settings.name, 'conferir-restauracao');
    assert.equal(readFileSync(join(out, 'sandbox', 'a', 'nota.txt'), 'utf8'), 'conteudo');
    assert.ok(!existsSync(join(out, 'backups')));
    writeFileSync(join(dir, 'backups', 'ripper-snapshot-ruim.tar.gz'), 'nao e tar');
    await assert.rejects(verifySnapshot('ripper-snapshot-ruim.tar.gz'), /teste de restauração/);
  }));

test('item ilegível (link do Docker) não derruba o backup; outros erros do tar sim', () => {
  const winErr = 'tar.exe: ./sandbox/x/smoke/node_modules: Cannot stat: Invalid argument\ntar.exe: Error exit delayed from previous errors.\n';
  assert.deepEqual(unreadableTarEntries(winErr), ['./sandbox/x/smoke/node_modules']);
  assert.equal(unreadableTarEntries('tar: Failed to open backups/x.tar.gz: No space left on device'), null);
  assert.equal(unreadableTarEntries(''), null);
});

async function withDataDir(fn) {
  const prev = process.env.RIPPER_DATA;
  const dir = mkdtempSync(join(tmpdir(), 'ripper-backup-'));
  mkdirSync(join(dir, 'backups'), { recursive: true });
  process.env.RIPPER_DATA = dir;
  try {
    return await fn(dir);
  } finally {
    _resetStoreForTests();
    process.env.RIPPER_DATA = prev;
  }
}
