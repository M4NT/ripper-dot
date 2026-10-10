import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  RIPPER_TOOL_CATALOG,
  COMPUTER_INPUT_TOOLS,
  buildRipperBuiltinTools,
  listRipperBuiltinToolNames
} from '../lib/ripper-builtin-tools.mjs';

const agent = { tools: ['computer'], autonomyLevel: 'semi_autonomous' };
const dockerSettings = { computer: { mode: 'docker' } };

test('catálogo: mouse/teclado da VM e screenshot só como último recurso', () => {
  for (const name of COMPUTER_INPUT_TOOLS) {
    assert.ok(RIPPER_TOOL_CATALOG[name], name);
    z.object(RIPPER_TOOL_CATALOG[name].inputSchema);
  }
  assert.match(RIPPER_TOOL_CATALOG.computer_screenshot.description, /ÚLTIMO RECURSO/);
  assert.match(RIPPER_TOOL_CATALOG.computer_screenshot.description, /computer_click/);
  assert.match(RIPPER_TOOL_CATALOG.computer_click.description, /não tire print só para clicar/i);
  assert.match(RIPPER_TOOL_CATALOG.computer_type.description, /não pode ser lembrada/);
  assert.match(RIPPER_TOOL_CATALOG.computer_exec.description, /não tire print no lugar de agir/);
});

test('ferramentas de mouse/teclado entram com computador Docker e somem sem ele', () => {
  const withPc = listRipperBuiltinToolNames(agent, dockerSettings);
  for (const name of COMPUTER_INPUT_TOOLS) assert.ok(withPc.includes(name), name);
  const shotAt = withPc.indexOf('computer_screenshot');
  assert.ok(withPc.indexOf('computer_click') < shotAt, 'click aparece antes do print');
  assert.ok(!listRipperBuiltinToolNames({ tools: ['web'] }, dockerSettings).includes('computer_click'));
  assert.ok(!listRipperBuiltinToolNames(agent, { computer: { mode: 'off' } }).includes('computer_click'));
});

test('somente leitura bloqueia clicar/digitar, mas ainda pode fotografar', () => {
  const names = listRipperBuiltinToolNames({ ...agent, autonomyLevel: 'read_only' }, dockerSettings);
  for (const name of COMPUTER_INPUT_TOOLS) assert.ok(!names.includes(name), name);
  assert.ok(names.includes('computer_screenshot'));
});

test('execute: repassa clique/digitação e avisa se o computador não tem xdotool', async () => {
  const calls = [];
  const computer = {
    click: async a => (calls.push(['click', a]), 'ok-click'),
    type: async a => (calls.push(['type', a]), 'ok-type'),
    key: async a => (calls.push(['key', a]), 'ok-key'),
    move: async a => (calls.push(['move', a]), 'ok-move'),
    scroll: async a => (calls.push(['scroll', a]), 'ok-scroll')
  };
  const tools = buildRipperBuiltinTools(agent, { computer, settings: dockerSettings });
  const run = (n, a) => tools.find(t => t.name === n).execute(a).then(r => r.content[0].text);
  assert.equal(await run('computer_click', { x: 10, y: 20 }), 'ok-click');
  assert.equal(await run('computer_type', { text: 'oi' }), 'ok-type');
  const typeTool = tools.find(t => t.name === 'computer_type');
  await typeTool.execute({ text: 'de novo' }, { toolUseID: 'toolu_abc' });
  assert.equal(calls.at(-1)[1].requestId, 'toolu_abc');
  assert.equal(await run('computer_key', { keys: 'Return' }), 'ok-key');
  assert.equal(await run('computer_move', { x: 1, y: 2 }), 'ok-move');
  assert.equal(await run('computer_scroll', { dy: 3 }), 'ok-scroll');
  assert.deepEqual(calls.map(c => c[0]), ['click', 'type', 'type', 'key', 'move', 'scroll']);

  const local = buildRipperBuiltinTools(agent, { computer: { exec: async () => '' }, settings: dockerSettings });
  const txt = await local.find(t => t.name === 'computer_click').execute({ x: 0, y: 0 });
  assert.match(txt.content[0].text, /não tem mouse\/teclado/);
});
