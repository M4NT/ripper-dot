import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export const newHookToken = () => randomBytes(24).toString('hex');

/** Assinatura no padrão do GitHub (X-Hub-Signature-256: sha256=<hmac>). Sem segredo configurado, aceita. */
export function verifySignature(secret, rawBody, header) {
  if (!secret) return true;
  if (!header?.startsWith('sha256=')) return false;
  const want = Buffer.from('sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex'));
  const got = Buffer.from(header);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** De onde veio e que tipo de evento é (GitHub, GitLab, genérico). */
export function eventMeta(headers) {
  if (headers['x-github-event']) return { source: 'GitHub', type: headers['x-github-event'] };
  if (headers['x-gitlab-event']) return { source: 'GitLab', type: headers['x-gitlab-event'] };
  return { source: 'webhook', type: headers['x-event-type'] || null };
}
