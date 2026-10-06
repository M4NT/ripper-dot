import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTING_CARDS, settingIsOn, settingPatch, settingCardView } from '../lib/setting-cards.mjs';
import { patchSettings } from '../lib/settings-patch.mjs';

const base = () => ({
  memory: false, claude: { autoSwitch: false }, inputQueue: { enabled: false, windowMs: 2500 }, pulse: { enabled: false, whatsapp: false },
  backup: { enabled: true }, whatsappWeb: { enabled: true, paused: false, readGroups: false }, lgpd: { enabled: false, redactBeforeLlm: false },
  tokenBudget: { enabled: false }, computer: { mode: 'docker', allowLocalCommands: false }, ui: { mode: 'enterprise' }, flags: {}
});

test('cada interruptor liga e desliga de verdade pelas regras normais das configurações', () => {
  for (const key of Object.keys(SETTING_CARDS)) {
    const s = base();
    const was = settingIsOn(s, key);
    patchSettings(s, settingPatch(key, !was));
    assert.equal(settingIsOn(s, key), !was, `${key} não mudou`);
  }
});

test('cartão: estado atual, proposto e confirmação extra no que é sensível', () => {
  const s = base();
  assert.deepEqual(settingCardView(s, 'ui.mode', false), { key: 'ui.mode', label: 'Modo Enterprise', desc: SETTING_CARDS['ui.mode'].desc, current: true, proposed: false, sensitive: false });
  assert.equal(settingCardView(s, 'computer.allowLocalCommands', true).sensitive, true);
  assert.equal(settingCardView(s, 'backup.enabled', false).sensitive, true, 'desligar backup pede confirmação');
  assert.equal(settingCardView(s, 'backup.enabled', true).sensitive, false);
  assert.equal(settingCardView(s, 'nao.existe', true), null);
  assert.throws(() => settingPatch('settings.apiKey', true));
});
