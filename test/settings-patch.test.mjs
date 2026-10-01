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

test('settingsMeta lista modelos e esforços', () => {
  const m = settingsMeta();
  assert.ok(m.models.includes('auto'));
  assert.ok(m.efforts.includes('high'));
  assert.equal(m.providerRetry.maxAttempts, 3);
});

test('applySettingsPatch aceita settings.ui.mode', () => {
  const s = { defaultModel: 'auto', claude: {}, computer: {}, ui: { mode: 'simple' } };
  applySettingsPatch(s, { ui: { mode: 'enterprise' } });
  assert.equal(s.ui.mode, 'enterprise');
  assert.throws(() => applySettingsPatch(s, { ui: { mode: 'turbo' } }), /interface/);
});
