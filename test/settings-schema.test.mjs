import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSettingsPatch, assertValidSettingsPatch, SettingsValidationError } from '../lib/settings-schema.mjs';
import { patchSettings } from '../lib/settings-patch.mjs';

const base = () => ({
  defaultModel: 'auto',
  claude: { mode: 'subscription', apiKey: '', useConnectors: true },
  computer: { mode: 'boat', boatApiKey: '', vmSize: 'default', idleStopMinutes: 10, allowLocalCommands: false },
  plugins: []
});

test('validateSettingsPatch rejeita chave desconhecida no topo', () => {
  const details = validateSettingsPatch({ evil: true });
  assert.ok(details.some(d => d.path === 'evil'));
});

test('validateSettingsPatch permite chave legada já persistida', () => {
  const details = validateSettingsPatch(
    { legacyField: 'ok', name: 'Ripper' },
    { existingKeys: new Set(['legacyField', 'name']) }
  );
  assert.ok(!details.some(d => d.path === 'legacyField'));
});

test('validateSettingsPatch rejeita defaultModel inválido', () => {
  const details = validateSettingsPatch({ defaultModel: 'gpt-99' });
  assert.ok(details.some(d => d.path === 'defaultModel'));
});

test('validateSettingsPatch aceita patch válido mínimo', () => {
  assert.equal(validateSettingsPatch({ memory: false }).length, 0);
});

test('validateSettingsPatch rejeita flag desconhecida sem allowCustom', () => {
  const details = validateSettingsPatch({ flags: { chaosUi: true, rogue: true } });
  assert.ok(details.some(d => d.path === 'flags.rogue'));
});

test('validateSettingsPatch aceita flag custom com allowCustom', () => {
  const details = validateSettingsPatch({ flags: { allowCustom: true, rogue: true } });
  assert.equal(details.length, 0);
});

test('validateSettingsPatch valida ui.locale e enterprise.enabled', () => {
  assert.ok(validateSettingsPatch({ ui: { locale: 'xx' } }).some(d => d.path === 'ui.locale'));
  assert.ok(validateSettingsPatch({ enterprise: { enabled: 'yes' } }).some(d => d.path === 'enterprise.enabled'));
  assert.equal(validateSettingsPatch({ ui: { locale: 'en' }, enterprise: { enabled: true } }).length, 0);
});

test('assertValidSettingsPatch lança com details', () => {
  assert.throws(
    () => assertValidSettingsPatch({ defaultModel: 'nope' }),
    err => {
      assert.equal(err.name, 'SettingsValidationError');
      assert.ok(Array.isArray(err.details) && err.details[0].path === 'defaultModel');
      return true;
    }
  );
});

test('patchSettings não altera settings em patch inválido', () => {
  const s = base();
  s.memory = true;
  assert.throws(() => patchSettings(s, { defaultModel: 'nope' }), SettingsValidationError);
  assert.equal(s.memory, true);
  assert.equal(s.defaultModel, 'auto');
});

test('patchSettings aplica patch válido', () => {
  const s = base();
  patchSettings(s, { memory: false, providerRetry: { maxAttempts: 2 } });
  assert.equal(s.memory, false);
  assert.equal(s.providerRetry.maxAttempts, 2);
});
