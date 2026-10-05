import test from 'node:test';
import assert from 'node:assert/strict';
import { runOpenRouter, syncOpenRouterModels, normalizeOpenRouter } from '../lib/openrouter.mjs';
import { MODELS } from '../lib/router.mjs';

const sse = events => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });

test('modelos escolhidos entram no registro só com chave', () => {
  syncOpenRouterModels({ openrouter: { apiKey: '', models: [{ id: 'openai/gpt-5' }] } });
  assert.ok(!MODELS['or:openai/gpt-5']);
  syncOpenRouterModels({ openrouter: { apiKey: 'k', models: [{ id: 'openai/gpt-5', label: 'GPT-5' }] } });
  assert.equal(MODELS['or:openai/gpt-5'].provider, 'openrouter');
  assert.equal(normalizeOpenRouter({ apiKey: '••••' }, { apiKey: 'antiga', models: [] }).apiKey, 'antiga');
});

test('runOpenRouter executa a ferramenta do Ripper e devolve o texto final', async () => {
  const bodies = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return bodies.length === 1
      ? sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'remember', arguments: '{"text":"gosta de ' } }] } }] },
             { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'café"}' } }] } }] }])
      : sse([{ choices: [{ delta: { content: 'Anotado' } }] }, { choices: [{ delta: { content: '!' } }] }]);
  };
  const remembered = [];
  try {
    const evs = [];
    for await (const ev of runOpenRouter({
      agent: { tools: ['memory'] }, model: 'or:openai/gpt-5', effort: 'low', prompt: 'lembra que gosto de café', history: [],
      system: 'sys', settings: { openrouter: { apiKey: 'k', models: [{ id: 'openai/gpt-5' }] } },
      ctx: { remember: async t => remembered.push(t) }
    })) evs.push(ev);
    assert.deepEqual(remembered, ['gosta de café']);
    assert.equal(evs.filter(e => e.text).map(e => e.text).join(''), 'Anotado!');
    assert.ok(evs.some(e => e.tool === 'remember'));
    assert.equal(bodies[0].tools[0].function.name, 'remember');
    assert.equal(bodies[1].messages.at(-1).role, 'tool');
  } finally { globalThis.fetch = orig; }
});
