import test from 'node:test';
import assert from 'node:assert/strict';
import { contactMode, hasConsent } from '../lib/evolution.mjs';
import { normalizeConsents } from '../lib/settings-patch.mjs';

test('sem exigir consentimento: lista de permitidos continua respondendo sozinha', () => {
  assert.equal(contactMode('5511988887777', { allowlist: ['5511988887777'] }), 'auto');
});

test('exigindo consentimento: sem registro vira rascunho, com registro responde sozinho', () => {
  const w = { allowlist: ['5511988887777'], requireConsent: true, consents: {} };
  assert.equal(contactMode('5511988887777', w), 'draft');
  w.consents = { '551188887777': { at: 1, how: 'mensagem' } }; // sem o 9 extra também vale
  assert.equal(contactMode('5511988887777', w), 'auto');
  assert.equal(contactMode('5521900000000', w), null);
  assert.equal(contactMode('5521900000000', { ...w, contactModes: { '5521900000000': 'read' } }), 'read');
});

test('hasConsent e normalizeConsents', () => {
  assert.equal(hasConsent('5511988887777', null), false);
  const c = normalizeConsents({ '+55 (11) 98888-7777': { how: 'xyz' }, '123': { how: 'mensagem' }, '5511977776666': { at: 5, how: 'contrato', note: 'n' } });
  assert.deepEqual(Object.keys(c), ['5511988887777', '5511977776666']);
  assert.equal(c['5511988887777'].how, 'outro');
  assert.ok(c['5511988887777'].at > 0);
  assert.deepEqual(c['5511977776666'], { at: 5, how: 'contrato', note: 'n' });
});
