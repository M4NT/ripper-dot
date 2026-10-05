import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUsageQuery, aggregateUsage, usageCsv, resolveClient, normalizeClient } from '../lib/usage-report.mjs';

const at = s => Date.parse(s);
const events = [
  { at: at('2026-01-01T00:00:00Z'), model: 'm1', charsIn: 40, charsOut: 8, agentId: 'a' },
  { at: at('2026-01-03T23:59:59Z'), model: 'm2', charsIn: 4, charsOut: 4, agentId: null },
  { at: at('2026-01-04T00:00:00Z'), model: 'm1', charsIn: 400, charsOut: 400, agentId: 'a' }
];

test('parseUsageQuery valida e é inclusivo', () => {
  const q = parseUsageQuery({ from: '2026-01-01', to: '2026-01-03', group: 'day' });
  assert.equal(q.until, at('2026-01-04T00:00:00Z') - 1);
  assert.throws(() => parseUsageQuery({ from: '2026-01-03', to: '2026-01-01' }));
  assert.throws(() => parseUsageQuery({ from: '2025-01-01', to: '2026-01-02' }));
  assert.doesNotThrow(() => parseUsageQuery({ from: '2025-01-01', to: '2026-01-01' }));
  assert.throws(() => parseUsageQuery({ from: '2026-01-01', to: '2026-01-02', group: 'x' }));
  assert.throws(() => parseUsageQuery({ from: '1/1/2026', to: '2026-01-02' }));
});

test('aggregateUsage agrupa por dia (com dias vazios), agente e modelo', () => {
  const q = parseUsageQuery({ from: '2026-01-01', to: '2026-01-03', group: 'day' });
  const d = aggregateUsage(events, q);
  assert.deepEqual(d.rows.map(r => [r.key, r.requests]), [['2026-01-01', 1], ['2026-01-02', 0], ['2026-01-03', 1]]);
  assert.deepEqual([d.totals.requests, d.totals.tokensIn, d.totals.tokensOut], [2, 11, 3]);
  const ag = aggregateUsage(events, { ...q, group: 'agent' });
  assert.deepEqual(ag.rows.map(r => r.key).sort(), ['(sem agente)', 'a']);
  const mo = aggregateUsage(events, { ...q, group: 'model' });
  assert.equal(mo.rows.find(r => r.key === 'm1').tokensIn, 10);
  assert.ok(mo.totals.costEstimated);
  const csv = usageCsv(mo, 'model');
  assert.ok(csv.startsWith('﻿modelo;respostas'));
  assert.ok(csv.endsWith('Total;2;11;3;0.0000;sim'));
});

const clients = [
  { id: 'cx', name: 'Cliente X', tag: 'cliente x', projectIds: [] },
  { id: 'cy', name: 'Cliente Y', tag: '', projectIds: ['p1'] }
];

test('resolveClient: tag, projeto ou nenhum', () => {
  assert.equal(resolveClient(clients, { tags: ['Cliente X'] }).id, 'cx');
  assert.equal(resolveClient(clients, { projectId: 'p1' }).id, 'cy');
  assert.equal(resolveClient(clients, { tags: ['outra'], projectId: 'p9' }), null);
  assert.equal(resolveClient([], { tags: ['cliente x'] }), null);
});

test('normalizeClient valida documento', () => {
  assert.equal(normalizeClient({ name: 'A', document: '12.345.678/0001-90' }).document, '12345678000190');
  assert.throws(() => normalizeClient({ name: 'A', document: '123' }));
  assert.throws(() => normalizeClient({ name: ' ' }));
});

test('aggregateUsage por cliente: clientId gravado, fallback por chatId, sem cliente e custo real', () => {
  const q = parseUsageQuery({ from: '2026-01-01', to: '2026-01-03', group: 'client' });
  const t = at('2026-01-02T12:00:00Z');
  const ev = [
    { at: t, model: 'm', charsIn: 4, charsOut: 4, clientId: 'cx', costUsd: 0.5 },
    { at: t, model: 'm', charsIn: 4, charsOut: 4, chatId: 'c1' },
    { at: t, model: 'm', charsIn: 4, charsOut: 4 }
  ];
  const d = aggregateUsage(ev, q, null, { clients, chats: [{ id: 'c1', projectId: 'p1' }] });
  const by = Object.fromEntries(d.rows.map(r => [r.key, r]));
  assert.equal(by.cx.costUsd, 0.5);
  assert.equal(by.cx.costEstimated, false);
  assert.equal(by.cy.requests, 1);
  assert.equal(by[''].requests, 1);
  assert.ok(d.totals.costEstimated);
  assert.ok(usageCsv(d, 'client', k => k || 'Sem cliente').includes('Sem cliente'));
});
