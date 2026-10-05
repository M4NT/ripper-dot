import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whatsappTriggerMatches, parseKeywords } from '../lib/event-triggers.mjs';

const r = { trigger: 'whatsapp', keywords: parseKeywords('urgente, orçamento; nota fiscal'), scope: 'contacts', lastRun: 0 };

test('palavra inteira, sem diferença de acento ou maiúscula', () => {
  assert.equal(whatsappTriggerMatches(r, { text: 'Preciso de um ORCAMENTO hoje' }), true);
  assert.equal(whatsappTriggerMatches(r, { text: 'manda a nota fiscal, por favor' }), true);
  assert.equal(whatsappTriggerMatches(r, { text: 'nada urgentemente aqui' }), false, 'não casa pedaço de palavra');
  assert.equal(whatsappTriggerMatches(r, { text: 'oi tudo bem' }), false);
});

test('escopo, mensagens suas e intervalo mínimo', () => {
  assert.equal(whatsappTriggerMatches(r, { text: 'urgente', isGroup: true }), false, 'rotina de contatos ignora grupo');
  assert.equal(whatsappTriggerMatches({ ...r, scope: 'groups' }, { text: 'urgente', isGroup: true }), true);
  assert.equal(whatsappTriggerMatches({ ...r, scope: 'any' }, { text: 'urgente', isGroup: true }), true);
  assert.equal(whatsappTriggerMatches(r, { text: 'urgente', fromMe: true }), false);
  assert.equal(whatsappTriggerMatches({ ...r, lastRun: Date.now() - 10_000 }, { text: 'urgente' }), false);
  assert.equal(whatsappTriggerMatches({ ...r, keywords: [] }, { text: 'qualquer coisa' }), true);
  assert.equal(whatsappTriggerMatches({ ...r, trigger: 'webhook' }, { text: 'urgente' }), false);
});

test('e-mail: palavra-chave no remetente ou assunto', async () => {
  const { emailTriggerMatches } = await import('../lib/event-triggers.mjs');
  const r = { trigger: 'email', keywords: ['fatura', 'banco.com'], lastRun: 0 };
  assert.equal(emailTriggerMatches(r, { from: 'Cobrança <x@banco.com>', subject: 'Aviso' }), true);
  assert.equal(emailTriggerMatches(r, { from: 'a@b.com', subject: 'Sua FATURA chegou' }), true);
  assert.equal(emailTriggerMatches(r, { from: 'a@b.com', subject: 'Newsletter' }), false);
  assert.equal(emailTriggerMatches({ ...r, trigger: 'whatsapp' }, { from: 'x@banco.com', subject: 'fatura' }), false);
});
