import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInbox, resolveInboxItem } from '../lib/inbox-feed.mjs';

const db = () => ({
  agents: [{ id: 'p', name: 'Porteiro' }],
  approvals: [{ id: 'ap', agentId: 'p', status: 'pending', createdAt: 5 }, { id: 'old', agentId: 'p', status: 'approved', createdAt: 9 }],
  chats: [
    { id: 'o', agentId: 'p', channelKey: 'owner:p', messages: [
      { id: 'n1', at: 10, via: { type: 'owner-notify', contact: 'Ana', phone: '5511988887777', summary: 'quer agendar', action: 'confirmar sexta' } },
      { id: 'n0', at: 1, content: '**Recado do WhatsApp — Bia**\n\nPedido: orçamento\n\n**Ação sugerida:** Enviar preço\n\nResponda aqui.', via: { type: 'owner-notify', contact: 'Bia' } },
      { id: 'x', at: 11, role: 'user', content: 'pode marcar' }
    ] },
    { id: 'r', agentId: 'p', routineId: 'rt', unread: true, urgent: true, title: 'Radar', updatedAt: 3, messages: [{ role: 'assistant', content: 'edital novo' }] },
    { id: 'quiet', agentId: 'p', routineId: 'rt2', unread: false, messages: [] },
    { id: 'c', agentId: 'p', messages: [] }
  ]
});

test('Caixa junta aprovação pendente, recados e rotina com novidade — urgente e aprovação primeiro', () => {
  const b = buildInbox(db());
  assert.deepEqual(b.items.map(i => `${i.kind}:${i.id}`), ['routine:r', 'approval:ap', 'notice:n1', 'notice:n0']);
  assert.equal(b.count, 4);
});

test('recado antigo (só texto pronto) vira resumo + ação', () => {
  const n0 = buildInbox(db()).items.find(i => i.id === 'n0');
  assert.deepEqual([n0.summary, n0.action], ['Pedido: orçamento', 'Enviar preço']);
});

test('resolver tira da Caixa; aprovação não se resolve por aqui', () => {
  const d = db();
  assert.equal(resolveInboxItem(d, 'notice', 'n1'), true);
  assert.equal(resolveInboxItem(d, 'routine', 'r'), true);
  assert.equal(resolveInboxItem(d, 'approval', 'ap'), false);
  assert.deepEqual(buildInbox(d).items.map(i => i.id), ['ap', 'n0']);
});
