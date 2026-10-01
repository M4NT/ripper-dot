/**
 * Política configurável de retenção (TTL) para dados locais não imutáveis.
 * Hard-delete: registros e arquivos removidos de db.json / SQLite / disco.
 * Nunca altera audit-trail.sqlite (WORM), se existir.
 */
import { existsSync, statSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { dataUrl } from './store.mjs';
import { deleteUsageEventsBefore, countUsageEvents } from './usage-events.mjs';
import { deleteArtifactStorage } from './artifacts.mjs';
import { reconcileFileAttachments } from './sandbox-lifecycle.mjs';
import { resolveRipperDataDir } from './data-retention.mjs';

export const RETENTION_DEFAULTS = {
  enabled: false,
  chatDays: 90,
  usageEventsDays: 90,
  auditDays: 180,
  artifactsDays: 90
};

const DAY_MS = 86_400_000;
const MIN_DAYS = 1;
const MAX_DAYS = 3650;

function envBool(name) {
  const v = process.env[name];
  if (v == null || v === '') return undefined;
  return /^(1|true|yes|on)$/i.test(v);
}

function envDays(name) {
  const v = process.env[name];
  if (v == null || v === '') return undefined;
  const n = +v;
  if (!Number.isFinite(n)) return undefined;
  return clampDays(n);
}

function clampDays(n) {
  return Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.floor(n)));
}

/** Overrides opcionais via RIPPER_RETENTION_* (sobre db.settings.retention). */
export function envRetentionOverrides() {
  const out = {};
  const enabled = envBool('RIPPER_RETENTION_ENABLED');
  if (enabled !== undefined) out.enabled = enabled;
  const chatDays = envDays('RIPPER_RETENTION_CHAT_DAYS');
  if (chatDays !== undefined) out.chatDays = chatDays;
  const usageEventsDays = envDays('RIPPER_RETENTION_USAGE_EVENTS_DAYS');
  if (usageEventsDays !== undefined) out.usageEventsDays = usageEventsDays;
  const auditDays = envDays('RIPPER_RETENTION_AUDIT_DAYS');
  if (auditDays !== undefined) out.auditDays = auditDays;
  const artifactsDays = envDays('RIPPER_RETENTION_ARTIFACTS_DAYS');
  if (artifactsDays !== undefined) out.artifactsDays = artifactsDays;
  return out;
}

export function resolveRetentionSettings(settings = {}) {
  const stored = { ...RETENTION_DEFAULTS, ...(settings.retention || {}) };
  return { ...stored, ...envRetentionOverrides() };
}

export function applyRetentionSettingsPatch(s, body) {
  if (!body || typeof body !== 'object') return;
  if (!s.retention) s.retention = { ...RETENTION_DEFAULTS };
  if (typeof body.enabled === 'boolean') s.retention.enabled = body.enabled;
  for (const key of ['chatDays', 'usageEventsDays', 'auditDays', 'artifactsDays']) {
    if (body[key] != null) s.retention[key] = clampDays(+body[key] || RETENTION_DEFAULTS[key]);
  }
}

export function retentionIntervalMs() {
  const raw = process.env.RIPPER_RETENTION_INTERVAL_MS;
  if (raw != null && raw !== '') {
    const n = +raw;
    if (Number.isFinite(n) && n >= 60_000) return Math.floor(n);
  }
  return 6 * 60 * 60 * 1000;
}

function cutoffTs(days, now) {
  return now - clampDays(days) * DAY_MS;
}

function chatActivityAt(chat) {
  return chat.updatedAt || chat.createdAt || 0;
}

/** Snapshot read-only do WORM audit-trail.sqlite (null se ausente). */
export function wormAuditSnapshot() {
  const path = fileURLToPath(dataUrl('audit-trail.sqlite'));
  if (!existsSync(path)) return null;
  const st = statSync(path);
  let rowCount = null;
  try {
    const db = new DatabaseSync(path, { readonly: true });
    for (const table of ['audit_events', 'audit_log', 'events', 'trail']) {
      try {
        rowCount = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
        break;
      } catch { /* tabela inexistente */ }
    }
    db.close();
  } catch { /* arquivo corrompido ou bloqueado */ }
  return { path, bytes: st.size, rowCount };
}

export function assertWormAuditUnchanged(before, after) {
  if (!before && !after) return;
  if (!before || !after) throw new Error('audit-trail.sqlite apareceu ou sumiu durante a purga.');
  if (before.bytes !== after.bytes) throw new Error('audit-trail.sqlite foi alterado (tamanho).');
  if (before.rowCount != null && after.rowCount != null && before.rowCount !== after.rowCount) {
    throw new Error('audit-trail.sqlite foi alterado (contagem de linhas).');
  }
}

async function removeFileRecord(db, fileRec) {
  if (fileRec?.path) {
    await unlink(dataUrl(fileRec.path)).catch(() => {});
  }
  db.files = db.files.filter(f => f.id !== fileRec.id);
}

async function purgeExpiredChats(db, cutoff, { isStreaming }) {
  const removed = [];
  const keep = [];
  for (const chat of db.chats || []) {
    if (chatActivityAt(chat) >= cutoff) {
      keep.push(chat);
      continue;
    }
    if (isStreaming?.(chat.id)) {
      keep.push(chat);
      continue;
    }
    removed.push(chat.id);
  }
  if (!removed.length) return { removedIds: [], filesRemoved: 0, artifactsRemoved: 0 };

  const removedSet = new Set(removed);
  db.chats = keep;

  let filesRemoved = 0;
  for (const f of [...(db.files || [])]) {
    if (!removedSet.has(f.chatId)) continue;
    await removeFileRecord(db, f);
    filesRemoved++;
  }

  let artifactsRemoved = 0;
  const arts = [];
  for (const art of db.artifacts || []) {
    if (removedSet.has(art.chatId)) {
      await deleteArtifactStorage(art);
      artifactsRemoved++;
    } else {
      arts.push(art);
    }
  }
  db.artifacts = arts;

  if (db.approvals) {
    db.approvals = db.approvals.filter(a => !removedSet.has(a.chatId));
  }

  return { removedIds: removed, filesRemoved, artifactsRemoved };
}

async function purgeExpiredArtifacts(db, cutoff) {
  const removed = [];
  const keep = [];
  for (const art of db.artifacts || []) {
    const at = art.updatedAt || art.createdAt || 0;
    if (at >= cutoff) {
      keep.push(art);
      continue;
    }
    await deleteArtifactStorage(art);
    removed.push(art.id);
  }
  db.artifacts = keep;
  return removed;
}

function purgeAuditLog(db, cutoff) {
  const before = (db.auditLog || []).length;
  db.auditLog = (db.auditLog || []).filter(e => (e.at || 0) >= cutoff);
  return before - db.auditLog.length;
}

async function purgeStaleAttachments(db, cutoff) {
  const chatIds = new Set((db.chats || []).map(c => c.id));
  let removed = 0;
  for (const f of [...(db.files || [])]) {
    const at = f.createdAt || 0;
    const orphanedChat = f.chatId && !chatIds.has(f.chatId);
    const tooOld = at > 0 && at < cutoff;
    if (!orphanedChat && !tooOld) continue;
    await removeFileRecord(db, f);
    removed++;
  }
  const orphans = await reconcileFileAttachments(db);
  return { fileRecords: removed, orphanBlobs: orphans.orphanBlobs?.length || 0 };
}

/**
 * Executa purga conforme settings.retention (+ env). Retorna relatório; `changed` indica se save() é necessário.
 */
export async function runRetentionPurge(db, { now = Date.now(), isStreaming = () => false, force = false } = {}) {
  const settings = resolveRetentionSettings(db.settings);
  if (!settings.enabled && !force) {
    return { skipped: true, reason: 'disabled', settings, changed: false };
  }

  const wormBefore = wormAuditSnapshot();
  const report = {
    skipped: false,
    at: now,
    settings,
    ripperData: resolveRipperDataDir(),
    hardDelete: true,
    chats: { removedIds: [], filesRemoved: 0, artifactsRemoved: 0 },
    usageEvents: { removed: 0, remaining: countUsageEvents() },
    auditLog: { removed: 0 },
    artifacts: { removedIds: [] },
    tempFiles: { fileRecords: 0, orphanBlobs: 0 },
    changed: false
  };

  const chatCutoff = cutoffTs(settings.chatDays, now);
  const chatResult = await purgeExpiredChats(db, chatCutoff, { isStreaming });
  report.chats = chatResult;
  if (chatResult.removedIds.length) report.changed = true;

  const usageCutoff = cutoffTs(settings.usageEventsDays, now);
  report.usageEvents.removed = deleteUsageEventsBefore(usageCutoff);
  report.usageEvents.remaining = countUsageEvents();
  if (report.usageEvents.removed) report.changed = true;

  const auditCutoff = cutoffTs(settings.auditDays, now);
  report.auditLog.removed = purgeAuditLog(db, auditCutoff);
  if (report.auditLog.removed) report.changed = true;

  const artCutoff = cutoffTs(settings.artifactsDays, now);
  report.artifacts.removedIds = await purgeExpiredArtifacts(db, artCutoff);
  if (report.artifacts.removedIds.length) report.changed = true;

  const tempCutoff = cutoffTs(settings.artifactsDays, now);
  report.tempFiles = await purgeStaleAttachments(db, tempCutoff);
  if (report.tempFiles.fileRecords || report.tempFiles.orphanBlobs) report.changed = true;

  const wormAfter = wormAuditSnapshot();
  assertWormAuditUnchanged(wormBefore, wormAfter);

  if ((report.changed || force) && db.settings?.retention) {
    db.settings.retention.lastPurgeAt = now;
    db.settings.retention.lastReport = {
      at: now,
      chats: chatResult.removedIds.length,
      usageEvents: report.usageEvents.removed,
      auditLog: report.auditLog.removed,
      artifacts: report.artifacts.removedIds.length
    };
    if (force && !report.changed) report.changed = true;
  }

  return report;
}

export function startRetentionScheduler({ db, save, isStreaming }) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const report = await runRetentionPurge(db, { isStreaming });
      if (report.changed) save();
    } catch (e) {
      console.error('[retention]', e.message);
    } finally {
      running = false;
    }
  };
  const delay = Math.min(60_000, Math.max(5_000, +(process.env.RIPPER_RETENTION_STARTUP_DELAY_MS || 30_000)));
  setTimeout(() => { tick(); }, delay).unref?.();
  setInterval(tick, retentionIntervalMs()).unref?.();
}
