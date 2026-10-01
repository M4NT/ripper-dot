import test from 'node:test';
import assert from 'node:assert/strict';
import { applySettingsPatch, settingsMeta } from '../lib/settings-patch.mjs';

test('applySettingsPatch rejeita modelo desconhecido', () => {
  const s = { defaultModel: 'auto', claude: {}, computer: {} };
  assert.throws(() => applySettingsPatch(s, { defaultModel: 'gpt-99' }), /desconhecido/);
});

test('applySettingsPatch aceita providerRetry', () => {
  const s = { defaultModel: 'auto', claude: {}, computer: {} };
  applySettingsPatch(s, { providerRetry: { maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 5000 } });
  assert.equal(s.providerRetry.maxAttempts, 2);
});

test('applySettingsPatch aceita rateLimit', () => {
  const s = { defaultModel: 'auto', claude: {}, computer: {}, rateLimit: { enabled: false, chatPerMinute: 30, apiPerMinute: 20, windowMs: 60_000 } };
  applySettingsPatch(s, { rateLimit: { enabled: true, chatPerMinute: 5 } });
  assert.equal(s.rateLimit.enabled, true);
  assert.equal(s.rateLimit.chatPerMinute, 5);
});

test('settingsMeta lista modelos e esforços', () => {
  const m = settingsMeta();
  assert.ok(m.models.includes('auto'));
  assert.ok(m.efforts.includes('high'));
  assert.equal(m.providerRetry.maxAttempts, 3);
});

test('applySettingsPatch aceita ui.mode e sincroniza enterprise.enabled', () => {
  const s = { defaultModel: 'auto', claude: {}, computer: {}, ui: { mode: 'simple' }, enterprise: { enabled: false } };
  applySettingsPatch(s, { ui: { mode: 'enterprise' } });
  assert.equal(s.ui.mode, 'enterprise');
  assert.equal(s.enterprise.enabled, true);
  applySettingsPatch(s, { ui: { mode: 'simple' } });
  assert.equal(s.enterprise.enabled, false);
});

test('applySettingsPatch rejeita ui.mode inválido', () => {
  const s = { defaultModel: 'auto', claude: {}, computer: {} };
  assert.throws(() => applySettingsPatch(s, { ui: { mode: 'completa' } }), /interface/);
});

test('applySettingsPatch normaliza flags', () => {
  const s = { defaultModel: 'auto', claude: {}, computer: {}, flags: { chaosUi: false } };
  applySettingsPatch(s, { flags: { chaosUi: true, evil: true } });
  assert.equal(s.flags.chaosUi, true);
  assert.equal(s.flags.evil, undefined);
  applySettingsPatch(s, { flags: { allowCustom: true, evil: true } });
  assert.equal(s.flags.evil, true);
});
