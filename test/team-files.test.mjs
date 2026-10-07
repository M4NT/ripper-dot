import test from 'node:test';
import assert from 'node:assert/strict';
import { canUseFile } from '../lib/agent-flow.mjs';
import { buildRipperBuiltinTools } from '../lib/ripper-builtin-tools.mjs';

const pincel = { id: 'pincel' }, chat = { id: 'c1' };

test('arquivo "do time" vale para qualquer agente; os outros continuam de quem são', () => {
  assert.equal(canUseFile({ agentId: 'maestro' }, pincel, chat), false);
  assert.equal(canUseFile({ agentId: 'maestro', team: true }, pincel, chat), true);
  assert.equal(canUseFile({ agentId: 'pincel' }, pincel, chat), true);
  assert.equal(canUseFile({ agentId: 'x', projectId: 'p' }, pincel, { projectId: 'p' }), true);
});

test('share_with_team: para quem lida com arquivos ou imagens, e chama o servidor', async () => {
  const shared = [];
  const ctx = { settings: {}, shareWithTeam: a => (shared.push(a.name), 'ok') };
  const names = agent => buildRipperBuiltinTools(agent, ctx).map(t => t.name);
  assert.ok(names({ tools: ['images'] }).includes('share_with_team'));
  assert.ok(names({ tools: ['files'] }).includes('share_with_team'));
  assert.ok(!names({ tools: ['web'] }).includes('share_with_team'));
  await buildRipperBuiltinTools({ tools: ['files'] }, ctx).find(t => t.name === 'share_with_team').execute({ name: 'logo.png' });
  assert.deepEqual(shared, ['logo.png']);
});
