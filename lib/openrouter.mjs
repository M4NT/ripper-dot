// Provedores com API compatível com OpenAI (chat/completions + tools), todos com as ferramentas do Ripper:
// OpenRouter (centenas de modelos), OpenAI direto, Gemini (AI Studio) e Ollama (local, grátis).
// Modelos ficam em MODELS como "<prefixo><id>" (or:, oa:, gm:, ol:).
import { z } from 'zod';
import { MODELS } from './router.mjs';
import { buildRipperBuiltinTools } from './ripper-builtin-tools.mjs';
import { describeRipperTool } from './providers.mjs';

const BASE = 'https://openrouter.ai/api/v1';
export const OR_PREFIX = 'or:';

/** paid: entra no consentimento/limite de uso pago. OpenRouter informa o custo real; OpenAI/Gemini: estimado pelos tokens. */
export const COMPAT = {
  openrouter: { prefix: 'or:', label: 'OpenRouter', paid: true, base: () => BASE },
  openai: { prefix: 'oa:', label: 'OpenAI', paid: true, base: () => process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1' },
  gemini: { prefix: 'gm:', label: 'Gemini', paid: true, base: () => process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai' },
  ollama: { prefix: 'ol:', label: 'Ollama', paid: false, noKey: true, base: s => `${String(s?.ollama?.url || 'http://127.0.0.1:11434').replace(/\/+$/, '')}/v1` }
};
export const providerOfModel = model => Object.keys(COMPAT).find(k => String(model).startsWith(COMPAT[k].prefix)) || null;

// US$ por milhão de tokens (entrada/saída), para estimar o gasto de OpenAI e Gemini, que não informam custo.
// ponytail: tabela fixa (preços públicos de 10/2026); desconhecido = estimativa alta, para o limite nunca falhar para menos.
const PRICES = [
  [/^gpt-5(\.\d+)?-nano/, 0.05, 0.4], [/^gpt-5(\.\d+)?-mini/, 0.25, 2], [/^gpt-5/, 1.25, 10],
  [/^gpt-4\.1-nano/, 0.1, 0.4], [/^gpt-4\.1-mini/, 0.4, 1.6], [/^gpt-4\.1/, 2, 8],
  [/^gpt-4o-mini/, 0.15, 0.6], [/^gpt-4o/, 2.5, 10], [/^o4-mini/, 1.1, 4.4], [/^o3/, 2, 8],
  [/^gemini-[\d.]+-flash-lite/, 0.1, 0.4], [/^gemini-[\d.]+-flash/, 0.3, 2.5], [/^gemini-[\d.]+-pro/, 1.25, 10]
];
const priceOf = id => PRICES.find(([re]) => re.test(id)) || [null, 5, 20];
export function estimateCost(id, usage) {
  if (!usage) return 0;
  const [, pin, pout] = priceOf(id);
  return ((usage.prompt_tokens || 0) * pin + (usage.completion_tokens || 0) * pout) / 1e6;
}
const MAX_ROUNDS = 25; // rodadas de ferramenta por turno
const EFFORT = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' };

const headers = key => ({ authorization: `Bearer ${key}`, 'content-type': 'application/json', 'http-referer': 'https://ripper.local', 'x-title': 'Ripper' });

/** Põe os modelos escolhidos em Configurações no registro global (Auto, seletor e políticas passam a vê-los). */
export function syncOpenRouterModels(settings) {
  for (const [prov, c] of Object.entries(COMPAT)) {
    for (const k of Object.keys(MODELS)) if (k.startsWith(c.prefix)) delete MODELS[k];
    const cfg = settings?.[prov];
    if (!cfg || (!c.noKey && !cfg.apiKey)) continue;
    for (const m of cfg.models || []) MODELS[c.prefix + m.id] = { label: m.label || m.id, provider: prov };
  }
}

/** Normaliza o patch de settings.openrouter (a chave mascarada '••••' mantém a atual). */
export function normalizeOpenRouter(b, cur = {}) {
  const models = (Array.isArray(b.models) ? b.models : cur.models || [])
    .filter(m => m && /^[\w.:/-]{1,120}$/.test(m.id))
    .slice(0, 50)
    .map(m => ({ id: m.id, label: String(m.label || m.id).slice(0, 80), tools: m.tools !== false }));
  const url = b.url ?? cur.url;
  return {
    apiKey: b.apiKey === '••••' ? cur.apiKey || '' : String(b.apiKey ?? cur.apiKey ?? '').trim(), models,
    ...(url !== undefined ? { url: /^https?:\/\/[\w.:-]+\/?$/.test(url) ? url : cur.url || '' } : {})
  };
}

/** Testa a conexão de qualquer provedor compatível (lista os modelos com a chave). */
export async function checkCompatKey(prov, settings, apiKey) {
  if (prov === 'openrouter') return checkOpenRouterKey(apiKey);
  const c = COMPAT[prov];
  let r;
  try { r = await fetch(`${c.base(settings)}/models`, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(10_000) }); }
  catch { return { ok: false, error: prov === 'ollama' ? 'Ollama não respondeu. Ele está aberto nesta máquina?' : `Sem resposta do ${c.label}.` }; }
  if (r.status === 401 || r.status === 403 || r.status === 400) return { ok: false, error: 'Chave inválida.' };
  if (!r.ok) return { ok: false, error: `${c.label} respondeu ${r.status}.` };
  return { ok: true };
}

/** Catálogo de modelos (OpenRouter: público com preços; os outros: os que a chave/máquina enxerga). */
export async function compatCatalog(prov, settings) {
  if (prov === 'openrouter') return openRouterCatalog();
  const c = COMPAT[prov], key = settings?.[prov]?.apiKey;
  let r;
  try { r = await fetch(`${c.base(settings)}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(15_000) }); }
  catch { throw new Error(prov === 'ollama' ? 'Ollama não respondeu. Ele está aberto nesta máquina?' : `Sem resposta do ${c.label}.`); }
  if (!r.ok) throw new Error(`${c.label} respondeu ${r.status}.`);
  const { data = [] } = await r.json();
  return data
    .map(m => String(m.id).replace(/^models\//, ''))
    .filter(id => prov !== 'openai' || (/^(gpt-|o\d|chatgpt-)/.test(id) && !/(audio|realtime|transcribe|tts|image|search)/.test(id)))
    .filter(id => prov !== 'gemini' || (/^gemini-/.test(id) && !/(embedding|image|tts|live)/.test(id)))
    .map(id => { const [, i, o] = c.paid ? priceOf(id) : [null, 0, 0]; return { id, label: id, tools: true, priceIn: i, priceOut: o }; })
    .sort((a, b) => a.id.localeCompare(b.id));
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
      if (j.error) throw new Error(j.error.message || 'erro do provedor');
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
  const prov = providerOfModel(model) || 'openrouter', c = COMPAT[prov];
  const key = settings[prov]?.apiKey;
  if (!key && !c.noKey) throw new Error(`${c.label} sem chave: conecte em Configurações → Provedores de IA.`);
  const id = model.slice(c.prefix.length);
  const entry = (settings[prov]?.models || []).find(m => m.id === id);
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
    const extra = prov === 'openrouter' ? {
      ...(EFFORT[effort] ? { reasoning: { effort: EFFORT[effort] } } : {}),
      // pesquisa na web do próprio OpenRouter (equivale ao WebSearch do Claude)
      ...(agent.tools.includes('web') ? { plugins: [{ id: 'web', max_results: 5 }] } : {}),
      usage: { include: true }
    } : {
      // esforço só em modelos de raciocínio (nos outros a OpenAI recusa o parâmetro)
      ...(EFFORT[effort] && /^(o\d|gpt-5|gemini-(2\.5|[3-9]))/.test(id) ? { reasoning_effort: EFFORT[effort] } : {}),
      stream_options: { include_usage: true }
    };
    const res = await fetch(`${c.base(settings)}/chat/completions`, {
      method: 'POST', headers: key ? headers(key) : { 'content-type': 'application/json' }, signal,
      body: JSON.stringify({ model: id, messages, stream: true, tools, ...extra })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const e = new Error((Array.isArray(err) ? err[0] : err)?.error?.message || `${c.label} respondeu ${res.status}.`);
      e.status = res.status;
      throw e;
    }
    let text = '', calls = [];
    for await (const ev of streamCompletion(res)) {
      if (ev.text) { text += ev.text; yield { text: ev.text }; }
      if (ev.done) {
        calls = ev.calls;
        const cost = prov === 'openrouter' ? ev.usage?.cost : c.paid ? estimateCost(id, ev.usage) : 0; // OpenRouter: real; OpenAI/Gemini: estimado
        if (cost > 0) yield { cost };
      }
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
