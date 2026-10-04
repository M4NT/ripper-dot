// Auditoria de capacidades dos agentes: tarefas reais, uma por área, contra o Ripper rodando.
// Mede se funcionou, QUAIS ferramentas o agente escolheu (ex.: leu a página sem abrir a VM?),
// tokens aproximados e tempo. Usa agentes temporários com o modelo mais barato e apaga tudo no fim.
// Nunca envia nada para fora (WhatsApp, e-mail, posts).
//
//   node scripts/agent-audit.mjs                 # todas as áreas
//   node scripts/agent-audit.mjs web memoria     # só algumas (pelo id)
//   RIPPER_URL=http://localhost:3000 MODEL=claude-haiku-4-5 node scripts/agent-audit.mjs
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.RIPPER_URL || 'http://localhost:3000';
const MODEL = process.env.MODEL || 'claude-haiku-4-5';
const H = { 'content-type': 'application/json', origin: BASE };
const api = async (path, opts = {}) => {
  const r = await fetch(BASE + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${opts.method || 'GET'} ${path} → ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : {};
};

/** Uma conversa: manda o texto, segue o fluxo, aprova sozinho o que for desta auditoria. */
async function ask(agentId, text, { chatId, fileIds } = {}) {
  const started = Date.now();
  const r = await fetch(BASE + '/api/chat', { method: 'POST', headers: H, body: JSON.stringify({ agentId, chatId, text, model: MODEL, effort: 'low', fileIds }) });
  if (!r.ok) throw new Error(`chat → ${r.status} ${await r.text()}`);
  const out = { chatId: null, tools: [], text: '', error: null, approvals: 0, ms: 0 };
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n'); buf = parts.pop();
    for (const p of parts) {
      if (!p.startsWith('data: ')) continue;
      const ev = JSON.parse(p.slice(6));
      if (ev.chatId) out.chatId = ev.chatId;
      if (ev.tool) out.tools.push(ev.tool);
      if (ev.text) out.text += ev.text;
      if (ev.error) out.error = ev.error;
      if (ev.approval?.id && ev.approval.status === 'pending') {          // ação desta auditoria: aprova e anota
        out.approvals++;
        await api(`/api/approvals/${ev.approval.id}`, { method: 'POST', body: JSON.stringify({ approve: true }) }).catch(() => {});
      }
    }
  }
  out.ms = Date.now() - started;
  if (out.chatId && !out.text) {                                           // resposta final salva na conversa
    const c = await api(`/api/chats/${out.chatId}`).catch(() => null);
    const last = c?.messages?.filter(m => m.role === 'assistant').at(-1);
    out.text = last?.content || ''; out.error ||= last?.error || null;
  }
  return out;
}

const used = (res, ...names) => res.tools.some(t => names.some(n => t === n || t.includes(n)));
const est = res => Math.round(res.text.length / 4);                    // tokens aproximados da resposta

/** Cada área: o que pedir e como saber se funcionou. `best` = ferramenta mais barata esperada. */
const AREAS = [
  { id: 'conversa', area: 'Conversa', run: a => ask(a, 'Responda em uma frase: qual é a capital da França?'),
    ok: r => /paris/i.test(r.text) },
  { id: 'web', area: 'Ler página (sem VM)', best: 'leitura web, sem navegador/computador',
    run: a => ask(a, 'Leia https://example.com e me diga só o título da página.'),
    ok: r => /example domain/i.test(r.text), economy: r => used(r, 'WebFetch') && !used(r, 'browser_', 'computer_exec') },
  { id: 'pesquisa', area: 'Pesquisa na web', run: a => ask(a, 'Pesquise na web qual é a versão LTS atual do Node.js e responda só o número da versão principal.'),
    ok: r => /\b2[0-9]\b/.test(r.text) && used(r, 'WebSearch', 'WebFetch') },
  { id: 'arquivo', area: 'Ler arquivo anexado', setup: 'csv',
    run: (a, ctx) => ask(a, 'Qual produto tem o maior valor no arquivo anexado? Responda só o nome.', { fileIds: [ctx.csv] }),
    ok: r => /teclado/i.test(r.text) },
  { id: 'excel', area: 'Gerar planilha Excel', setup: 'csv', best: 'um script no computador',
    run: (a, ctx) => ask(a, 'Com os dados do CSV anexado, crie no seu computador uma planilha vendas.xlsx com uma coluna "total" (quantidade × valor) e responda o caminho do arquivo.', { fileIds: [ctx.csv] }),
    ok: r => /vendas\.xlsx/i.test(r.text) && used(r, 'computer_exec') },
  { id: 'memoria', area: 'Memória entre conversas',
    run: async a => { const first = await ask(a, 'Guarde na memória: eu tomo café sem açúcar.'); const second = await ask(a, 'Como eu tomo café? Responda curto.'); second.tools = [...first.tools, ...second.tools]; second.extraChat = first.chatId; return second; },
    ok: r => /sem açúcar/i.test(r.text) && used(r, 'remember') },
  { id: 'artefato', area: 'Documento (artefato)', run: a => ask(a, 'Escreva um parágrafo curto sobre economia de tokens e salve como artefato chamado "Auditoria Ripper".'),
    ok: r => used(r, 'save_artifact') },
  { id: 'rotina', area: 'Rotina agendada', run: a => ask(a, 'Crie uma rotina diária às 07:00 chamada "Auditoria Ripper" que resume as notícias de tecnologia.'),
    ok: r => used(r, 'schedule_routine') },
  { id: 'delegacao', area: 'Delegar para outro agente', run: (a, ctx) => ask(a, `Peça ao colega "${ctx.peerName}" que responda só "recebido". Use a ferramenta de mensagem para colegas.`),
    ok: r => used(r, 'send_message', 'call_agent', 'handoff') },
  { id: 'scripts', area: 'Aprender e reaproveitar script', best: 'procurar no pool antes de escrever',
    run: a => ask(a, 'No seu computador, escreva e rode um script Python que imprime a soma de 2+2. Se funcionar, guarde no pool de scripts com a tarefa "somar dois números".'),
    ok: r => /\b4\b/.test(r.text) && used(r, 'computer_exec') && used(r, 'save_script') },
  { id: 'navegador', area: 'Navegador da VM (quando precisa interagir)', run: a => ask(a, 'Abra https://example.com no SEU navegador (não use leitura web) e me diga o título.'),
    ok: r => /example domain/i.test(r.text) && used(r, 'browser_') },
  { id: 'agenda', area: 'Conector (Google Agenda, só leitura)', run: a => ask(a, 'Liste só os títulos dos meus próximos 2 eventos da agenda. Não crie nem altere nada.'),
    ok: r => used(r, 'claude_ai', 'calendar', 'Calendar') && !r.error },
  { id: 'multitarefa', area: 'Multitarefa (web + computador)', best: 'as duas ferramentas no mesmo pedido',
    run: a => ask(a, 'Faça as duas coisas: leia o título de https://example.com e calcule 17*23 rodando Python no seu computador. Responda os dois resultados.'),
    ok: r => /391/.test(r.text) && /example domain/i.test(r.text) }
];

async function main() {
  const only = process.argv.slice(2);
  const areas = only.length ? AREAS.filter(x => only.includes(x.id)) : AREAS;
  if (only[0] === 'relatorio') return report([]); // só regenera docs/capacidades.md a partir do .json
  if (!areas.length) throw new Error(`Área desconhecida. Ids: ${AREAS.map(x => x.id).join(', ')}`);
  const tools = ['web', 'browser', 'computer', 'memory', 'routines', 'files', 'plugins'];
  const mk = name => api('/api/agents', { method: 'POST', body: JSON.stringify({ name, description: 'Agente temporário da auditoria de capacidades.', category: 'Outro', tools, model: MODEL, effort: 'low', instructions: 'Você está sendo auditado. Faça exatamente o que for pedido, do jeito mais econômico, e responda curto.' }) });
  const agent = await mk('Auditor Ripper'), peer = await mk('Auditor Colega');
  const ctx = { peerName: peer.name };
  const created = { chats: [], artifacts: [], routines: [] };
  const results = [];
  try {
    if (areas.some(x => x.setup === 'csv')) {
      const csv = 'produto,quantidade,valor\nMouse,10,50\nTeclado,4,320\nCabo HDMI,25,30\n';
      const r = await fetch(`${BASE}/api/files?name=vendas.csv&agentId=${agent.id}`, { method: 'POST', headers: { 'content-type': 'text/csv', origin: BASE }, body: csv });
      ctx.csv = (await r.json()).id;
    }
    for (const x of areas) {
      process.stdout.write(`· ${x.area}… `);
      let r;
      try { r = await x.run(agent.id, ctx); } catch (e) { r = { tools: [], text: '', error: e.message, ms: 0, approvals: 0 }; }
      [r.chatId, r.extraChat].filter(Boolean).forEach(c => created.chats.push(c));
      const pass = !r.error && x.ok(r);
      const economy = x.economy ? x.economy(r) : null;
      results.push({ id: x.id, area: x.area, pass, economy, best: x.best || null, tools: [...new Set(r.tools)], ms: r.ms, tokens: est(r), approvals: r.approvals, error: r.error || null, answer: r.text.slice(0, 300) });
      console.log(pass ? 'ok' : 'FALHOU', `(${(r.ms / 1000).toFixed(1)}s)`);
    }
  } finally {
    // limpeza: nada da auditoria fica no seu Ripper
    const st = await api('/api/state').catch(() => ({}));
    for (const a of st.artifacts || []) if (a.agentId === agent.id || a.title === 'Auditoria Ripper') await api(`/api/artifacts/${a.id}`, { method: 'DELETE' }).catch(() => {});
    for (const c of created.chats) await api(`/api/chats/${c}`, { method: 'DELETE' }).catch(() => {});
    for (const c of st.chats || []) if (c.agentId === agent.id || c.agentId === peer.id) await api(`/api/chats/${c.id}`, { method: 'DELETE' }).catch(() => {});
    const scripts = (await api('/api/scripts').catch(() => ({}))).scripts || [];
    for (const s of scripts) if (s.agentId === agent.id) await api(`/api/scripts/${s.id}`, { method: 'DELETE' }).catch(() => {});
    for (const a of [agent, peer]) await api(`/api/agents/${a.id}`, { method: 'DELETE' }).catch(() => {});
  }
  report(results);
}

function report(fresh) {
  // execução parcial (só algumas áreas) atualiza essas áreas no catálogo existente, sem apagar as outras
  let prev = [];
  try { prev = JSON.parse(readFileSync('docs/capacidades.json', 'utf8')).results || []; } catch {}
  const byId = new Map(prev.map(r => [r.id, r]));
  for (const r of fresh) byId.set(r.id, { ...r, at: Date.now() });
  const results = AREAS.map(x => byId.get(x.id)).filter(Boolean);
  const passed = results.filter(r => r.pass).length;
  const lines = [
    `# Capacidades dos agentes — auditoria de ${new Date().toLocaleString('pt-BR')}`, '',
    `Modelo usado: \`${MODEL}\` (esforço baixo). **${passed}/${results.length} áreas funcionando.** Tokens são aproximados (resposta ÷ 4).`, '',
    '| Área | Resultado | Ferramentas usadas | Tempo | Tokens (resp.) | Economia |', '|---|---|---|---|---|---|',
    ...results.map(r => `| ${r.area} | ${r.pass ? 'funciona' : '**falhou**'} | ${r.tools.join(', ') || '—'} | ${(r.ms / 1000).toFixed(1)}s | ${r.tokens} | ${r.economy === null ? '—' : r.economy ? 'caminho barato' : '**caminho caro**' + (r.best ? ` (esperado: ${r.best})` : '')} |`),
    '', '## Detalhes das falhas', '',
    ...results.filter(r => !r.pass || r.economy === false).flatMap(r => [`### ${r.area}`, r.error ? `Erro: \`${r.error}\`` : '', `Resposta: ${r.answer || '(vazia)'}`, ''])
  ];
  mkdirSync('docs', { recursive: true });
  writeFileSync('docs/capacidades.md', lines.filter(l => l !== undefined).join('\n') + '\n');
  writeFileSync('docs/capacidades.json', JSON.stringify({ at: Date.now(), model: MODEL, results }, null, 2));
  console.log(`\n${passed}/${results.length} áreas funcionando → docs/capacidades.md`);
}

main().catch(e => { console.error(e); process.exit(1); });
