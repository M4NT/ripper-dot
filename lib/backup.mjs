import { readFileSync, writeFileSync, existsSync, copyFileSync, renameSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withPersistMutex } from './persist-coord.mjs';
import { ripperDataDirUrl } from './diagnostics.mjs';

export const BACKUP_FORMAT = 1;

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
 * Restaura o estado principal a partir de um backup.
 * Mantém usage.sqlite / julia.sqlite no disco (histórico separado).
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
  return { restoredAt: Date.now(), schemaVersion: incoming.schemaVersion ?? parsed.schemaVersion };
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
