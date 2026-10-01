import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHandoff } from '../lib/inbox.mjs';

test('handoff monta contrato JSON previsível', () => {
  const { payload, body } = buildHandoff({ from: 'Faturamento', to: 'Mailcow', task: 'Enviar a nota ao cliente', done: 'Nota 123 emitida no Omie', data: { nota: 123, email: 'cliente@ex.com' }, expect: 'id da mensagem' });
  assert.deepEqual(payload, { handoff: 1, from: 'Faturamento', to: 'Mailcow', task: 'Enviar a nota ao cliente', done: 'Nota 123 emitida no Omie', data: { nota: 123, email: 'cliente@ex.com' }, expect: 'id da mensagem' });
  const sent = JSON.parse(body.match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.deepEqual(sent, payload); // o colega recebe exatamente o contrato

  assert.throws(() => buildHandoff({ from: 'a', to: 'b', task: ' ' }));
  assert.throws(() => buildHandoff({ from: 'a', to: 'b', task: 'x', data: [1, 2] }));
});
