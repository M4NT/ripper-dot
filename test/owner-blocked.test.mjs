import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownerBlockedReason } from '../lib/agent-flow.mjs';

test('detecta bloqueio pelo jeito que o agente realmente escreve', () => {
  assert.ok(ownerBlockedReason('Preciso da proposta e do contato da Ana para enviá-la. Envie o arquivo ou texto da proposta.'));
  assert.ok(ownerBlockedReason('Não enviei a proposta. Não consigo acessar o Drive sem sua autorização.'));
  assert.ok(ownerBlockedReason('Preciso que você aprove o envio.'));
  assert.equal(ownerBlockedReason('A cotação do dólar está em R$ 5,02, segundo a fonte oficial.'), null);
  assert.equal(ownerBlockedReason('Oi, bom dia! Como posso ajudar?'), null);
});
