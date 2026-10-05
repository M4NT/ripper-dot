import test from 'node:test';
import assert from 'node:assert/strict';
import { explainError } from '../lib/human-errors.mjs';

const cases = [
  ['429 Too Many Requests', 'retry'],
  ['You have hit your usage limit', 'retry'],
  ['Not logged in · Please run /login', 'reconnect-claude'],
  ['401 invalid x-api-key', 'settings-providers'],
  ['connect ECONNREFUSED 127.0.0.1:443', 'retry'],
  ['TypeError: fetch failed', 'retry'],
  ['503 Service Unavailable', 'retry'],
  ['overloaded_error', 'retry'],
  ['Uso pago não autorizado. Ative em Configurações', 'paid-usage'],
  ['Limite diário de uso pago deste agente atingido (US$ 2.00)', 'paid-usage'],
  ['Cannot connect to the Docker daemon', 'settings-computer'],
  ['Evolution: instance is disconnected (WhatsApp)', 'settings-channels'],
  ['IMAP: AUTHENTICATIONFAILED', 'settings-channels'],
  ['GitHub: Bad credentials', 'settings-channels'],
  ['A sessão expirou no portal', 'open-inbox'],
  ['Request entity too large', null],
  ['prompt is too long: 250000 tokens > 200000 maximum', null]
];
for (const [raw, action] of cases) test(`explainError: ${raw}`, () => {
  const e = explainError(raw);
  assert.equal(e.action, action);
  assert.notEqual(e.title, 'Algo deu errado.');
});

test('desconhecido cai no genérico com detalhes', () => {
  const e = explainError('xyzzy quebrou');
  assert.equal(e.title, 'Algo deu errado.');
  assert.equal(e.details, 'xyzzy quebrou');
});

test('segredos nunca aparecem', () => {
  const secrets = ['sk-ant-abc123456789XYZ', 'ghp_ABCDEFGH123456', 'eyJabc.def.ghi', 'supersecret1'];
  for (const raw of ['401 key sk-ant-abc123456789XYZ', 'github ghp_ABCDEFGH123456 falhou', 'Authorization: Bearer eyJabc.def.ghi recusado', 'boom api_key=supersecret1']) {
    const e = explainError(raw);
    const all = e.title + e.hint + e.details;
    for (const s of secrets) assert.ok(!all.includes(s), all);
  }
});

test('stack trace some dos detalhes', () => {
  assert.ok(!explainError('Error: x\n    at foo (/a/b.js:1:2)').details.includes('/a/b.js'));
});
