/**
 * Web Push (RFC 8030/8291/8292) só com node:crypto — sem dependência.
 * VAPID: ES256 P-256. Conteúdo: aes128gcm, um registro só.
 */
import { createECDH, createPrivateKey, sign, hkdfSync, createCipheriv, randomBytes } from 'node:crypto';

const b64u = b => Buffer.from(b).toString('base64url');
const unb64u = s => Buffer.from(String(s), 'base64url');

export function generateVapidKeys() {
  const e = createECDH('prime256v1');
  e.generateKeys();
  return { publicKey: b64u(e.getPublicKey()), privateKey: b64u(e.getPrivateKey()) };
}

function vapidHeader(endpoint, { publicKey, privateKey }, subject = 'mailto:ripper@localhost') {
  const pub = unb64u(publicKey);
  const key = createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
  const data = `${b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))}.${b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }))}`;
  const sig = sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64u(sig)}, k=${publicKey}`;
}

/** Cifra o payload para a inscrição (keys.p256dh / keys.auth). */
export function encryptPayload(keys, payload) {
  const ua = unb64u(keys.p256dh), auth = unb64u(keys.auth);
  const e = createECDH('prime256v1');
  e.generateKeys();
  const as = e.getPublicKey(), salt = randomBytes(16);
  const ikm = Buffer.from(hkdfSync('sha256', e.computeSecret(ua), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = as.length;
  return Buffer.concat([head, as, body]);
}

/** Payload curto: nunca o texto inteiro. */
export function buildPushPayload({ title, body = '', url = '#/inbox' }) {
  const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  return JSON.stringify({ title: cut(title, 80), body: cut(body, 120), url });
}

/** Inscrição morta: o serviço de push diz que ela não existe mais. */
export const isDeadSubscription = status => status === 404 || status === 410;

/** Envia para todas; devolve os ids a remover. Nunca lança. */
export async function sendPushAll(subs, vapid, msg, fetchImpl = fetch) {
  const payload = buildPushPayload(msg);
  const dead = [];
  await Promise.all((subs || []).map(async s => {
    try {
      const r = await fetchImpl(s.endpoint, {
        method: 'POST',
        headers: { Authorization: vapidHeader(s.endpoint, vapid), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' },
        body: encryptPayload(s.keys, payload),
        signal: AbortSignal.timeout(10000)
      });
      if (isDeadSubscription(r.status)) dead.push(s.id);
    } catch {}
  }));
  return dead;
}
