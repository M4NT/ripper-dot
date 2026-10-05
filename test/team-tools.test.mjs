import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRipperBuiltinTools } from '../lib/ripper-builtin-tools.mjs';

test('create_agent e create_group só aparecem com ctx.team e repassam os dados', async () => {
  const agent = { tools: ['web'] };
  assert.ok(!buildRipperBuiltinTools(agent, {}).some(t => t.name === 'create_agent'), 'canal externo (sem ctx.team) não cria agentes');
  const calls = [];
  const team = { createAgent: async a => (calls.push(['agent', a.name]), 'ok-agente'), createGroup: a => (calls.push(['grupo', a.members.length]), 'ok-grupo') };
  const tools = buildRipperBuiltinTools(agent, { team });
  const run = (n, a) => tools.find(t => t.name === n).execute(a).then(r => r.content[0].text);
  assert.equal(await run('create_agent', { name: 'Quinn', instructions: 'QA' }), 'ok-agente');
  assert.equal(await run('create_group', { title: 'Engenharia', members: ['Donald', 'Quinn'] }), 'ok-grupo');
  assert.deepEqual(calls, [['agent', 'Quinn'], ['grupo', 2]]);
});
