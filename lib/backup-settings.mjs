export function normalizeBackupSettings(raw = {}) {
  const enabled = raw.enabled === true;
  const intervalHours = Math.max(1, Math.min(168, +raw.intervalHours || 24));
  const keepCount = Math.max(1, Math.min(50, +raw.keepCount || 5));
  return { enabled, intervalHours, keepCount };
}
