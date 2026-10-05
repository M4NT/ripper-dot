import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPulse, pulseDue, pulseWhatsappTo } from '../lib/pulse.mjs';

const now = Date.UTC(2026, 9, 5, 11);
const db = {
  agents: [{ id: 'a', name: 'Porteiro' }, { id: 'b', name: 'Redatora' }],
  chats: [{ messages: [
    { role: 'assistant', agentId: 'a', at: now - 1000, steps: [{}, {}] },
    { role: 'assistant', agentId: 'a', at: now - 2000 },
    { role: 'assistant', agentId: 'b', at: now - 3000, error: 'x' },
    { role: 'assistant', agentId: 'b', at: now - 48 * 3600_000 } // fora das 24h
  ] }],
  files: [{ delivered: true, createdAt: now - 10 }],
  routines: [{ name: 'Notícias', lastRun: now - 10, lastStatus: 'error' }],
  paidSpend: { total: 0.42 }
};

test('resume as últimas 24h sem chamar modelo', () => {
  const p = buildPulse(db, { now, external: [{ at: now - 5, action: 'whatsapp.sent' }], inboxCount: 2 });
  assert.match(p.body, /Porteiro: 2 respostas, 2 ações/);
  assert.match(p.body, /Redatora: 0 respostas — 1 falha/);
  assert.match(p.body, /1 arquivo entregue/);
  assert.match(p.body, /Notícias falhou/);
  assert.match(p.body, /1 mensagem no WhatsApp/);
  assert.match(p.body, /US\$ 0\.42/);
  assert.match(p.body, /2 itens esperam/);
  assert.equal(p.empty, false);
});

test('dia parado e agenda', () => {
  assert.equal(buildPulse({ agents: [], chats: [] }, { now }).empty, true);
  const at9 = new Date(2026, 9, 5, 9), at7 = new Date(2026, 9, 5, 7);
  assert.equal(pulseDue({}, null, at7), null);
  assert.ok(pulseDue({}, null, at9));
  assert.equal(pulseDue({}, at9.toLocaleDateString('sv'), at9), null, 'uma vez por dia');
  assert.equal(pulseDue({ pulse: { enabled: false } }, null, at9), null);
});

test('WhatsApp do resumo: só com opt-in e número válido do dono', () => {
  assert.equal(pulseWhatsappTo({ pulse: { whatsappTo: '+55 16 99999-9999' } }), null);
  assert.equal(pulseWhatsappTo({ pulse: { whatsapp: true, whatsappTo: '+55 16 99999-9999' } }), '5516999999999');
  assert.equal(pulseWhatsappTo({ pulse: { whatsapp: true, whatsappTo: '123' } }), null);
  assert.equal(pulseWhatsappTo({ pulse: { enabled: false, whatsapp: true, whatsappTo: '5516999999999' } }), null);
});
