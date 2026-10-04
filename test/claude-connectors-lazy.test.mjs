import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wantsConnectors } from '../lib/claude-connectors.mjs';

test('conectores carregam de saída só quando o pedido parece precisar', () => {
  assert.equal(wantsConnectors('o que tenho na agenda amanhã?'), true);
  assert.equal(wantsConnectors('lê meus e-mails de hoje'), true);
  assert.equal(wantsConnectors('Abre a planilha do Drive'), true);
  assert.equal(wantsConnectors('diga oi'), false);
  assert.equal(wantsConnectors('resuma este texto sobre marketing'), false);
});
