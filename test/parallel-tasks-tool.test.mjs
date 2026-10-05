import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRipperBuiltinTools } from '../lib/ripper-builtin-tools.mjs';

test('parallel_tasks só aparece com ctx.parallel e repassa as tarefas', async () => {
  const agent = { tools: [] };
  assert.ok(!buildRipperBuiltinTools(agent, {}).some(t => t.name === 'parallel_tasks'));
  const tool = buildRipperBuiltinTools(agent, { parallel: { run: async ts => ts.map(t => t.title).join('+') } }).find(t => t.name === 'parallel_tasks');
  const r = await tool.execute({ tasks: [{ title: 'a', prompt: 'x' }, { title: 'b', prompt: 'y' }] });
  assert.equal(r.content[0].text, 'a+b');
});
