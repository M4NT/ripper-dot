/** Webhooks de publicação social (Slack incoming, HTTP genérico). */

import { randomUUID } from 'node:crypto';

const NAME_RE = /^[\w\s\u00C0-\u024F-]{1,60}$/i;
const URL_RE = /^https:\/\//;
export const MAX_SOCIAL_WEBHOOKS = 20;
const REDACTED = '••••';

export function redactWebhookUrl(url) {
  if (!url) return '';
  return REDACTED;
}

/** Lista exposta na API (URL nunca sai em claro). */
export function redactSocialWebhooks(webhooks) {
  if (!Array.isArray(webhooks)) return [];
  return webhooks.map(h => ({
    id: h.id,
    name: h.name,
    enabled: h.enabled !== false,
    url: h.url ? REDACTED : '',
    hasUrl: !!h.url
  }));
}

export function normalizeWebhookRecord(raw, prev) {
  const id = String(raw.id || prev?.id || randomUUID()).slice(0, 40);
  const name = String(raw.name || prev?.name || 'Webhook').trim().slice(0, 60);
  if (!NAME_RE.test(name)) throw new Error('Nome do webhook inválido.');
  let url = raw.url != null ? String(raw.url).trim() : (prev?.url || '');
  if (url === REDACTED) url = prev?.url || '';
  if (url && !URL_RE.test(url)) throw new Error('URL do webhook deve ser HTTPS.');
  const enabled = raw.enabled !== false;
  return { id, name, url, enabled };
}

/** Aplica patch de webhooks vindos da UI (preserva URLs quando mascaradas). */
export function applySocialWebhooksPatch(settings, incoming) {
  if (!incoming) return;
  if (!Array.isArray(incoming)) throw new Error('social.webhooks deve ser uma lista.');
  const prev = settings.social?.webhooks || [];
  const byId = new Map(prev.map(h => [h.id, h]));
  const next = [];
  for (const item of incoming.slice(0, MAX_SOCIAL_WEBHOOKS)) {
    const p = item?.id ? byId.get(item.id) : undefined;
    next.push(normalizeWebhookRecord(item, p));
  }
  settings.social = { ...(settings.social || {}), webhooks: next };
}

export function enabledSocialWebhooks(settings) {
  return (settings.social?.webhooks || []).filter(h => h.enabled !== false && h.url);
}

export function resolveSocialWebhook(settings, webhookId) {
  const hooks = settings.social?.webhooks || [];
  const id = String(webhookId || '').trim();
  const hit = hooks.find(h => h.id === id) || hooks.find(h => h.name.toLowerCase() === id.toLowerCase());
  if (!hit) throw new Error('Webhook não encontrado. Use list_social_webhooks ou configure em Conectores.');
  if (!hit.enabled) throw new Error(`Webhook "${hit.name}" está desativado.`);
  if (!hit.url) throw new Error(`Webhook "${hit.name}" não tem URL configurada.`);
  return hit;
}

/** Decide se publicar precisa de aprovação humana (reusa approvalPolicy global). */
export function socialPostNeedsApproval({ policy = 'risky', commandKey, allowed = [] }) {
  if (commandKey && allowed.includes(commandKey)) return null;
  if (policy === 'never') return null;
  return policy === 'always'
    ? 'publica conteúdo em webhook externo'
    : 'publica conteúdo em webhook externo (ação de saída)';
}

export function socialApprovalCommand(webhook, text) {
  const preview = String(text).replace(/\s+/g, ' ').slice(0, 200);
  return `post_social → ${webhook.name}: ${preview}`;
}

/**
 * Envia JSON { text } ao webhook. `fetch` injetável para testes.
 * @returns {{ ok: boolean, status: number, body: string }}
 */
export async function postToSocialWebhook(webhook, text, { fetch: f = globalThis.fetch } = {}) {
  const res = await f(webhook.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ text: String(text).slice(0, 8000) })
  });
  const body = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, body: body.slice(0, 500) };
}
