// Mede a 1ª palavra com e sem processo pré-aquecido. Uso: node scripts/bench-prewarm.mjs
import { runClaude, systemPrompt } from '../lib/providers.mjs';
import { closeSpares } from '../lib/claude-prewarm.mjs';
const agent = { id: 'bench', name: 'Bench', tools: [] };
const settings = { claude: { mode: 'subscription' }, computer: { mode: 'off' }, plugins: [], defaults: { agentStyle: {} } };
const systemStable = systemPrompt(agent, settings);
for (const n of [1, 2, 3, 4]) {
  const t0 = Date.now(); let first = null, out = '';
  for await (const ev of runClaude({ agent, model: 'claude-haiku-4-5', effort: 'low', prompt: `Diga só: ok ${n}`, history: [], system: `${systemStable}\n\nHoje é teste ${n}.`, systemStable, settings, ctx: {} })) {
    if (ev.text) { first ??= Date.now() - t0; out += ev.text; }
  }
  console.log(`turno ${n}: 1ª palavra ${first}ms, total ${Date.now() - t0}ms →`, out.trim());
  await new Promise(r => setTimeout(r, 8000)); // tempo para o próximo processo aquecer
}
closeSpares(); process.exit(0);
