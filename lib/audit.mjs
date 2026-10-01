import { randomUUID } from 'node:crypto';

/** Histórico local de decisões (aprovações, etc.) — não substitui logs do provedor. */

const MAX = 500;

export function appendAudit(db, entry) {
  if (!db.auditLog) db.auditLog = [];
  const row = { id: entry.id || randomUUID(), at: entry.at || Date.now(), ...entry };
  db.auditLog.push(row);
  if (db.auditLog.length > MAX) db.auditLog.splice(0, db.auditLog.length - MAX);
  return row;
}

export function auditFromApproval(rec, extra = {}) {
  return {
    type: 'approval',
    approvalId: rec.id,
    agentId: rec.agentId,
    chatId: rec.chatId,
    kind: rec.kind,
    command: rec.command?.slice?.(0, 500),
    status: rec.status,
    ...extra
  };
}

export function listAudit(db, { limit = 50 } = {}) {
  const n = Math.max(1, Math.min(200, limit));
  return (db.auditLog || []).slice(-n).reverse();
}
