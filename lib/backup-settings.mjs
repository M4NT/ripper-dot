// Backup automático: ligado por padrão (diário, 7 cópias). choseAt marca que o usuário decidiu (aí respeitamos o "desligado").
export function normalizeBackupSettings(raw = {}) {
  const choseAt = raw.choseAt ?? null;
  const enabled = choseAt ? raw.enabled === true : true;
  const intervalHours = Math.max(1, Math.min(168, +raw.intervalHours || 24));
  const keepCount = Math.max(1, Math.min(50, +raw.keepCount || 7));
  // Cópia extra fora da pasta de dados (ex.: pasta do OneDrive/Google Drive): disco que morre não leva o backup junto.
  const copyTo = typeof raw.copyTo === 'string' ? raw.copyTo.trim().slice(0, 400) : '';
  return { enabled, intervalHours, keepCount, copyTo, choseAt };
}
