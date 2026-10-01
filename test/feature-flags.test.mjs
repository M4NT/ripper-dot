import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeFeatureFlags,
  effectiveFeatureFlags,
  isFlagEnabled,
  KNOWN_FLAG_KEYS
} from '../lib/feature-flags.mjs';

test('normalizeFeatureFlags ignora chaves desconhecidas sem allowCustom', () => {
  const flags = normalizeFeatureFlags({}, { chaosUi: true, mysteryFlag: true, allowCustom: false });
  assert.equal(flags.chaosUi, true);
  assert.equal(flags.mysteryFlag, undefined);
  assert.equal(flags.allowCustom, false);
});

test('normalizeFeatureFlags preserva custom com allowCustom', () => {
  const flags = normalizeFeatureFlags(
    { flags: { allowCustom: true } },
    { customBeta: true, notBool: 'yes', 'bad-key!': true }
  );
  assert.equal(flags.allowCustom, true);
  assert.equal(flags.customBeta, true);
  assert.equal(flags['bad-key!'], undefined);
  assert.equal(flags.notBool, undefined);
});

test('effectiveFeatureFlags omite allowCustom', () => {
  const eff = effectiveFeatureFlags({ flags: { chaosUi: true, allowCustom: true, x9Card: false } });
  assert.equal(eff.chaosUi, true);
  assert.equal(eff.x9Card, false);
  assert.equal(eff.allowCustom, undefined);
  for (const key of KNOWN_FLAG_KEYS) assert.equal(typeof eff[key], 'boolean');
});

test('isFlagEnabled lê db ou settings', () => {
  const db = { settings: { flags: { architectHub: true } } };
  assert.equal(isFlagEnabled(db, 'architectHub'), true);
  assert.equal(isFlagEnabled(db, 'socialWebhooks'), false);
  assert.equal(isFlagEnabled(db.settings, 'architectHub'), true);
});

test('todas as chaves conhecidas normalizam para boolean', () => {
  const flags = normalizeFeatureFlags({});
  for (const key of KNOWN_FLAG_KEYS) {
    assert.equal(typeof flags[key], 'boolean');
  }
});
