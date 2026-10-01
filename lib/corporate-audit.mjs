import { isEnterpriseMode } from './enterprise.mjs';
import { appendAuditTrail } from './audit-trail.mjs';
import { redactStringsDeep } from './redact.mjs';

function sanitizeAuditEntry(entry) {
  const { category, action, agentId, chatId, at, id, detail, ...rest } = entry;
  const payload = detail != null ? detail : rest;
  return {
    category,
    action,
    agentId,
    chatId,
    at,
    id,
    detail: redactStringsDeep(payload)
  };
}

/** Grava na trilha WORM somente quando o modo enterprise está ativo. */
export function recordCorporateAudit(settings, entry) {
  if (!isEnterpriseMode(settings)) return null;
  return appendAuditTrail(sanitizeAuditEntry(entry));
}

export function auditFromApprovalRecord(rec, extra = {}) {
  return {
    category: 'approval',
    action: `approval.${rec.status}`,
    agentId: rec.agentId,
    chatId: rec.chatId,
    detail: {
      approvalId: rec.id,
      kind: rec.kind,
      command: rec.command?.slice?.(0, 500),
      status: rec.status,
      ...extra
    }
  };
}

/** Resumo de PATCH de settings (sem valores de segredo). */
export function auditSettingsPatch(before, after, patchBody) {
  const keys = Object.keys(patchBody || {}).filter(k => k !== 'plugins');
  const sensitive = new Set(['claude', 'computer', 'plugins']);
  const changed = keys.filter(k => {
    if (sensitive.has(k)) return true;
    return JSON.stringify(before[k]) !== JSON.stringify(after[k]);
  });
  const detail = { fields: changed };
  if (patchBody?.computer?.allowLocalCommands === true && !before.computer?.allowLocalCommands) {
    detail.securityNote = 'allowLocalCommands habilitado';
  }
  if (patchBody?.enterprise) detail.enterprise = { ...after.enterprise };
  if (patchBody?.approvalPolicy) detail.approvalPolicy = after.approvalPolicy;
  if (patchBody?.computer?.allowLocalCommands != null) {
    detail.allowLocalCommands = after.computer?.allowLocalCommands === true;
  }
  return {
    category: 'settings',
    action: 'settings.patch',
    detail
  };
}

export function auditAgentLifecycle(action, agent, extra = {}) {
  return {
    category: 'agent',
    action: `agent.${action}`,
    agentId: agent?.id,
    detail: {
      agentName: agent?.name,
      ...extra
    }
  };
}

export function auditDataRestore(meta = {}) {
  return {
    category: 'data',
    action: 'data.restore',
    detail: meta
  };
}
