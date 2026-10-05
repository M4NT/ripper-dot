import test from 'node:test';
import assert from 'node:assert/strict';
import { agentDayStats } from '../lib/agent-day-stats.mjs';

test('agentDayStats soma por agente e ignora mensagens antigas', () => {
  const catalog = { models: { m: { costPerMillionInput: 1e6, costPerMillionOutput: 0 } } };
  const events = [{ agentId: 'a', model: 'm', charsIn: 40, charsOut: 8 }, { agentId: null, model: 'm', charsIn: 4, charsOut: 4 }];
  const chats = [{ messages: [
    { role: 'assistant', agentId: 'a', at: 100, timing: { totalMs: 1000 } },
    { role: 'assistant', agentId: 'a', at: 100, timing: { totalMs: 3000 } },
    { role: 'assistant', agentId: 'a', at: 5, timing: { totalMs: 9e9 } }
  ] }];
  assert.deepEqual(agentDayStats(events, chats, 50, catalog), { a: { turns: 1, tokens: 12, usd: 10, avgMs: 2000 } });
});
