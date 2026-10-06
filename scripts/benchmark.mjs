// "Termina sozinho" (critério 1 do norte): roda as 50 tarefas de docs/tarefas-referencia.json num agente
// e grava, por tarefa, passou / precisou-de-ajuda / falhou + tempo + tokens (estimados por caracteres ÷ 4).
//
//   node scripts/benchmark.mjs                 → dry-run: servidor próprio com o provedor de teste (não gasta nada)
//   node scripts/benchmark.mjs --limit 5       → só as 5 primeiras
//   RIPPER_TOKEN=... node scripts/benchmark.mjs --real --url http://127.0.0.1:3000 [--agent <id>]
//                                              → servidor e agente de verdade (gasta assinatura/tokens)
// Relatório: docs/benchmark/<data>.json (ou --out <arquivo>). Pedido de aprovação ou pergunta ao dono =
// "precisou de ajuda": o benchmark nega/responde "decida sozinho" para o agente seguir, e registra.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({ options: {
  real: { type: 'boolean', default: false }, url: { type: 'string' }, agent: { type: 'string' },
  limit: { type: 'string' }, out: { type: 'string' }, timeout: { type: 'string', default: '600' }
} });
if (opt.real && !opt.url) { console.error('--real exige --url do servidor (e RIPPER_TOKEN no ambiente).'); process.exit(2); }

const root = fileURLToPath(new URL('..', import.meta.url));
const { tarefas } = JSON.parse(readFileSync(join(root, 'docs/tarefas-referencia.json'), 'utf8'));
const list = opt.limit ? tarefas.slice(0, +opt.limit) : tarefas;

let server, base = opt.url?.replace(/\/$/, ''), token = process.env.RIPPER_TOKEN || '';
if (!opt.real) {
  const port = await new Promise(r => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-bench-'));
  token = 'bench-' + Math.random().toString(36).slice(2);
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [join(root, 'server.mjs')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RIPPER_DATA: dataDir, RIPPER_TEST_PROVIDER: 'stream', RIPPER_TOKEN: token, HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0' },
    stdio: ['ignore', 'ignore', 'inherit']
  });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
}
const api = (path, o = {}) => fetch(base + path, { ...o, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: base, ...o.headers } });
const usedChars = async () => Object.values((await (await api('/api/state')).json()).usage?.byModel || {}).reduce((n, r) => n + (r.charsIn || 0) + (r.charsOut || 0), 0);

/** Classifica a resposta final: verificar = regex que a resposta precisa conter. */
export function classify({ text, error, helped, verificar }) {
  if (error || !text?.trim()) return 'falhou';
  if (helped) return 'precisou-de-ajuda';
  return verificar.every(rx => new RegExp(rx, 'i').test(text)) ? 'passou' : 'falhou';
}

async function runTask(t, agentId) {
  const t0 = Date.now(), chars0 = await usedChars();
  const ctl = AbortSignal.timeout(+opt.timeout * 1000);
  let text = '', error = null, helped = 0;
  try {
    const res = await api('/api/chat', { method: 'POST', body: JSON.stringify({ agentId, text: t.prompt }), signal: ctl });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const dec = new TextDecoder(); let buf = '';
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      const parts = buf.split('\n\n'); buf = parts.pop();
      for (const p of parts) {
        if (!p.startsWith('data: ')) continue;
        const e = JSON.parse(p.slice(6));
        if (e.speaker || e.turnDone) continue;
        if (typeof e.text === 'string') text += e.text;
        if (e.error) error = e.error;
        if (e.approval) { // ninguém responde num benchmark: o agente precisa seguir sem o dono
          helped++;
          const body = e.approval.kind === 'question' ? { answer: 'Não posso responder agora. Decida sozinho e siga.' } : { approve: false };
          await api(`/api/approvals/${e.approval.id}`, { method: 'POST', body: JSON.stringify(body) }).catch(() => {});
        }
      }
    }
  } catch (e) { error = e.message; }
  const status = classify({ text, error, helped, verificar: t.verificar });
  return { id: t.id, titulo: t.titulo, categoria: t.categoria, status, segundos: +((Date.now() - t0) / 1000).toFixed(1),
    tokensEstimados: Math.round((await usedChars().catch(() => chars0) - chars0) / 4), pedidosDeAjuda: helped, ...(error ? { erro: String(error).slice(0, 300) } : {}),
    resposta: text.slice(0, 500) };
}

let code = 0;
try {
  const st = await (await api('/api/state')).json();
  const agentId = opt.agent || st.agents?.[0]?.id;
  if (!agentId) throw new Error('nenhum agente no servidor');
  const results = [];
  for (const t of list) {
    const r = await runTask(t, agentId);
    results.push(r);
    console.log(`${r.id} ${r.status.padEnd(18)} ${String(r.segundos).padStart(6)}s ${String(r.tokensEstimados).padStart(7)} tok  ${r.titulo}`);
  }
  const count = s => results.filter(r => r.status === s).length;
  const resumo = { total: results.length, passou: count('passou'), precisouDeAjuda: count('precisou-de-ajuda'), falhou: count('falhou'),
    terminaSozinho: +(count('passou') / results.length * 100).toFixed(1), segundosTotal: +results.reduce((n, r) => n + r.segundos, 0).toFixed(1),
    tokensEstimados: results.reduce((n, r) => n + r.tokensEstimados, 0) };
  const report = { quando: new Date().toISOString(), modo: opt.real ? 'real' : 'dry-run (provedor de teste)', servidor: opt.real ? base : 'local temporário', agentId, resumo, resultados: results };
  const out = opt.out || join(root, 'docs/benchmark', `${report.quando.slice(0, 10)}${opt.real ? '' : '-dry'}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`\nTermina sozinho: ${resumo.terminaSozinho}% (${resumo.passou}/${resumo.total}), ajuda: ${resumo.precisouDeAjuda}, falhou: ${resumo.falhou}\nRelatório: ${out}`);
} catch (e) { console.error('benchmark:', e.message); code = 1; }
finally { server?.kill(); }
process.exit(code);
