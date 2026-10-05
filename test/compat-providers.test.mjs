import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOpenRouter, syncOpenRouterModels, estimateCost, compatCatalog, checkCompatKey } from '../lib/openrouter.mjs';
import { MODELS } from '../lib/router.mjs';
import { isPaidModel } from '../lib/paid-usage.mjs';

const sse = events => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n');

async function run(model, settings, effort = 'low') {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return sse([{ choices: [{ delta: { content: 'oi' } }] }, { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 1000 } }]);
  };
  const evs = [];
  try { for await (const ev of runOpenRouter({ agent: { tools: [] }, model, effort, prompt: 'oi', history: [], system: 's', settings, ctx: {} })) evs.push(ev); }
  finally { globalThis.fetch = orig; }
  return { call: calls[0], evs };
}

test('OpenAI: endpoint da OpenAI, esforço só em modelo de raciocínio, custo estimado pelos tokens', async () => {
  const s = { openai: { apiKey: 'sk-x', models: [{ id: 'gpt-5-mini' }, { id: 'gpt-4o-mini' }] } };
  let { call, evs } = await run('oa:gpt-5-mini', s);
  assert.match(call.url, /api\.openai\.com\/v1\/chat\/completions/);
  assert.equal(call.body.model, 'gpt-5-mini');
  assert.equal(call.body.reasoning_effort, 'low');
  assert.equal(call.body.plugins, undefined, 'plugin web é só do OpenRouter');
  assert.ok(Math.abs(evs.find(e => e.cost).cost - (1000 * 0.25 + 1000 * 2) / 1e6) < 1e-12);
  ({ call } = await run('oa:gpt-4o-mini', s));
  assert.equal(call.body.reasoning_effort, undefined, 'gpt-4o recusa reasoning_effort');
});

test('Gemini usa o endpoint compatível do AI Studio; Ollama local sem chave e sem custo', async () => {
  let { call } = await run('gm:gemini-2.5-flash', { gemini: { apiKey: 'AIza', models: [] } });
  assert.match(call.url, /generativelanguage\.googleapis\.com\/v1beta\/openai\/chat\/completions/);
  const r = await run('ol:qwen3', { ollama: { url: 'http://127.0.0.1:11434', models: [{ id: 'qwen3' }] } });
  assert.equal(r.call.url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(r.call.headers.authorization, undefined);
  assert.equal(r.evs.some(e => e.cost), false);
});

test('registro de modelos, uso pago e preço desconhecido estimado alto', () => {
  syncOpenRouterModels({ openai: { apiKey: 'k', models: [{ id: 'gpt-5' }] }, gemini: { apiKey: '', models: [{ id: 'gemini-2.5-pro' }] }, ollama: { models: [{ id: 'llama3.1' }] } });
  assert.equal(MODELS['oa:gpt-5'].provider, 'openai');
  assert.equal(MODELS['gm:gemini-2.5-pro'], undefined, 'sem chave, não registra');
  assert.equal(MODELS['ol:llama3.1'].provider, 'ollama', 'Ollama não precisa de chave');
  assert.equal(isPaidModel('oa:gpt-5', {}), true);
  assert.equal(isPaidModel('ol:llama3.1', {}), false);
  assert.ok(estimateCost('modelo-novo', { prompt_tokens: 1e6, completion_tokens: 0 }) >= 5);
});

test('catálogo: OpenAI só modelos de chat; Gemini tira o prefixo models/; Ollama fora do ar explica', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async url => /openai\.com/.test(url)
    ? Response.json({ data: [{ id: 'gpt-5' }, { id: 'gpt-4o-realtime-preview' }, { id: 'whisper-1' }, { id: 'o4-mini' }] })
    : /googleapis/.test(url) ? Response.json({ data: [{ id: 'models/gemini-2.5-flash' }, { id: 'models/text-embedding-004' }] })
    : Promise.reject(new Error('ECONNREFUSED'));
  try {
    assert.deepEqual((await compatCatalog('openai', { openai: { apiKey: 'k' } })).map(m => m.id), ['gpt-5', 'o4-mini']);
    assert.deepEqual((await compatCatalog('gemini', { gemini: { apiKey: 'k' } })).map(m => m.id), ['gemini-2.5-flash']);
    await assert.rejects(compatCatalog('ollama', {}), /Ollama não respondeu/);
    assert.match((await checkCompatKey('ollama', {})).error, /Ollama não respondeu/);
  } finally { globalThis.fetch = orig; }
});

test('plugins MCP do usuário também nos provedores compatíveis: o modelo chama a ferramenta e recebe o resultado; plugin fora do ar só avisa', async () => {
  const { fileURLToPath } = await import('node:url');
  const fixture = fileURLToPath(new URL('./fixtures/mcp-stdio-minimal.mjs', import.meta.url));
  const bodies = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return bodies.length === 1
      ? sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 't1', function: { name: 'mcp__Meu_Plugin__ping', arguments: '{}' } }] } }] }])
      : sse([{ choices: [{ delta: { content: 'feito' } }] }]);
  };
  const evs = [];
  try {
    for await (const ev of runOpenRouter({
      agent: { tools: ['plugins'] }, model: 'ol:qwen3', effort: 'low', prompt: 'pinga', history: [], system: 's', ctx: {},
      settings: { ollama: { models: [{ id: 'qwen3' }] }, plugins: [
        { name: 'Meu Plugin', type: 'stdio', command: process.execPath, args: [fixture] },
        { name: 'quebrado', type: 'stdio', command: 'comando-que-nao-existe-xyz' }
      ] }
    })) evs.push(ev);
  } finally { globalThis.fetch = orig; }
  assert.ok(bodies[0].tools.some(t => t.function.name === 'mcp__Meu_Plugin__ping'), 'ferramenta do plugin oferecida ao modelo');
  assert.equal(bodies[1].messages.at(-1).role, 'tool');
  assert.equal(bodies[1].messages.at(-1).content, 'ok', 'resultado real do plugin volta ao modelo');
  assert.ok(evs.some(e => e.warn && /quebrado/.test(e.warn)), 'plugin fora do ar vira aviso');
  assert.equal(evs.filter(e => e.text).map(e => e.text).join(''), 'feito');
});

test('sem a habilidade Plugins, nenhum plugin é conectado', async () => {
  const bodies = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => { bodies.push(JSON.parse(init.body)); return sse([{ choices: [{ delta: { content: 'oi' } }] }]); };
  try {
    for await (const _ of runOpenRouter({ agent: { tools: [] }, model: 'ol:qwen3', prompt: 'oi', history: [], system: 's', ctx: {},
      settings: { ollama: { models: [{ id: 'qwen3' }] }, plugins: [{ name: 'x', type: 'stdio', command: 'nao-deveria-rodar' }] } })) {}
  } finally { globalThis.fetch = orig; }
  assert.equal(bodies[0].tools, undefined);
});
