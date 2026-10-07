import test from 'node:test';
import assert from 'node:assert/strict';
import { extractEmails, campaignText, runCampaign, humanGap, UNSUBSCRIBE_NOTE } from '../lib/email-campaign.mjs';
import { fileText } from '../lib/attachments.mjs';

test('lê os e-mails da lista: sem repetir, minúsculos, na ordem', () => {
  const csv = 'nome,email\nAna,Ana@Loja.com.br\nBia,bia@cafe.com\nAna de novo,ana@loja.com.br\nsem email,—\nCarlos;carlos.silva@empresa.co.';
  assert.deepEqual(extractEmails(csv), ['ana@loja.com.br', 'bia@cafe.com', 'carlos.silva@empresa.co']);
  assert.deepEqual(extractEmails(fileText('lista.txt', Buffer.from('x@y.com, z@w.org'))), ['x@y.com', 'z@w.org']);
});

test('todo e-mail leva o descadastro no rodapé', () => {
  assert.ok(campaignText('Oi!').endsWith(UNSUBSCRIBE_NOTE));
});

test('envia um por vez, com intervalo de pessoa, e conta falhas', async () => {
  const sent = [], waits = [];
  const st = await runCampaign({
    emails: ['a@x.com', 'b@x.com', 'c@x.com'],
    send: async to => { if (to === 'b@x.com') throw new Error('caixa cheia'); sent.push(to); },
    wait: async ms => { waits.push(ms); }, gap: () => 4000
  });
  assert.deepEqual(sent, ['a@x.com', 'c@x.com']);
  assert.deepEqual(waits, [4000, 4000]);
  assert.equal(st.status, 'concluída');
  assert.equal(st.sent, 2); assert.equal(st.failed, 1);
  assert.match(st.errors[0], /b@x.com: caixa cheia/);
  for (let i = 0; i < 50; i++) { const g = humanGap(); assert.ok(g >= 3000 && g < 6000); }
});

test('parar no meio: não envia mais nada', async () => {
  const sent = [];
  let stop = false;
  const st = await runCampaign({ emails: ['a@x.com', 'b@x.com', 'c@x.com'], send: async to => { sent.push(to); if (to === 'a@x.com') stop = true; }, stopped: () => stop, wait: async () => {} });
  assert.deepEqual(sent, ['a@x.com']);
  assert.equal(st.status, 'parada');
});
