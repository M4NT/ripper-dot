/**
 * Inventário e limpeza opt-in de dados locais em RIPPER_DATA.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearAllUsageEvents, countUsageEvents } from './usage-events.mjs';
import { clearAllJuliaDecisions, countJuliaDecisions } from './julia-events.mjs';

const KNOWN_FILES = [
  'db.json',
  'db.json.tmp',
  'db.pre-v2.backup.json',
  'usage.sqlite',
  'usage.sqlite-wal',
  'usage.sqlite-shm',
  'julia.sqlite',
  'julia.sqlite-wal',
  'julia.sqlite-shm',
  'semantic-cache.sqlite',
  'semantic-cache.sqlite-wal',
  'semantic-cache.sqlite-shm',
  'coord.sqlite',
  'coord.sqlite-wal',
  'coord.sqlite-shm',
  'idempotency.sqlite',
  'idempotency.sqlite-wal',
  'idempotency.sqlite-shm'
];

/** Resolve o diretório de dados como o store (sem carregar db.json). */
export function resolveRipperDataDir() {
  if (process.env.RIPPER_DATA) return resolve(process.env.RIPPER_DATA);
  return fileURLToPath(new URL('../data/', import.meta.url));
}

function fileEntry(dir, name) {
  const path = join(dir, name);
  if (!existsSync(path)) return null;
  const st = statSync(path);
  return {
    name,
    bytes: st.size,
    mtimeMs: st.mtimeMs
  };
}

/** Lista arquivos conhecidos + subpastas de primeiro nível (sandbox, shared). */
export function summarizeLocalData() {
  const dir = resolveRipperDataDir();
  const files = KNOWN_FILES.map(n => fileEntry(dir, n)).filter(Boolean);
  const dirs = [];
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      try {
        if (statSync(path).isDirectory()) {
          dirs.push({ name, bytes: null });
        }
      } catch { /* entrada removida entre readdir e stat */ }
    }
  }
  return {
    ripperData: dir,
    fromEnv: Boolean(process.env.RIPPER_DATA),
    files,
    directories: dirs.sort((a, b) => a.name.localeCompare(b.name)),
    usageEventCount: existsSync(join(dir, 'usage.sqlite')) ? countUsageEvents() : 0,
    juliaDecisionCount: existsSync(join(dir, 'julia.sqlite')) ? countJuliaDecisions() : 0
  };
}

export function clearUsageEventsStore() {
  clearAllUsageEvents();
  return { cleared: 'usage', remaining: countUsageEvents() };
}

export function clearJuliaEventsStore() {
  clearAllJuliaDecisions();
  return { cleared: 'julia', remaining: countJuliaDecisions() };
}
