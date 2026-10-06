import test from 'node:test';
import assert from 'node:assert/strict';
import { isPaidModel, paidBlockReason, addSpend, normalizeBilling } from '../lib/paid-usage.mjs';
import { buildInbox } from '../lib/inbox-feed.mjs';
import { MODELS } from '../lib/router.mjs';

test('assinatura não é paga; OpenRouter e Claude por API key são', () => {
  MODELS['or:x/y'] = { label: 'Y', provider: 'openrouter' };
  assert.equal(isPaidModel('claude-sonnet-5-5', { claude: { mode: 'subscription' } }), false);
  assert.equal(isPaidModel('claude-sonnet-5-5', { claude: { mode: 'api' } }), true);
  assert.equal(isPaidModel('or:x/y', { claude: { mode: 'subscription' } }), true);
  delete MODELS['or:x/y'];
});

test('sem consentimento bloqueia; limite por agente e total pausam o gasto', () => {
  const db = {}, now = Date.now();
  assert.match(paidBlockReason(db, { billing: {} }, 'a', now), /não autorizado/);
  const settings = { billing: normalizeBilling({ paidConsent: true, perAgentDailyUsd: 1, totalDailyUsd: 1.5 }) };
  assert.ok(settings.billing.paidConsentAt);
  assert.equal(paidBlockReason(db, settings, 'a', now), null);
  assert.equal(addSpend(db, settings, 'a', 0.6, now), null);
  assert.equal(addSpend(db, settings, 'a', 0.5, now), 'agent');
  assert.match(paidBlockReason(db, settings, 'a', now), /deste agente/);
  assert.equal(paidBlockReason(db, settings, 'b', now), null);
  assert.equal(addSpend(db, settings, 'b', 0.5, now), 'total');
  assert.match(paidBlockReason(db, settings, 'b', now), /todos os agentes/);
  assert.equal(paidBlockReason(db, settings, 'b', now + 86_400_000 * 2), null, 'zera em outro dia');
  assert.equal(normalizeBilling({ paidConsent: false }, settings.billing).paidConsentAt, null);
});

test('aviso de limite aparece na Caixa como urgente', () => {
  const db = { agents: [{ id: 'a', name: 'Ana' }], spendAlerts: [{ id: 's1', agentId: 'a', which: 'agent', limitUsd: 2, at: 1 }] };
  const it = buildInbox(db).items[0];
  assert.deepEqual([it.kind, it.agentName, it.urgent], ['spend', 'Ana', true]);
});

test('dois processos no mesmo SQLite somam o gasto (não subcontam)', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { useSpendStore, closeSpendStore, spendToday } = await import('../lib/paid-usage.mjs');
  const file = join(mkdtempSync(join(tmpdir(), 'spend-')), 'spend.sqlite');
  const settings = { billing: { paidConsentAt: 1, perAgentDailyUsd: 1, totalDailyUsd: 10 } };
  const now = Date.now();
  useSpendStore(file);
  const a = {}, b = {}; // duas cópias do db.json, como em dois servidores
  addSpend(a, settings, 'x', 0.6, now);
  assert.equal(addSpend(b, settings, 'x', 0.5, now), 'agent', 'o segundo vê o gasto do primeiro');
  assert.equal(spendToday(a, now).total, 1.1);
  closeSpendStore();
});
