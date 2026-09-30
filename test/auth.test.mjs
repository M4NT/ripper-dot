import test from 'node:test';
import assert from 'node:assert/strict';
import { authed } from '../lib/auth.mjs';

const req = (headers = {}) => ({ headers });

test('sem token configurado, qualquer requisição passa', () => {
  assert.equal(authed(req(), ''), true);
  assert.equal(authed(req({ authorization: 'Bearer x' }), ''), true);
});

test('com token, exige Bearer ou cookie ripper_token', () => {
  const secret = 'ripper-test-secret';
  assert.equal(authed(req(), secret), false);
  assert.equal(authed(req({ authorization: 'Bearer wrong' }), secret), false);
  assert.equal(authed(req({ authorization: 'Bearer ripper-test-secret' }), secret), true);
  assert.equal(authed(req({ cookie: 'other=1; ripper_token=ripper-test-secret' }), secret), true);
  assert.equal(authed(req({ cookie: 'ripper_token=ripper-test-secret%21' }), 'ripper-test-secret!'), true);
});

test('comparação é segura em tamanho (timingSafeEqual)', () => {
  const secret = 'abcd';
  assert.equal(authed(req({ authorization: 'Bearer abc' }), secret), false);
  assert.equal(authed(req({ authorization: 'Bearer abcde' }), secret), false);
});
