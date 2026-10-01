import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBackupPayload, restoreBackupPayload, parseBackupPayload, BACKUP_FORMAT } from '../lib/backup.mjs';
import { _resetStoreForTests, load, save, flush } from '../lib/store.mjs';

test('buildBackupPayload e parse', () => {
  const db = { schemaVersion: 2, settings: { name: 'a' }, agents: [{ id: '1' }], chats: [] };
  const payload = buildBackupPayload(db);
  assert.equal(payload.format, BACKUP_FORMAT);
  const parsed = parseBackupPayload(payload);
  assert.equal(parsed.db.settings.name, 'a');
});

test('restoreBackupPayload grava backup automático', () =>
  withDataDir(dir => {
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

function withDataDir(fn) {
  const prev = process.env.RIPPER_DATA;
  const dir = mkdtempSync(join(tmpdir(), 'ripper-backup-'));
  process.env.RIPPER_DATA = dir;
  try {
    return fn(dir);
  } finally {
    _resetStoreForTests();
    process.env.RIPPER_DATA = prev;
  }
}
