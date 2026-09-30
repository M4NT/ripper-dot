import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureUsage, recordUsage, usageSummary, accountLimits, checkSendQuota, compactChat } from '../lib/usage.mjs';

test('recordUsage acumula por modelo', () => {
  const db = {};
  recordUsage(db, 'claude-sonnet-5-5', { charsIn: 100, charsOut: 50 });
  recordUsage(db, 'claude-sonnet-5-5', { charsIn: 20, charsOut: 10 });
  const s = usageSummary(db);
  assert.equal(s.byModel['claude-sonnet-5-5'].requests, 2);
  assert.equal(s.byModel['claude-sonnet-5-5'].charsIn, 120);
  assert.equal(ensureUsage(db).updatedAt, s.updatedAt);
});

test('accountLimits agrega janelas', () => {
  const db = {};
  for (let i = 0; i < 5; i++) recordUsage(db, 'claude-sonnet-5-5', { charsIn: 10_000, charsOut: 5000, routedBy: 'julia-1' });
  const lim = accountLimits(db, {});
  assert.ok(lim.rolling5h.pct >= 0);
  assert.ok(lim.weekly.pct >= 0);
  assert.equal(lim.source, 'local_aggregate');
  assert.ok(lim.juliaSavings.routedRequests >= 5);
});

test('checkSendQuota bloqueia no limite', () => {
  const prev = process.env.RIPPER_LIMIT_5H_CHARS;
  process.env.RIPPER_LIMIT_5H_CHARS = '100';
  const db = {};
  recordUsage(db, 'codex', { charsIn: 200, charsOut: 0 });
  const q = checkSendQuota(db);
  assert.equal(q.blocked, true);
  process.env.RIPPER_LIMIT_5H_CHARS = prev;
});

test('compactChat mantém últimas mensagens', () => {
  const db = { chats: [{ id: 'c1', messages: Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: String(i) })) }] };
  const r = compactChat(db, 'c1', { keepLast: 10 });
  assert.equal(r.removed, 20);
  assert.equal(db.chats[0].messages.length, 10);
});
