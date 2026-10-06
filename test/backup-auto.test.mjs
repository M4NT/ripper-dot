import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeBackupSettings } from '../lib/backup-settings.mjs';
import { buildInbox } from '../lib/inbox-feed.mjs';

test('backup automático vem ligado; só desliga se o usuário escolheu', () => {
  assert.equal(normalizeBackupSettings({}).enabled, true);
  assert.equal(normalizeBackupSettings({ enabled: false }).enabled, true, 'false antigo (padrão gravado) não conta como escolha');
  assert.equal(normalizeBackupSettings({ enabled: false, choseAt: 1 }).enabled, false);
});

test('backup agendado grava e copia para a pasta extra, mantendo só as mais novas', async () => {
  const prev = process.env.RIPPER_DATA;
  const data = mkdtempSync(join(tmpdir(), 'ripper-bk-')), extra = mkdtempSync(join(tmpdir(), 'ripper-bk-extra-'));
  process.env.RIPPER_DATA = data;
  (await import('../lib/store.mjs'))._resetStoreForTests();
  writeFileSync(join(data, 'db.json'), '{"settings":{},"agents":[]}');
  try {
    const { maybeRunScheduledBackup, copySnapshotTo } = await import('../lib/backup.mjs');
    const out = await maybeRunScheduledBackup({ settings: { backup: { copyTo: extra, keepCount: 2 } } });
    assert.ok(out.created, out.error);
    assert.ok(out.copiedTo?.startsWith(extra));
    copySnapshotTo(out.created, extra, 2); // de novo: continua 1 arquivo (mesmo nome)
    assert.equal(readdirSync(extra).length, 1);
    assert.throws(() => copySnapshotTo(out.created, join(extra, 'nao-existe')), /não existe/);
  } finally { process.env.RIPPER_DATA = prev; }
});

test('aviso do sistema aparece na Caixa até ser resolvido', () => {
  const db = { agents: [], systemAlerts: [{ id: 'x', key: 'backup', at: 1, title: 'O backup automático falhou', body: 'disco cheio' }, { id: 'y', key: 'b', at: 2, title: 't', done: true }] };
  const items = buildInbox(db).items;
  assert.deepEqual(items.map(i => [i.kind, i.id]), [['system', 'x']]);
});

test('snapshot inclui o que ainda estava no WAL do SQLite (conexão aberta, como o servidor)', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { spawnSync } = await import('node:child_process');
  const prev = process.env.RIPPER_DATA;
  const data = mkdtempSync(join(tmpdir(), 'ripper-wal-'));
  process.env.RIPPER_DATA = data;
  (await import('../lib/store.mjs'))._resetStoreForTests(); // a pasta de dados fica em cache entre testes
  writeFileSync(join(data, 'db.json'), '{}');
  const live = new DatabaseSync(join(data, 'x.sqlite'));
  live.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('recente');");
  try {
    const { createDataSnapshot, backupsDirPath } = await import('../lib/backup.mjs');
    const snap = await createDataSnapshot({ reason: 'test' });
    const out = mkdtempSync(join(tmpdir(), 'ripper-wal-out-'));
    // mesmo tar do backup: no Windows o tar do Git trata "C:" como host remoto
    const tar = process.platform === 'win32' && process.env.SystemRoot ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
    spawnSync(tar, ['-xzf', join(backupsDirPath(), snap.fileName), '-C', out]);
    const restored = new DatabaseSync(join(out, 'x.sqlite'));
    assert.equal(restored.prepare('SELECT v FROM t').get()?.v, 'recente');
    restored.close();
  } finally { live.close(); process.env.RIPPER_DATA = prev; }
});
