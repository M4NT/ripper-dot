import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRipperBuiltinTools } from '../lib/ripper-builtin-tools.mjs';

const neverSend = { send: () => { throw new Error('a demonstração não pode enviar e-mail'); }, list: () => '', read: () => '', attachment: () => '' };

test('email_campaign só monta o cartão: nunca chama o envio real', async () => {
  const cards = [];
  const tools = buildRipperBuiltinTools({ tools: ['social'] }, { settings: {}, email: neverSend, campaign: a => (cards.push(a), 'montada em demonstração') });
  const t = tools.find(x => x.name === 'email_campaign');
  assert.ok(t, 'agente com Publicação social tem a ferramenta');
  assert.match(t.description, /DEMONSTRAÇÃO: nada é enviado/);
  const r = await t.execute({ subject: 'Semana do Café', preview: 'Novidades', body: 'Oi!', audience: 'quem aceitou', recipients: 312 });
  assert.match(JSON.stringify(r), /demonstração/);
  assert.equal(cards.length, 1);
});

test('sem "Publicação social" a ferramenta não aparece', () => {
  const names = buildRipperBuiltinTools({ tools: ['web'] }, { settings: {}, campaign: () => '' }).map(t => t.name);
  assert.ok(!names.includes('email_campaign'));
});
