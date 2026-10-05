// OpenRouter: uma chave, centenas de modelos (GPT, Gemini, DeepSeek, Llama…), com as ferramentas do Ripper.
// API compatível com OpenAI (chat/completions + tools). Modelos ficam em MODELS como "or:<id>".
import { z } from 'zod';
import { MODELS } from './router.mjs';
import { buildRipperBuiltinTools } from './ripper-builtin-tools.mjs';
import { describeRipperTool } from './providers.mjs';

const BASE = 'https://openrouter.ai/api/v1';
export const OR_PREFIX = 'or:';
const MAX_ROUNDS = 25; // rodadas de ferramenta por turno
const EFFORT = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' };

const headers = key => ({ authorization: `Bearer ${key}`, 'content-type': 'application/json', 'http-referer': 'https://ripper.local', 'x-title': 'Ripper' });

/** Põe os modelos escolhidos em Configurações no registro global (Auto, seletor e políticas passam a vê-los). */
export function syncOpenRouterModels(settings) {
  for (const k of Object.keys(MODELS)) if (k.startsWith(OR_PREFIX)) delete MODELS[k];
  if (!settings?.openrouter?.apiKey) return;
  for (const m of settings.openrouter.models || []) MODELS[OR_PREFIX + m.id] = { label: m.label || m.id, provider: 'openrouter' };
}

/** Normaliza o patch de settings.openrouter (a chave mascarada '••••' mantém a atual). */
export function normalizeOpenRouter(b, cur = {}) {
  const models = (Array.isArray(b.models) ? b.models : cur.models || [])
    .filter(m => m && /^[\w.:/-]{1,120}$/.test(m.id))
    .slice(0, 50)
    .map(m => ({ id: m.id, label: String(m.label || m.id).slice(0, 80), tools: m.tools !== false }));
  return { apiKey: b.apiKey === '••••' ? cur.apiKey || '' : String(b.apiKey ?? cur.apiKey ?? '').trim(), models };
}

export async function checkOpenRouterKey(apiKey) {
  const r = await fetch(`${BASE}/key`, { headers: headers(apiKey), signal: AbortSignal.timeout(10_000) });
  if (r.status === 401) return { ok: false, error: 'Chave inválida.' };
  if (!r.ok) return { ok: false, error: `OpenRouter respondeu ${r.status}.` };
  const { data } = await r.json();
  return { ok: true, label: data?.label, usage: data?.usage, limit: data?.limit };
}

/** Catálogo público de modelos (só os que aceitam ferramentas servem para agentes). */
export async function openRouterCatalog() {
  const r = await fetch(`${BASE}/models`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`OpenRouter respondeu ${r.status}.`);
  const { data } = await r.json();
  return data.map(m => ({
    id: m.id, label: m.name, context: m.context_length,
    tools: (m.supported_parameters || []).includes('tools'),
    priceIn: +m.pricing?.prompt * 1e6 || 0, priceOut: +m.pricing?.completion * 1e6 || 0
  }));
}

/** Ferramentas do Ripper no formato OpenAI (schema JSON a partir do zod). */
export function openAiTools(defs) {
  return defs.map(d => ({ type: 'function', function: { name: d.name, description: d.description, parameters: z.toJSONSchema(z.object(d.inputSchema)) } }));
}

/** Lê o SSE do chat/completions: texto vai saindo; tool_calls chegam em pedaços e são montadas. */
async function* streamCompletion(res) {
  const dec = new TextDecoder();
  let buf = '';
  const calls = [];
  let usage = null;
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue; // ": OPENROUTER PROCESSING" e afins
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      const j = JSON.parse(data);
      if (j.error) throw new Error(j.error.message || 'erro do OpenRouter');
      if (j.usage) usage = j.usage;
      const d = j.choices?.[0]?.delta;
      if (d?.content) yield { text: d.content };
      for (const tc of d?.tool_calls || []) {
        const c = (calls[tc.index ?? 0] ||= { id: '', name: '', args: '' });
        if (tc.id) c.id = tc.id;
        if (tc.function?.name) c.name += tc.function.name;
        if (tc.function?.arguments) c.args += tc.function.arguments;
      }
    }
  }
  yield { done: true, calls: calls.filter(Boolean), usage };
}

export async function* runOpenRouter({ agent, model, effort, prompt, images = [], history, system, settings, ctx, signal }) {
  const key = settings.openrouter?.apiKey;
  if (!key) throw new Error('OpenRouter sem chave: conecte em Configurações → Provedores de IA.');
  const id = model.slice(OR_PREFIX.length);
  const entry = (settings.openrouter.models || []).find(m => m.id === id);
  const defs = entry?.tools === false ? [] : buildRipperBuiltinTools(agent, ctx);
  const tools = defs.length ? openAiTools(defs) : undefined;
  const user = images.length
    ? [{ type: 'text', text: prompt }, ...images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mediaType};base64,${i.data}` } }))]
    : prompt;
  const messages = [
    { role: 'system', content: system },
    ...history.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })),
    { role: 'user', content: user }
  ];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST', headers: headers(key), signal,
      body: JSON.stringify({
        model: id, messages, stream: true, tools,
        ...(EFFORT[effort] ? { reasoning: { effort: EFFORT[effort] } } : {}),
        // pesquisa na web do próprio OpenRouter (equivale ao WebSearch do Claude)
        ...(agent.tools.includes('web') ? { plugins: [{ id: 'web', max_results: 5 }] } : {}),
        usage: { include: true }
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const e = new Error(err.error?.message || `OpenRouter respondeu ${res.status}.`);
      e.status = res.status;
      throw e;
    }
    let text = '', calls = [];
    for await (const ev of streamCompletion(res)) {
      if (ev.text) { text += ev.text; yield { text: ev.text }; }
      if (ev.done) { calls = ev.calls; if (ev.usage?.cost > 0) yield { cost: ev.usage.cost }; } // custo real em US$
    }
    if (!calls.length) return;
    messages.push({ role: 'assistant', content: text || null, tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } })) });
    for (const c of calls) {
      let args = {};
      try { args = JSON.parse(c.args || '{}'); } catch {}
      yield describeRipperTool(c.name, args);
      const def = defs.find(d => d.name === c.name);
      let out;
      try {
        out = def ? (await def.execute(args)).content.map(p => p.text).join('\n') : `Ferramenta ${c.name} não existe.`;
      } catch (e) { out = `Erro: ${e.message}`; }
      messages.push({ role: 'tool', tool_call_id: c.id, content: String(out).slice(0, 60_000) });
    }
  }
  yield { text: '\n\n(Parei: muitas rodadas de ferramentas neste pedido.)' };
}
