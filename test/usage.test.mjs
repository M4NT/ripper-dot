import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureUsage, recordUsage, usageSummary, accountLimits, checkSendQuota, compactChat,
  contextBreakdown, parseProviderLimitFromError, recordProviderSignal
} from '../lib/usage.mjs';

test('recordUsage acumula por modelo', () => {
  const db = {};
  recordUsage(db, 'claude-sonnet-5-5', { charsIn: 100, charsOut: 50 });
  recordUsage(db, 'claude-sonnet-5-5', { charsIn: 20, charsOut: 10 });
  const s = usageSummary(db);
  assert.equal(s.byModel['claude-sonnet-5-5'].requests, 2);
  assert.equal(s.byModel['claude-sonnet-5-5'].charsIn, 120);
  assert.equal(ensureUsage(db).updatedAt, s.updatedAt);
});

test('accountLimits não inventa cotas nem créditos sem env', () => {
  const db = {};
  for (let i = 0; i < 5; i++) recordUsage(db, 'claude-sonnet-5-5', { charsIn: 10_000, charsOut: 5000, routedBy: 'julia-1' });
  const lim = accountLimits(db, {});
  assert.equal(lim.source, 'ripper_local');
  assert.equal(lim.ripperQuota.rolling5h, null);
  assert.equal(lim.ripperQuota.weekly, null);
  assert.equal(lim.cloudCredits, null);
  assert.equal(lim.juliaRouting.routedRequests, 5);
  assert.equal(lim.juliaRouting.usdAvoidedEst, undefined);
  assert.ok(lim.localUsage.chars5h > 0);
});

test('accountLimits expõe cota Ripper só com env', () => {
  const prev = process.env.RIPPER_LIMIT_5H_CHARS;
  process.env.RIPPER_LIMIT_5H_CHARS = '50000';
  const db = {};
  recordUsage(db, 'codex', { charsIn: 1000, charsOut: 0 });
  const lim = accountLimits(db, {});
  assert.equal(lim.ripperQuota.rolling5h.configured, true);
  assert.ok(lim.ripperQuota.rolling5h.pct >= 0);
  process.env.RIPPER_LIMIT_5H_CHARS = prev;
});

test('checkSendQuota bloqueia no limite configurado', () => {
  const prev = process.env.RIPPER_LIMIT_5H_CHARS;
  process.env.RIPPER_LIMIT_5H_CHARS = '100';
  const db = {};
  recordUsage(db, 'codex', { charsIn: 200, charsOut: 0 });
  const q = checkSendQuota(db);
  assert.equal(q.blocked, true);
  process.env.RIPPER_LIMIT_5H_CHARS = prev;
});

test('checkSendQuota não bloqueia sem limite configurado', () => {
  const prev = process.env.RIPPER_LIMIT_5H_CHARS;
  delete process.env.RIPPER_LIMIT_5H_CHARS;
  const db = {};
  recordUsage(db, 'codex', { charsIn: 999_999, charsOut: 0 });
  assert.equal(checkSendQuota(db).blocked, false);
  process.env.RIPPER_LIMIT_5H_CHARS = prev;
});

test('contextBreakdown só categorias medidas', () => {
  const db = { chats: [{ id: 'c1', messages: [{ role: 'user', content: 'oi' }] }] };
  const ctx = contextBreakdown(db, {}, { chatId: 'c1', measures: {} });
  assert.equal(ctx.hasData, true);
  assert.equal(ctx.categories.some(c => c.id === 'system_tools'), false);
  assert.equal(ctx.categories.find(c => c.id === 'messages').tokens, 1);
});

test('parseProviderLimitFromError detecta rate limit', () => {
  const sig = parseProviderLimitFromError(new Error('rate_limit_error: 429 too many requests'));
  assert.equal(sig.kind, 'rate_limit');
});

test('recordProviderSignal persiste', () => {
  const db = {};
  recordProviderSignal(db, 'anthropic', { kind: 'rate_limit', message: '429' });
  assert.equal(accountLimits(db, {}).providers.length, 1);
});

test('compactChat mantém últimas mensagens', () => {
  const db = { chats: [{ id: 'c1', messages: Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: String(i) })) }] };
  const r = compactChat(db, 'c1', { keepLast: 10 });
  assert.equal(r.removed, 20);
  assert.equal(db.chats[0].messages.length, 10);
});
