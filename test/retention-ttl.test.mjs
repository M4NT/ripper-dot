import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

async function withDataDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-ret-ttl-'));
  const prev = process.env.RIPPER_DATA;
  process.env.RIPPER_DATA = dir;
  const { _resetStoreForTests, load } = await import('../lib/store.mjs');
  try {
    await fn(dir, load);
  } finally {
    _resetStoreForTests();
    process.env.RIPPER_DATA = prev;
  }
}

test('resolveRetentionSettings — defaults e env', async () => {
  const prevE = process.env.RIPPER_RETENTION_CHAT_DAYS;
  delete process.env.RIPPER_RETENTION_CHAT_DAYS;
  const { resolveRetentionSettings, RETENTION_DEFAULTS } = await import('../lib/retention-ttl.mjs');
  const r = resolveRetentionSettings({});
  assert.equal(r.enabled, RETENTION_DEFAULTS.enabled);
  assert.equal(r.chatDays, 90);
  process.env.RIPPER_RETENTION_CHAT_DAYS = '30';
  assert.equal(resolveRetentionSettings({ retention: { chatDays: 90 } }).chatDays, 30);
  if (prevE == null) delete process.env.RIPPER_RETENTION_CHAT_DAYS;
  else process.env.RIPPER_RETENTION_CHAT_DAYS = prevE;
});

test('deleteUsageEventsBefore remove só eventos antigos', async () => {
  await withDataDir(async () => {
    const { appendUsageEvent, countUsageEvents } = await import('../lib/usage-events.mjs');
    const { deleteUsageEventsBefore } = await import('../lib/usage-events.mjs');
    const now = Date.now();
    appendUsageEvent({ at: now - 200 * 86400000, model: 'old', charsIn: 1, charsOut: 0 });
    appendUsageEvent({ at: now - 1 * 86400000, model: 'new', charsIn: 1, charsOut: 0 });
    assert.equal(countUsageEvents(), 2);
    const removed = deleteUsageEventsBefore(now - 100 * 86400000);
    assert.equal(removed, 1);
    assert.equal(countUsageEvents(), 1);
  });
});

test('runRetentionPurge apaga chat, audit e usage expirados (hard-delete)', async () => {
  await withDataDir(async (dir, load) => {
    const db = load();
    const now = Date.now();
    db.settings.retention = { enabled: true, chatDays: 30, usageEventsDays: 30, auditDays: 30, artifactsDays: 30 };
    db.chats.push({
      id: 'c-old',
      agentId: db.agents[0].id,
      title: 'Antiga',
      messages: [{ id: 'm1', role: 'user', content: 'oi', at: now - 40 * 86400000 }],
      createdAt: now - 40 * 86400000,
      updatedAt: now - 40 * 86400000
    });
    db.chats.push({
      id: 'c-new',
      agentId: db.agents[0].id,
      title: 'Recente',
      messages: [],
      createdAt: now,
      updatedAt: now
    });
    db.auditLog = [
      { id: 'a1', at: now - 40 * 86400000, type: 'approval' },
      { id: 'a2', at: now, type: 'approval' }
    ];
    const { appendUsageEvent } = await import('../lib/usage-events.mjs');
    appendUsageEvent({ at: now - 40 * 86400000, model: 'x', charsIn: 0, charsOut: 0 });

    const { runRetentionPurge } = await import('../lib/retention-ttl.mjs');
    const report = await runRetentionPurge(db, { now, force: true });
    assert.equal(report.chats.removedIds.length, 1);
    assert.ok(report.chats.removedIds.includes('c-old'));
    assert.equal(db.chats.length, 1);
    assert.equal(db.auditLog.length, 1);
    assert.ok(report.usageEvents.removed >= 1);
  });
});

test('runRetentionPurge não altera audit-trail.sqlite (WORM)', async () => {
  await withDataDir(async (dir, load) => {
    const wormPath = join(dir, 'audit-trail.sqlite');
    const worm = new DatabaseSync(wormPath);
    worm.exec('CREATE TABLE audit_events (id INTEGER PRIMARY KEY, at INTEGER, body TEXT)');
    worm.prepare('INSERT INTO audit_events (at, body) VALUES (?, ?)').run(Date.now() - 999 * 86400000, 'immutable');
    worm.prepare('INSERT INTO audit_events (at, body) VALUES (?, ?)').run(Date.now(), 'keep');
    worm.close();

    const db = load();
    db.settings.retention = { enabled: true, chatDays: 1, usageEventsDays: 1, auditDays: 1, artifactsDays: 1 };
    db.auditLog = [{ id: 'x', at: Date.now() - 999 * 86400000, type: 'approval' }];

    const { runRetentionPurge, wormAuditSnapshot } = await import('../lib/retention-ttl.mjs');
    const before = wormAuditSnapshot();
    assert.equal(before.rowCount, 2);
    await runRetentionPurge(db, { now: Date.now(), force: true });
    const after = wormAuditSnapshot();
    assert.equal(after.bytes, before.bytes);
    assert.equal(after.rowCount, 2);

    const read = new DatabaseSync(wormPath, { readonly: true });
    assert.equal(read.prepare('SELECT COUNT(*) AS c FROM audit_events').get().c, 2);
    read.close();
  });
});

test('runRetentionPurge skipped quando disabled sem force', async () => {
  await withDataDir(async (_, load) => {
    const db = load();
    db.settings.retention = { enabled: false, chatDays: 1, usageEventsDays: 1, auditDays: 1, artifactsDays: 1 };
    const { runRetentionPurge } = await import('../lib/retention-ttl.mjs');
    const r = await runRetentionPurge(db, {});
    assert.equal(r.skipped, true);
    assert.equal(r.changed, false);
  });
});

test('applyRetentionSettingsPatch via settings-patch', async () => {
  const { applySettingsPatch } = await import('../lib/settings-patch.mjs');
  const s = { defaultModel: 'auto', claude: {}, computer: {}, retention: { enabled: false, chatDays: 90, usageEventsDays: 90, auditDays: 180, artifactsDays: 90 } };
  applySettingsPatch(s, { retention: { enabled: true, chatDays: 45 } });
  assert.equal(s.retention.enabled, true);
  assert.equal(s.retention.chatDays, 45);
});
