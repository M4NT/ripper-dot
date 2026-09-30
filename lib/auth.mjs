import { timingSafeEqual } from 'node:crypto';

/** Valida Bearer ou cookie ripper_token contra o segredo configurado (vazio = sem auth). */
export function authed(req, token) {
  if (!token) return true;
  const got = (req.headers.authorization || '').replace(/^Bearer /, '') || /(?:^|;\s*)ripper_token=([^;]+)/.exec(req.headers.cookie || '')?.[1] || '';
  const a = Buffer.from(decodeURIComponent(got)), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
