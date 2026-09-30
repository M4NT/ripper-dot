import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSend, dueMessages, threadKey, inboxPrompt } from '../lib/inbox.mjs';

const A = { id: 'a', name: 'Ana' }, B = { id: 'b', name: 'Bia' }, P = { id: 'p', name: 'Pausado', status: 'paused' };
const limits = { maxPerHour: 2, maxHops: 3 };

test('envio: destinatário válido, não a si mesmo, não pausado', () => {
  assert.ok(checkSend({ from: A, to: B, messages: [], hops: 1, limits }).ok);
  assert.match(checkSend({ from: A, to: null, messages: [], hops: 1, limits }).error, /desconhecido/);
  assert.match(checkSend({ from: A, to: A, messages: [], hops: 1, limits }).error, /si mesmo/);
  assert.match(checkSend({ from: A, to: P, messages: [], hops: 1, limits }).error, /pausado/);
});

test('limites: por hora e profundidade da troca', () => {
  const now = Date.now();
  const sent = [{ from: 'a', createdAt: now - 1000 }, { from: 'a', createdAt: now - 2000 }];
  assert.match(checkSend({ from: A, to: B, messages: sent, hops: 1, limits, now }).error, /por hora/);
  assert.ok(checkSend({ from: A, to: B, messages: [{ from: 'a', createdAt: now - 4_000_000 }], hops: 1, limits, now }).ok);
  assert.match(checkSend({ from: A, to: B, messages: [], hops: 4, limits }).error, /Limite de troca/);
});

test('fila: prioridade primeiro, um por destinatário, respeita espera', () => {
  const now = 1_000_000;
  const q = [
    { id: 1, to: 'b', priority: 'normal', status: 'queued', createdAt: now - 10_000 },
    { id: 2, to: 'b', priority: 'now', status: 'queued', createdAt: now },
    { id: 3, to: 'c', priority: 'low', status: 'queued', createdAt: now - 1000 },          // baixa ainda espera
    { id: 4, to: 'd', priority: 'normal', status: 'delivered', createdAt: now - 99_999 }
  ];
  assert.deepEqual(dueMessages(q, [], now).map(m => m.id), [2]);          // urgente passa na frente; b só pega uma
  assert.deepEqual(dueMessages(q, ['b'], now).map(m => m.id), []);        // b ocupado
  assert.deepEqual(dueMessages(q, [], now + 400_000).map(m => m.id), [2, 3]);
});

test('conversa da troca é a mesma nos dois sentidos; destinatário só vê a mensagem', () => {
  assert.equal(threadKey('b', 'a'), threadKey('a', 'b'));
  const p = inboxPrompt({ body: 'Revise o post X', priority: 'now' }, 'Ana');
  assert.match(p, /Mensagem de Ana, urgente/); assert.match(p, /Revise o post X/);
});
