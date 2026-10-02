import test from 'node:test';
import assert from 'node:assert/strict';
import { applySettingsPatch, settingsMeta } from '../lib/settings-patch.mjs';

test('applySettingsPatch rejeita modelo desconhecido', () => {
  const s = { defaultModel: 'auto', claude: {}, computer: {} };
  assert.throws(() => applySettingsPatch(s, { defaultModel: 'gpt-99' }), /desconhecido/);
});

test('applySettingsPatch aceita providerRetry', () => {
  const s = { defaultModel: 'auto', claude: {}, computer: {}, ui: { locale: 'pt-BR' } };
  applySettingsPatch(s, { providerRetry: { maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 5000 } });
  assert.equal(s.providerRetry.maxAttempts, 2);
});

test('applySettingsPatch aceita rateLimit', () => {
  const s = { defaultModel: 'auto', claude: {}, computer: {}, rateLimit: { enabled: false, chatPerMinute: 30, apiPerMinute: 20, windowMs: 60_000 } };
  applySettingsPatch(s, { rateLimit: { enabled: true, chatPerMinute: 5 } });
  assert.equal(s.rateLimit.enabled, true);
  assert.equal(s.rateLimit.chatPerMinute, 5);
});

test('applySettingsPatch persiste settings.ui.locale', () => {
  const s = { defaultModel: 'auto', claude: {}, computer: {}, ui: { locale: 'pt-BR', mode: 'simple' } };
  applySettingsPatch(s, { ui: { locale: 'en' } });
  assert.equal(s.ui.locale, 'en');
  assert.throws(() => applySettingsPatch(s, { ui: { locale: 'de' } }), /inválido/);
});

test('applySettingsPatch aceita inputQueue', () => {
  const s = { defaultModel: 'auto', claude: {}, computer: {} };
  applySettingsPatch(s, { inputQueue: { enabled: false, windowMs: 1200 } });
  assert.equal(s.inputQueue.enabled, false);
  assert.equal(s.inputQueue.windowMs, 1200);
});

test('applySettingsPatch aceita defaults.agentStyle', () => {
  const s = { defaultModel: 'auto', claude: {}, computer: {}, defaults: { agentStyle: {} } };
  applySettingsPatch(s, { defaults: { agentStyle: { tone: 'tecnico', maxSentences: 6 } } });
  assert.equal(s.defaults.agentStyle.tone, 'tecnico');
  assert.equal(s.defaults.agentStyle.maxSentences, 6);
});

test('settingsMeta lista modelos e esforços', () => {
  const m = settingsMeta();
  assert.ok(m.models.includes('auto'));
  assert.ok(m.efforts.includes('high'));
  assert.equal(m.providerRetry.maxAttempts, 3);
  assert.equal(m.inputQueue.windowMs, 2500);
});

test('applySettingsPatch aceita ui.mode e sincroniza enterprise.enabled', () => {
  const s = { defaultModel: 'auto', claude: {}, computer: {}, ui: { mode: 'simple' }, enterprise: { enabled: false } };
  applySettingsPatch(s, { ui: { mode: 'enterprise' } });
  assert.equal(s.ui.mode, 'enterprise');
  assert.equal(s.enterprise.enabled, true);
  applySettingsPatch(s, { ui: { mode: 'simple' } });
  assert.equal(s.enterprise.enabled, false);
});

test('applySettingsPatch ativa modo enterprise via enterprise.enabled', () => {
  const s = { defaultModel: 'auto', claude: {}, computer: {}, ui: { mode: 'simple' }, enterprise: { enabled: false } };
  applySettingsPatch(s, { enterprise: { enabled: true } });
  assert.equal(s.enterprise.enabled, true);
  assert.equal(s.ui.mode, 'enterprise');
  applySettingsPatch(s, { enterprise: { enabled: false } });
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

test('applySettingsPatch aceita contextPruning opt-in', () => {
  const s = { defaultModel: 'auto', claude: {}, computer: {} };
  applySettingsPatch(s, { contextPruning: { enabled: true, maxMessages: 30, maxTokens: 8000, keepRecent: 8 } });
  assert.equal(s.contextPruning.enabled, true);
  assert.equal(s.contextPruning.maxMessages, 30);
  assert.equal(s.contextPruning.keepRecent, 8);
});

test('applySettingsPatch preserva links ao atualizar brand parcialmente', () => {
  const s = {
    defaultModel: 'auto', claude: {}, computer: {},
    ui: { mode: 'enterprise' },
    enterprise: { enabled: true },
    brand: { displayName: 'A', logoUrl: '', accentColor: '', tagline: '', links: { website: 'https://a.com/' } }
  };
  applySettingsPatch(s, { brand: { displayName: 'B' } });
  assert.equal(s.brand.displayName, 'B');
  assert.equal(s.brand.links.website, 'https://a.com/');
});

test('applySettingsPatch rejeita brand no modo simples', () => {
  const s = { defaultModel: 'auto', claude: {}, computer: {}, ui: { mode: 'simple' }, enterprise: { enabled: false } };
  assert.throws(() => applySettingsPatch(s, { brand: { displayName: 'X' } }), /enterprise/);
});

test('salvar plugins com headers mascarados mantém o valor real', async () => {
  const { applyPluginsPatch } = await import('../lib/settings-patch.mjs');
  const { mergePluginAuth } = await import('../lib/mcp-oauth.mjs');
  const s = { plugins: [{ name: 'gh', type: 'http', url: 'https://x', headers: { Authorization: 'Bearer real' } }] };
  applyPluginsPatch(s, [{ name: 'gh', type: 'http', url: 'https://x', headers: { Authorization: '••••' } }, { name: 'novo', type: 'http', url: 'https://y' }], { mergePluginAuth });
  assert.equal(s.plugins[0].headers.Authorization, 'Bearer real');
  assert.equal(s.plugins.length, 2);
});
