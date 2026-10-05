import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes, hkdfSync, createDecipheriv, createPublicKey, verify } from 'node:crypto';
import { generateVapidKeys, encryptPayload, buildPushPayload, isDeadSubscription, sendPushAll } from '../lib/web-push.mjs';

const b64u = b => Buffer.from(b).toString('base64url');

function browser() {
  const e = createECDH('prime256v1'); e.generateKeys();
  const auth = randomBytes(16);
  return { e, auth, keys: { p256dh: b64u(e.getPublicKey()), auth: b64u(auth) } };
}
// Lado do navegador (RFC 8291) para conferir a cifra.
function decrypt({ e, auth }, buf) {
  const salt = buf.subarray(0, 16), idlen = buf[20], as = buf.subarray(21, 21 + idlen), ct = buf.subarray(21 + idlen);
  const ikm = Buffer.from(hkdfSync('sha256', e.computeSecret(as), auth, Buffer.concat([Buffer.from('WebPush: info\0'), e.getPublicKey(), as]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(-16));
  const pt = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
  assert.equal(pt.at(-1), 2);
  return pt.subarray(0, -1).toString();
}

test('cifra aes128gcm que o navegador consegue abrir', () => {
  const b = browser();
  assert.equal(decrypt(b, encryptPayload(b.keys, 'olá')), 'olá');
});

test('payload curto: corta corpo em 120', () => {
  const p = JSON.parse(buildPushPayload({ title: 'Ana precisa de você', body: 'x'.repeat(500) }));
  assert.equal(p.body.length, 120);
  assert.equal(p.url, '#/inbox');
});

test('envia com VAPID válido e devolve inscrições mortas (404/410)', async () => {
  const vapid = generateVapidKeys();
  const b = browser();
  const subs = [{ id: 'ok', endpoint: 'https://push.example/a', keys: b.keys }, { id: 'gone', endpoint: 'https://push.example/b', keys: b.keys }, { id: 'err', endpoint: 'https://push.example/c', keys: b.keys }];
  const seen = [];
  const fake = async (url, opts) => {
    if (url.endsWith('/c')) throw new Error('rede');
    seen.push(opts);
    return { status: url.endsWith('/b') ? 410 : 201 };
  };
  const dead = await sendPushAll(subs, vapid, { title: 'T', body: 'B' }, fake);
  assert.deepEqual(dead, ['gone']);
  const auth = seen[0].headers.Authorization;
  const [, jwt, k] = auth.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, vapid.publicKey);
  const [h, p, s] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).aud, 'https://push.example');
  const pub = Buffer.from(vapid.publicKey, 'base64url');
  const key = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) } });
  assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
  assert.equal(JSON.parse(decrypt(b, seen[0].body)).title, 'T');
  assert.ok(isDeadSubscription(404) && !isDeadSubscription(500));
});
