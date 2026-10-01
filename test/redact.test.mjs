import test from 'node:test';
import assert from 'node:assert/strict';
import {
  redactSettings,
  redactRoutine,
  redactSecretsInText,
  redactSseEvent,
  redactHeaders,
  redactPlugin
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
    }]
  });
  assert.equal(s.claude.apiKey, '••••');
  assert.equal(s.computer.boatApiKey, '••••');
  assert.equal(s.plugins[0].auth.clientSecret, '••••');
  assert.equal(s.plugins[0].auth.oauth.accessToken, '••••');
  assert.equal(s.plugins[0].headers.Authorization, '••••');
  assert.equal(s.plugins[0].headers['X-Custom'], 'ok');
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
