import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSettingsSecrets as redactSettings } from '../lib/mcp-connectors.mjs'; // a que o servidor usa no /api/state
import {
  redactRoutine,
  redactSecretsInText,
  redactSecretsInLogText,
  redactSseEvent,
  redactHeaders,
  redactPlugin,
  redactJsonPayload,
  LOG_REDACTED
} from '../lib/redact.mjs';

test('redactSettings mascara chaves e OAuth', () => {
  const s = redactSettings({
    claude: { apiKey: 'sk-ant-real', mode: 'api' },
    computer: { boatApiKey: 'boat_secret' },
    plugins: [{
      name: 'x',
      type: 'http',
      url: 'https://mcp',
      auth: { clientSecret: 'cs', oauth: { accessToken: 'at', refreshToken: 'rt' } },
      headers: { Authorization: 'Bearer tok123', 'X-Custom': 'ok' }
    }],
    whatsapp: { enabled: true, accessToken: 'EAAG-real', appSecret: 'app-sec', verifyToken: 'vt' }
  });
  assert.equal(s.claude.apiKey, '••••');
  assert.equal(s.whatsapp.accessToken, '••••');
  assert.equal(s.whatsapp.appSecret, '••••');
  assert.equal(s.computer.boatApiKey, '••••');
  assert.equal(s.plugins[0].auth.clientSecret, '••••');
  assert.equal(s.plugins[0].auth.oauth.accessToken, '••••');
  assert.equal(s.plugins[0].headers.Authorization, '••••');
  assert.equal(s.plugins[0].headers['X-Custom'], '••••'); // a função real mascara todo header de plugin
});

test('redactRoutine não expõe hookSecret', () => {
  const r = redactRoutine({ id: '1', name: 'n', hookSecret: 's3cr3t', trigger: 'webhook' });
  assert.equal(r.hasSecret, true);
  assert.equal(r.hookSecret, undefined);
});

test('redactSecretsInText limpa Bearer e sk-ant', () => {
  const t = redactSecretsInText('Falhou com Bearer abc.def e sk-ant-api-12345');
  assert.match(t, /Bearer ••••/);
  assert.match(t, /sk-ant-••••/);
  assert.doesNotMatch(t, /abc\.def/);
});

test('redactSecretsInLogText usa [REDACTED] em logs', () => {
  const secret = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCD';
  const t = redactSecretsInLogText(`token ${secret} e Bearer abc.defghijklmnopqrstuvwxyz`);
  assert.match(t, new RegExp(LOG_REDACTED));
  assert.doesNotMatch(t, /ghp_abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(t, /abc\.defghijklmnopqrstuvwxyz/);
});

test('redactSecretsInText reconhece OpenAI e AWS', () => {
  const raw = 'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890ABCD AKIAIOSFODNN7EXAMPLE';
  const t = redactSecretsInText(raw);
  assert.doesNotMatch(t, /sk-proj-abcdefghijklmnopqrstuvwxyz1234567890ABCD/);
  assert.match(t, /AKIA••••/);
});

test('redactSseEvent sanitiza debug e detail de ferramentas', () => {
  const e = redactSseEvent({
    debug: 'trace com sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
    tool: 'run',
    detail: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCD'
  });
  assert.doesNotMatch(JSON.stringify(e), /abcdefghijklmnopqrstuvwxyz0123456789/);
});

test('redactJsonPayload sanitiza erros aninhados', () => {
  const body = redactJsonPayload({
    error: 'falhou',
    details: { message: 'Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCD' }
  });
  assert.doesNotMatch(body.details.message, /abcdefghijklmnopqrstuvwxyz0123456789/);
});

test('redactSseEvent sanitiza warn', () => {
  const e = redactSseEvent({ warn: 'Erro Bearer superlongtoken123456789012345678901234567890' });
  assert.doesNotMatch(e.warn, /superlongtoken/);
});

test('redactHeaders por nome', () => {
  assert.equal(redactHeaders({ 'x-api-key': 'k' })['x-api-key'], '••••');
});

test('redactPlugin com auth.headers array', () => {
  const p = redactPlugin({
    name: 'p',
    auth: { headers: [{ name: 'Authorization', value: 'Bearer x' }] }
  });
  assert.equal(p.auth.headers[0].value, '••••');
});

test('nome de ferramenta longo não é mascarado; token longo continua mascarado', async () => {
  const { redactSecretsInText } = await import('../lib/redact.mjs');
  assert.equal(redactSecretsInText('Usando mcp__claude_ai_Google_Calendar__list_events'), 'Usando mcp__claude_ai_Google_Calendar__list_events');
  assert.doesNotMatch(redactSecretsInText('token ghp_aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5bC7d'), /aB3dE5fG7hJ9kL1/);
});
