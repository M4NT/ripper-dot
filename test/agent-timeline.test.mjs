import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentTimeline } from '../lib/agent-timeline.mjs';

const db = { chats: [
  { id: 'c1', title: 'Um', updatedAt: 300, messages: [
    { role: 'user', content: 'oi', at: 100 },
    { role: 'assistant', agentId: 'a', at: 110, steps: [{ tool: 'WebSearch' }, { kind: 'approval' }], timing: { totalMs: 1000 }, costUsd: 0.01 },
    { role: 'assistant', agentId: 'b', at: 120 },
    { role: 'assistant', agentId: 'a', at: 300, error: 'falhou', timing: { totalMs: 3000 } }
  ] },
  { id: 'c2', title: 'Dois', routineId: 'r', updatedAt: 200, messages: [
    { role: 'assistant', agentId: 'a', at: 200, files: ['f'], costUsd: 0.02 },
    { role: 'assistant', agentId: 'a', at: 10 }
  ] }
] };

test('ordena, soma custo, conta falhas e filtra por data', () => {
  const { entries, summary } = agentTimeline(db, 'a', { since: 50 });
  assert.deepEqual(entries.map(e => e.at), [300, 200, 110]);
  assert.deepEqual(entries.map(e => e.kind), ['error', 'routine', 'reply']);
  assert.deepEqual(entries[2].actions, ['WebSearch']);
  assert.equal(entries[1].files, 1);
  assert.equal(entries[0].error, 'falhou');
  assert.equal(summary.replies, 2);
  assert.equal(summary.errors, 1);
  assert.equal(summary.actions, 1);
  assert.ok(Math.abs(summary.costUsd - 0.03) < 1e-9);
  assert.equal(summary.avgMs, 2000);
  assert.equal(agentTimeline(db, 'a').entries.length, 4);
});
