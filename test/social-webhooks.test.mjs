import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySocialWebhooksPatch,
  postToSocialWebhook,
  socialPostNeedsApproval,
  redactSocialWebhooks,
  resolveSocialWebhook
} from '../lib/social-webhooks.mjs';
import { applySettingsPatch } from '../lib/settings-patch.mjs';
import { redactSettingsSecrets as redactSettings } from '../lib/mcp-connectors.mjs'; // a que o servidor usa
import { buildRipperBuiltinTools } from '../lib/ripper-builtin-tools.mjs';

test('redactSocialWebhooks mascara URL', () => {
  const r = redactSocialWebhooks([{ id: '1', name: 'Slack', url: 'https://hooks.example/x', enabled: true }]);
  assert.equal(r[0].url, '••••');
  assert.equal(r[0].hasUrl, true);
});

test('applySocialWebhooksPatch preserva URL quando cliente manda ••••', () => {
  const s = { social: { webhooks: [{ id: 'a', name: 'Canal', url: 'https://hooks.example/secret', enabled: true }] } };
  applySocialWebhooksPatch(s, [{ id: 'a', name: 'Canal', url: '••••', enabled: false }]);
  assert.equal(s.social.webhooks[0].url, 'https://hooks.example/secret');
  assert.equal(s.social.webhooks[0].enabled, false);
});

test('postToSocialWebhook envia JSON { text }', async () => {
  let seen;
  const fetch = async (url, init) => {
    seen = { url, body: init.body, headers: init.headers };
    return { ok: true, status: 200, text: async () => 'ok' };
  };
  const r = await postToSocialWebhook({ url: 'https://hooks.example/h', name: 'h' }, 'Olá mundo', { fetch });
  assert.equal(r.ok, true);
  assert.equal(seen.url, 'https://hooks.example/h');
  assert.deepEqual(JSON.parse(seen.body), { text: 'Olá mundo' });
});

test('socialPostNeedsApproval segue approvalPolicy', () => {
  assert.ok(socialPostNeedsApproval({ policy: 'risky' }));
  assert.ok(socialPostNeedsApproval({ policy: 'always' }));
  assert.equal(socialPostNeedsApproval({ policy: 'never' }), null);
  assert.equal(socialPostNeedsApproval({ policy: 'risky', commandKey: 'x', allowed: ['x'] }), null);
});

test('resolveSocialWebhook por nome', () => {
  const s = { social: { webhooks: [{ id: 'id1', name: 'Equipe', url: 'https://x', enabled: true }] } };
  assert.equal(resolveSocialWebhook(s, 'Equipe').id, 'id1');
});

test('buildRipperBuiltinTools inclui post_social quando há webhook e ferramenta social', async () => {
  const agent = { tools: ['social', 'memory'] };
  const ctx = {
    settings: { flags: { socialWebhooks: true } },
    social: {
      webhooks: [{ id: '1', name: 'w', url: 'https://h', enabled: true }],
      list: () => 'ok',
      post: async () => 'posted'
    }
  };
  const names = buildRipperBuiltinTools(agent, ctx).map(t => t.name);
  assert.ok(names.includes('post_social'));
  assert.ok(names.includes('send_webhook'));
  const post = buildRipperBuiltinTools(agent, ctx).find(t => t.name === 'post_social');
  const out = await post.execute({ webhookId: '1', text: 'hi' });
  assert.match(out.content[0].text, /posted/);
});

test('applySettingsPatch integra social.webhooks', () => {
  const s = { claude: {}, computer: {}, social: { webhooks: [] } };
  applySettingsPatch(s, {
    social: {
      webhooks: [{ id: 'n', name: 'Bot', url: 'https://hooks.example/t', enabled: true }]
    }
  });
  assert.equal(s.social.webhooks.length, 1);
  const red = redactSettings(s);
  assert.equal(red.social.webhooks[0].url, '••••');
});
