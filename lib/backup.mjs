import {
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
  renameSync,
  readdirSync,
  mkdirSync,
  statSync,
  rmSync,
} from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, basename, relative, isAbsolute, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { withPersistMutex } from './persist-coord.mjs';
import { ripperDataDirUrl } from './diagnostics.mjs';
import { normalizeBackupSettings } from './backup-settings.mjs';

export const BACKUP_FORMAT = 1;
export const SNAPSHOT_FORMAT = 1;
const SNAPSHOT_PREFIX = 'ripper-snapshot-';
const SNAPSHOT_EXT = '.tar.gz';

/** Arquivos/pastas efêmeros ou redundantes — não entram no snapshot completo. */
export const SNAPSHOT_SKIP_NAMES = new Set([
  'db.json.tmp',
  'backups'
]);

export function snapshotSkipEntry(name) {
  if (SNAPSHOT_SKIP_NAMES.has(name)) return true;
  if (name.endsWith('.sqlite-wal') || name.endsWith('.sqlite-shm')) return true;
  if (name === 'ripper-snapshot-manifest.json') return true;
  return false;
}

export { normalizeBackupSettings } from './backup-settings.mjs';

function dataDirPath() {
  return fileURLToPath(ripperDataDirUrl());
}

export function backupsDirPath() {
  return join(dataDirPath(), 'backups');
}

function dbFileUrl() {
  return new URL('db.json', ripperDataDirUrl());
}

function readDbJson() {
  const f = dbFileUrl();
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}

function writeDbJson(snapshot) {
  const dir = ripperDataDirUrl();
  const tmp = new URL('db.json.tmp', dir);
  writeFileSync(tmp, JSON.stringify(snapshot));
  renameSync(tmp, dbFileUrl());
}

function tarAvailable() {
  const r = spawnSync('tar', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

function runTar(args, label) {
  const r = spawnSync('tar', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || '').trim() || `tar falhou (${label})`;
    throw new Error(msg);
  }
}

function snapshotFileName(id) {
  return `${id}${SNAPSHOT_EXT}`;
}

function resolveSnapshotArchive({ id, path: userPath }) {
  const backups = backupsDirPath();
  if (id) {
    const safe = String(id).replace(/[^\w.-]/g, '');
    if (!safe.startsWith(SNAPSHOT_PREFIX)) throw new Error('ID de snapshot inválido.');
    const file = join(backups, snapshotFileName(safe));
    if (!existsSync(file)) throw new Error('Snapshot não encontrado.');
    return { id: safe, archivePath: file };
  }
  if (!userPath) throw new Error('Informe id ou path do snapshot.');
  const resolved = isAbsolute(userPath) ? resolve(userPath) : resolve(backups, userPath);
  const rel = relative(backups, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path deve ficar em RIPPER_DATA/backups.');
  if (!existsSync(resolved) || !resolved.endsWith(SNAPSHOT_EXT)) throw new Error('Arquivo de snapshot inválido.');
  return { id: basename(resolved, SNAPSHOT_EXT), archivePath: resolved };
}

async function emitCorporateAudit(action, detail = {}) {
  try {
    const mod = await import('./corporate-audit.mjs').catch(() => null);
    if (mod?.recordCorporateAudit) {
      await mod.recordCorporateAudit(action, { at: Date.now(), ...detail });
    }
  } catch {
    /* módulo corporativo opcional */
  }
}

/** Exporta db.json + metadados (não inclui binários em sandbox/). */
export function buildBackupPayload(db) {
  return {
    format: BACKUP_FORMAT,
    exportedAt: Date.now(),
    schemaVersion: db?.schemaVersion ?? 2,
    db: structuredClone(db)
  };
}

export function parseBackupPayload(body) {
  if (!body || typeof body !== 'object') throw new Error('Backup inválido.');
  if (body.format !== BACKUP_FORMAT) throw new Error('Formato de backup não reconhecido.');
  if (!body.db || typeof body.db !== 'object') throw new Error('Backup sem campo db.');
  if (!body.db.settings || !Array.isArray(body.db.agents)) throw new Error('Backup incompleto (settings ou agents).');
  return body;
}

/**
 * Restaura o estado principal a partir de um backup JSON.
 * Mantém usage.sqlite / julia.sqlite no disco, salvo um snapshot completo posterior.
 */
export function restoreBackupPayload(db, payload, { applyToMemory = true } = {}) {
  const parsed = parseBackupPayload(payload);
  const incoming = structuredClone(parsed.db);
  if (applyToMemory) {
    for (const k of Object.keys(db)) {
      if (k in incoming) db[k] = incoming[k];
    }
  }
  withPersistMutex(() => {
    const prev = readDbJson();
    if (prev) {
      const stamp = Date.now();
      copyFileSync(dbFileUrl(), new URL(`db.pre-restore.${stamp}.backup.json`, ripperDataDirUrl()));
    }
    writeDbJson(incoming);
  });
  return { restoredAt: Date.now(), schemaVersion: incoming.schemaVersion ?? parsed.schemaVersion, kind: 'json' };
}

/**
 * Cria snapshot .tar.gz de RIPPER_DATA (exceto caches efêmeros e a pasta backups/).
 * Destino: RIPPER_DATA/backups/.
 */
export function createDataSnapshot({ reason = 'manual' } = {}) {
  if (!tarAvailable()) throw new Error('Comando tar não disponível neste sistema.');
  const dataDir = dataDirPath();
  const backups = backupsDirPath();
  mkdirSync(backups, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const id = `${SNAPSHOT_PREFIX}${stamp}-${randomBytes(4).toString('hex')}`;
  const archivePath = join(backups, snapshotFileName(id));
  const manifestPath = join(dataDir, 'ripper-snapshot-manifest.json');
  const manifest = {
    format: SNAPSHOT_FORMAT,
    id,
    createdAt: Date.now(),
    reason,
    ripperData: basename(dataDir)
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  try {
    const excludes = ['backups', 'db.json.tmp', 'ripper-snapshot-manifest.json', '*.sqlite-wal', '*.sqlite-shm'];
    const args = ['-czf', archivePath, ...excludes.flatMap(x => ['--exclude', x]), '-C', dataDir, '.'];
    runTar(args, 'create');
  } finally {
    try { rmSync(manifestPath, { force: true }); } catch { /* ignore */ }
  }
  const st = statSync(archivePath);
  void emitCorporateAudit('backup.create', { id, bytes: st.size, reason });
  return { id, fileName: snapshotFileName(id), bytes: st.size, createdAt: st.mtimeMs, path: `backups/${snapshotFileName(id)}` };
}

export function listDataSnapshots() {
  const backups = backupsDirPath();
  if (!existsSync(backups)) return [];
  const out = [];
  for (const name of readdirSync(backups)) {
    if (!name.startsWith(SNAPSHOT_PREFIX) || !name.endsWith(SNAPSHOT_EXT)) continue;
    const archivePath = join(backups, name);
    try {
      const st = statSync(archivePath);
      out.push({
        id: name.slice(0, -SNAPSHOT_EXT.length),
        fileName: name,
        bytes: st.size,
        createdAt: st.mtimeMs
      });
    } catch { /* arquivo removido */ }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

function copyTreeIntoDataDir(srcRoot, destRoot) {
  for (const name of readdirSync(srcRoot)) {
    if (snapshotSkipEntry(name)) continue;
    const src = join(srcRoot, name);
    const dest = join(destRoot, name);
    const st = statSync(src);
    if (st.isDirectory()) {
      mkdirSync(dest, { recursive: true });
      copyTreeIntoDataDir(src, dest);
    } else {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }
  }
}

/**
 * Restaura snapshot completo. **Sobrescreve** arquivos vivos em RIPPER_DATA.
 * Risco: se existir trilha de auditoria WORM/imutável no futuro, restaurar outro
 * banco por cima pode violar políticas de imutabilidade — pare o Ripper e revise antes.
 */
export async function restoreDataSnapshot(db, { confirm, id, path: archivePath } = {}) {
  if (!confirm) throw new Error('Envie confirm: true para substituir os dados locais.');
  if (!tarAvailable()) throw new Error('Comando tar não disponível neste sistema.');
  const { id: snapId, archivePath: resolved } = resolveSnapshotArchive({ id, path: archivePath });
  const dataDir = dataDirPath();
  const tmp = mkdtempSync(join(tmpdir(), 'ripper-restore-'));
  try {
    runTar(['-xzf', resolved, '-C', tmp], 'extract');
    withPersistMutex(() => {
      const prev = readDbJson();
      if (prev) {
        const stamp = Date.now();
        copyFileSync(dbFileUrl(), new URL(`db.pre-restore.${stamp}.backup.json`, ripperDataDirUrl()));
      }
      copyTreeIntoDataDir(tmp, dataDir);
    });
    const { reopenSqliteStores, reloadFromDisk } = await import('./store.mjs');
    reopenSqliteStores();
    reloadFromDisk(db);
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  void emitCorporateAudit('backup.restore', { id: snapId });
  return {
    restoredAt: Date.now(),
    id: snapId,
    kind: 'snapshot',
    warning: 'Restore sobrescreveu os dados vivos em RIPPER_DATA. Reinicie outros processos Ripper que compartilhem o mesmo diretório.'
  };
}

export function pruneOldSnapshots(keepCount) {
  const keep = Math.max(1, Math.min(50, +keepCount || 5));
  const list = listDataSnapshots();
  const removed = [];
  for (const row of list.slice(keep)) {
    try {
      rmSync(join(backupsDirPath(), row.fileName), { force: true });
      removed.push(row.id);
    } catch { /* ignore */ }
  }
  return removed;
}

let _lastScheduledRun = 0;

/** Executa backup agendado quando settings.backup.enabled e intervalo decorrido. */
export function maybeRunScheduledBackup(db) {
  const cfg = normalizeBackupSettings(db?.settings?.backup);
  if (!cfg.enabled) return null;
  const now = Date.now();
  const intervalMs = cfg.intervalHours * 3600_000;
  const snapshots = listDataSnapshots();
  const lastAt = snapshots[0]?.createdAt || 0;
  if (now - lastAt < intervalMs && now - _lastScheduledRun < intervalMs) return null;
  _lastScheduledRun = now;
  try {
    const created = createDataSnapshot({ reason: 'scheduled' });
    const removed = pruneOldSnapshots(cfg.keepCount);
    return { created, removed };
  } catch (e) {
    console.error('[backup] agendado falhou:', e.message);
    return { error: e.message };
  }
}

/** Lista arquivos de migração/backup automáticos presentes na pasta de dados. */
export function listAutoBackups() {
  const dir = ripperDataDirUrl();
  const names = [];
  try {
    for (const n of readdirSync(fileURLToPath(dir))) {
      if (n === 'db.pre-v2.backup.json' || /^db\.pre-restore\.\d+\.backup\.json$/.test(n)) names.push(n);
    }
  } catch {
    /* ignore */
  }
  return names.sort();
}
