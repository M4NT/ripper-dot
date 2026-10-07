// Qualidade da conversa: roda os 10 cenários de docs/conversas-referencia.json e pontua cada um com checagens
// explícitas (primeiro sinal, respondeu o ponto, fecho Feito/Como verifiquei/Falta, delegação, Caixa, nada vazado).
//
//   node scripts/conversas.mjs                  → dry-run: servidor próprio, dados isolados, provedor de teste (não gasta nada)
//   node scripts/conversas.mjs --ids c01,c05    → só esses cenários
//   RIPPER_TOKEN=... node scripts/conversas.mjs --real --url http://127.0.0.1:3000
//                                               → servidor de verdade (gasta assinatura). Cria agentes "<Nome>Bench" e apaga no fim.
// Relatório: docs/benchmark/conversas-<data>[-dry].json (ou --out). No dry-run as respostas são eco do provedor
// de teste: a nota mede o encanamento, não a qualidade.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({ options: {
  real: { type: 'boolean', default: false }, url: { type: 'string' }, ids: { type: 'string' },
  out: { type: 'string' }, timeout: { type: 'string', default: '600' }
} });
if (opt.real && !opt.url) { console.error('--real exige --url do servidor (e RIPPER_TOKEN no ambiente).'); process.exit(2); }

const root = fileURLToPath(new URL('..', import.meta.url));
const ref = JSON.parse(readFileSync(join(root, 'docs/conversas-referencia.json'), 'utf8'));
const only = opt.ids?.split(',').map(s => s.trim());
const list = only ? ref.cenarios.filter(c => only.includes(c.id)) : ref.cenarios;
const SUFIXO = 'Bench'; // evita colidir com agentes do dono no --real (e o @Nome do roteiro vira @NomeBench)

/** Notas internas que não podem aparecer para o dono. */
export const VAZAMENTOS = {
  monologoIngles: /(^|[.\n]\s*)(Now|Let me|I'll|I will|I need to|I'm going to|First,? I|Next,? I)\b/,
  marcadores: /\[\?\]/,
  idsDeFerramenta: /\btoolu_[A-Za-z0-9]+|\bcall_[A-Za-z0-9]{8,}|\bmcp__\w+/
};

/** Pontua um cenário a partir do que foi observado. Retorna [{ nome, ok, detalhe? }]. */
export function score(c, o, limites) {
  const e = c.espera || {}, rx = s => new RegExp(s, 'i'), checks = [];
  const add = (nome, ok, detalhe) => checks.push({ nome, ok: !!ok, ...(detalhe ? { detalhe } : {}) });
  add('primeiro sinal', o.primeiroSinalSeg != null && o.primeiroSinalSeg <= limites.primeiroSinalSeg, `${o.primeiroSinalSeg ?? '—'} s`);
  add('primeiro texto', o.primeiroTextoSeg != null && o.primeiroTextoSeg <= limites.primeiroTextoSeg, `${o.primeiroTextoSeg ?? '—'} s`);
  add('sem erro', !o.erro, o.erro);
  add('respondeu o ponto', o.texto.trim() && (e.responder || []).every(s => rx(s).test(o.texto)));
  if (e.proibido) add('não inventou / não ignorou', !e.proibido.some(s => rx(s).test(o.texto)));
  if (e.maxCaracteres) add('curto', o.texto.length <= e.maxCaracteres, `${o.texto.length} car.`);
  if (e.vouAntesDasFerramentas) add('"Vou…" antes das ferramentas', o.ferramentas > 0 && /^\s*Vou\b[^\n]*$/.test(o.antesDaFerramenta.trim()), o.antesDaFerramenta.slice(0, 80));
  if (e.fecho) add('fecho Feito/Como verifiquei/Falta', /Feito/i.test(o.texto) && /Como verifiquei/i.test(o.texto) && /Falta/i.test(o.texto));
  if (e.delegacaoPara) add('delegação registrada', o.delegacoes.includes(e.delegacaoPara + SUFIXO));
  for (const n of e.respondem || []) add(`${n} respondeu`, o.falaram.includes(n + SUFIXO));
  for (const n of e.calados || []) add(`${n} ficou calado`, !o.falaram.includes(n + SUFIXO));
  if (e.caixa) add('bloqueio → Caixa', o.caixa);
  for (const [k, r] of Object.entries(VAZAMENTOS)) add(`sem vazamento (${k})`, !r.test(o.texto));
  return checks;
}

let server, base = opt.url?.replace(/\/$/, ''), token = process.env.RIPPER_TOKEN || '';
if (!opt.real) {
  const port = await new Promise(r => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-conversas-'));
  token = 'conv-' + Math.random().toString(36).slice(2);
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [join(root, 'server.mjs')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RIPPER_DATA: dataDir, RIPPER_TEST_PROVIDER: 'stream', RIPPER_TOKEN: token, HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0' },
    stdio: ['ignore', 'ignore', 'inherit']
  });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
}
const api = (path, o = {}) => fetch(base + path, { ...o, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: base, ...o.headers } });
const json = async (path, o) => { const r = await api(path, o); if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`); return r.json(); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Manda uma mensagem e lê o SSE. `onChat` recebe o chatId assim que o servidor o anuncia. */
async function send(body, obs, signal, onChat) {
  const t0 = Date.now();
  const res = await api('/api/chat', { method: 'POST', body: JSON.stringify(body), signal });
  if (!res.ok) return { status: res.status, erro: (await res.text()).slice(0, 200) };
  const dec = new TextDecoder(); let buf = '', turno = '', toolSeen = false;
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    const parts = buf.split('\n\n'); buf = parts.pop();
    for (const p of parts) {
      if (!p.startsWith('data: ')) continue;
      const ev = JSON.parse(p.slice(6)), dt = (Date.now() - t0) / 1000;
      if (ev.chatId && !ev.text) { onChat?.(ev.chatId); }
      else obs.primeiroSinalSeg ??= +dt.toFixed(2); // o primeiro evento além do "recebi" (route, speaker, texto…)
      if (ev.tool) { obs.ferramentas++; if (!toolSeen) { obs.antesDaFerramenta = turno; toolSeen = true; } }
      if (typeof ev.text === 'string' && ev.text) { obs.primeiroTextoSeg ??= +dt.toFixed(2); turno += ev.text; }
      if (ev.speaker) turno = ''; // novo orador: o texto final é o do último turno
      if (ev.error) obs.erro = String(ev.error).slice(0, 300);
      if (ev.approval) {
        const inbox = await json('/api/inbox').catch(() => ({ items: [] }));
        obs.caixa ||= inbox.items.some(i => i.kind === 'approval' && i.approval?.id === ev.approval.id);
        const b = ev.approval.kind === 'question' ? { answer: 'Não posso responder agora. Decida sozinho e siga.' } : { approve: false };
        await api(`/api/approvals/${ev.approval.id}`, { method: 'POST', body: JSON.stringify(b) }).catch(() => {});
      }
    }
  }
  obs.texto = turno;
  return { status: 200 };
}

async function runScenario(c, ids) {
  const obs = { texto: '', antesDaFerramenta: '', ferramentas: 0, delegacoes: [], falaram: [], caixa: false, primeiroSinalSeg: null, primeiroTextoSeg: null };
  const t0 = Date.now(), signal = AbortSignal.timeout(+opt.timeout * 1000);
  const nomes = Object.fromEntries(c.agentes.map(n => [n, n + SUFIXO]));
  const roteiro = s => s.replace(/@(\p{L}+)/gu, (m, n) => nomes[n] ? '@' + nomes[n] : m);
  const prefixo = !opt.real && c.teste ? `[[ripper:test:${c.teste}]] ` : '';
  let chatId, pend = [];
  try {
    const first = { ...(c.grupo ? { agentIds: c.agentes.map(n => ids[n]) } : { agentId: ids[c.agentes[0]] }), effort: 'low' };
    for (const m of c.mensagens) {
      const body = () => ({ ...(chatId ? { chatId } : first), text: prefixo + roteiro(m.texto) });
      if (m.durante) await sleep(300); // a anterior já está rodando
      else { await Promise.all(pend); pend = []; }
      const antes = [...pend];
      pend.push((async () => {
        let r = await send(body(), obs, signal, id => { chatId ??= id; });
        // Como a fila da interface: conversa ocupada (409) → espera a anterior terminar e manda.
        if (r.status === 409) { await Promise.all(antes); r = await send(body(), obs, signal); }
        if (r.erro) obs.erro = r.erro;
      })());
      while (!chatId && !obs.erro && Date.now() - t0 < 30_000) await sleep(50);
    }
    await Promise.all(pend);
    if (chatId) {
      const chat = await json(`/api/chats/${chatId}`);
      const nome = id => Object.entries(ids).find(([, v]) => v === id)?.[0] + SUFIXO;
      const lastUser = chat.messages.findLastIndex(m => m.role === 'user');
      obs.falaram = [...new Set(chat.messages.slice(lastUser + 1).filter(m => m.role === 'assistant' && m.content?.trim()).map(m => nome(m.agentId)))];
      obs.delegacoes = [...new Set(chat.messages.flatMap(m => (m.delegations || []).map(d => nome(d.to || d.workerId))))];
      if (!obs.delegacoes.length) obs.delegacoes = obs.falaram.filter(n => n !== nomes[c.agentes[0]]); // colega trazido pelo @ entrou e respondeu
    }
  } catch (e) { obs.erro = e.message; }
  const checks = score(c, obs, ref.limites);
  const nota = +(checks.filter(x => x.ok).length / checks.length * 100).toFixed(1);
  return { id: c.id, titulo: c.titulo, nota, segundos: +((Date.now() - t0) / 1000).toFixed(1),
    primeiroSinalSeg: obs.primeiroSinalSeg, primeiroTextoSeg: obs.primeiroTextoSeg, falaram: obs.falaram, caixa: obs.caixa,
    checks, ...(obs.erro ? { erro: obs.erro } : {}), resposta: obs.texto.slice(0, 600) };
}

let code = 0;
const criados = [];
try {
  const ids = {};
  for (const n of [...new Set(list.flatMap(c => c.agentes))]) {
    const a = await json('/api/agents', { method: 'POST', body: JSON.stringify({ name: n + SUFIXO, description: `Agente de teste do benchmark de conversas (${n}).` }) });
    ids[n] = a.id; criados.push(a.id);
  }
  const results = [];
  for (const c of list) {
    const r = await runScenario(c, ids);
    results.push(r);
    const falhas = r.checks.filter(x => !x.ok).map(x => x.nome).join(', ');
    console.log(`${r.id} ${String(r.nota).padStart(5)}%  sinal ${String(r.primeiroSinalSeg ?? '—').padStart(5)}s  texto ${String(r.primeiroTextoSeg ?? '—').padStart(5)}s  ${r.titulo}${falhas ? `  ✗ ${falhas}` : ''}`);
  }
  const nota = +(results.reduce((n, r) => n + r.nota, 0) / results.length).toFixed(1);
  const report = { quando: new Date().toISOString(), modo: opt.real ? 'real' : 'dry-run (provedor de teste: mede o encanamento, não a qualidade)',
    servidor: opt.real ? base : 'local temporário', limites: ref.limites, notaGeral: nota, resultados: results };
  const out = opt.out || join(root, 'docs/benchmark', `conversas-${report.quando.slice(0, 10)}${opt.real ? '' : '-dry'}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`\nNota geral: ${nota}%\nRelatório: ${out}`);
} catch (e) { console.error('conversas:', e.message); code = 1; }
finally {
  if (opt.real) for (const id of criados) await api(`/api/agents/${id}`, { method: 'DELETE' }).catch(() => {});
  server?.kill();
}
process.exit(code);
