// Registro de ações externas: tudo que sai do Ripper em nome do usuário (WhatsApp, post, webhook,
// clique arriscado no navegador, link público). Sempre gravado — não depende do modo Enterprise —
// na trilha imutável (audit-trail.sqlite). Guarda só um trecho curto do conteúdo, mascarado.
import { appendAuditTrail, listAuditTrail } from './audit-trail.mjs';
import { redactStringsDeep } from './redact.mjs';

export const EXTERNAL_KINDS = {
  'whatsapp.sent': 'WhatsApp enviado',
  'whatsapp.auto_reply': 'Resposta automática no WhatsApp',
  'social.posted': 'Publicação',
  'browser.action': 'Ação no navegador',
  'link.shared': 'Link público criado',
  'billing.paid_on': 'Uso pago ativado',
  'billing.paid_off': 'Uso pago desativado'
};

const PREVIEW = 160;

/** { kind, agentId?, chatId?, target?, text?, approved?: 'user' | 'auto' | 'rule', ok?: boolean, error? } */
export function recordExternal({ kind, agentId, chatId, target, text, approved, ok = true, error }) {
  try {
    return appendAuditTrail({
      category: 'external', action: kind, agentId, chatId,
      detail: redactStringsDeep({
        target: target ? String(target).slice(0, 200) : undefined,
        preview: text ? String(text).slice(0, PREVIEW) + (String(text).length > PREVIEW ? '…' : '') : undefined,
        approved, ok, error: error ? String(error).slice(0, 300) : undefined
      })
    });
  } catch (e) {
    console.error('[external-actions] não gravou:', e.message); // o registro nunca derruba a ação
    return null;
  }
}

export function listExternal({ since = 0, limit = 200, kind, agentId } = {}) {
  return listAuditTrail({ category: 'external', since, limit: 5000, max: 5000 })
    .filter(e => (!kind || e.action === kind) && (!agentId || e.agentId === agentId))
    .slice(0, limit);
}

const csvCell = v => { const s = v == null ? '' : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function externalCsv(entries, agentName = id => id) {
  const head = ['quando', 'tipo', 'agente', 'destino', 'trecho', 'aprovado por', 'resultado'];
  const rows = entries.map(e => [
    new Date(e.at).toISOString(), EXTERNAL_KINDS[e.action] || e.action, e.agentId ? agentName(e.agentId) : '',
    e.target, e.preview, { user: 'você', auto: 'automático (liberado)', rule: 'regra' }[e.approved] || '', e.ok === false ? `falhou: ${e.error || ''}` : 'ok'
  ]);
  return '﻿' + [head, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n');
}
