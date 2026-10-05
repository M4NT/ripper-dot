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
