// Smoke diário: 10 fluxos de ponta a ponta pela API, sem gastar tokens (provedor de teste).
//
//   node scripts/smoke.mjs                       # sobe um servidor temporário (dados descartáveis)
//   RIPPER_URL=http://localhost:3000 node scripts/smoke.mjs   # contra um servidor já rodando
//     (RIPPER_TOKEN ou RIPPER_PASSWORD para entrar; chat/aprovação só se esse servidor
//      rodar com RIPPER_TEST_PROVIDER — senão ficam "pulados" para não gastar tokens)
//   --json  imprime o resultado numa linha JSON no fim (o servidor usa isso para o aviso na Caixa)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const asJson = process.argv.includes('--json');
const external = process.env.RIPPER_URL;
let base = external, server, dataDir;
const PASSWORD = external ? process.env.RIPPER_PASSWORD : 'smoke-senha-' + Math.random().toString(36).slice(2);
const fake = !external || process.env.SMOKE_TEST_PROVIDER === '1';
let cookie = '';

const req = async (path, opts = {}) => {
  const headers = { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}), ...(external && process.env.RIPPER_TOKEN ? { authorization: `Bearer ${process.env.RIPPER_TOKEN}` } : {}) };
  return fetch(base + path, { ...opts, headers, body: opts.body && JSON.stringify(opts.body), signal: AbortSignal.timeout(30_000) });
};
const api = async (path, opts) => {
  const r = await req(path, opts);
  const t = await r.text();
  if (!r.ok) throw new Error(`${opts?.method || 'GET'} ${path} → ${r.status} ${t.slice(0, 160)}`);
  return t ? JSON.parse(t) : {};
};
/** Manda no chat e lê o SSE até o fim; `onEvent` recebe cada evento. */
async function chat(payload, onEvent = () => {}) {
  const r = await req('/api/chat', { method: 'POST', body: { model: 'claude-haiku-5-5', effort: 'low', ...payload } });
  if (!r.ok) throw new Error(`chat → ${r.status} ${(await r.text()).slice(0, 160)}`);
  let text = '', chatId = null, buf = '';
  const dec = new TextDecoder();
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    const parts = buf.split('\n\n'); buf = parts.pop();
    for (const p of parts) {
      if (!p.startsWith('data: ')) continue;
      const ev = JSON.parse(p.slice(6));
      if (ev.error) throw new Error(`chat: ${ev.error}`);
      if (ev.chatId) chatId = ev.chatId;
      if (ev.text) text += ev.text;
      await onEvent(ev);
    }
  }
  return { text, chatId };
}

const cleanup = { agents: [], chats: [], routines: [] };
const ctx = {};
const FLOWS = [
  ['login', async () => {
    const st = await api('/api/auth/status');
    if (!external) {
      const code = readFileSync(join(dataDir, 'setup-code.txt'), 'utf8').trim();
      await api('/api/auth/setup', { method: 'POST', body: { password: PASSWORD, code } });
    } else if (!PASSWORD) return st.authed || process.env.RIPPER_TOKEN ? 'sem RIPPER_PASSWORD: só status' : 'skip';
    const r = await req('/api/auth/login', { method: 'POST', body: { password: PASSWORD } });
    if (!r.ok) throw new Error(`login → ${r.status}`);
    cookie = r.headers.get('set-cookie').split(';')[0];
    const ok = await req('/api/state');
    if (!ok.ok) throw new Error(`sessão não entra (${ok.status})`);
  }],
  ['saúde', async () => {
    const h = await api('/api/health/detalhado');
    if (h.ok === false || h.status === 'down') throw new Error(JSON.stringify(h).slice(0, 200));
  }],
  ['criar agente', async () => {
    const a = await api('/api/agents', { method: 'POST', body: { name: 'Smoke ' + Date.now(), description: 'Agente temporário do smoke diário.', category: 'Outro', tools: [] } });
    if (!a.id) throw new Error('sem id');
    cleanup.agents.push(a.id); ctx.agent = a;
  }],
  ['enviar mensagem', async () => {
    if (!fake) return 'skip';
    const { text, chatId } = await chat({ agentId: ctx.agent.id, text: '[[ripper:test:stream]] smoke-ok-123' });
    if (chatId) cleanup.chats.push(chatId);
    if (!text.includes('smoke-ok-123')) throw new Error(`resposta inesperada: ${text.slice(0, 80)}`);
  }],
  ['aprovar', async () => {
    if (!fake) return 'skip';
    let answered = false;
    const { text, chatId } = await chat({ agentId: ctx.agent.id, text: '[[ripper:test:ask]] escolha' }, async () => {
      if (answered) return;
      const q = (await api('/api/approvals')).pending.find(a => a.kind === 'question');
      if (q) { answered = true; await api(`/api/approvals/${q.id}`, { method: 'POST', body: { answer: 'Ana ME' } }); }
    });
    if (chatId) cleanup.chats.push(chatId);
    if (!answered || !text.includes('Ana ME')) throw new Error('a pergunta não apareceu ou a resposta não voltou');
  }],
  ['grupo', async () => {
    if (!fake) return 'skip';
    const peer = (await api('/api/state')).agents.find(a => a.id !== ctx.agent.id);
    if (!peer) throw new Error('sem segundo agente');
    const { chatId } = await chat({ agentIds: [ctx.agent.id, peer.id], agentId: ctx.agent.id, text: '[[ripper:test:stream]] oi time' });
    if (!chatId) throw new Error('grupo não criado');
    cleanup.chats.push(chatId);
    const c = await api(`/api/chats/${chatId}`);
    if ((c.agentIds || []).length < 2) throw new Error('conversa não virou grupo');
  }],
  ['rotina', async () => {
    const r = await api('/api/routines', { method: 'POST', body: { agentId: ctx.agent.id, name: 'Smoke', prompt: 'nada', dailyAt: '03:33' } });
    if (!r.id) throw new Error('sem id');
    cleanup.routines.push(r.id);
  }],
  ['backup verificado', async () => {
    const b = await api('/api/backup', { method: 'POST' });
    const list = await api('/api/backup/list');
    if (!b.fileName || !list.snapshots.some(s => (s.fileName || s.name) === b.fileName)) throw new Error('cópia não aparece na lista');
  }],
  ['exportar', async () => {
    let r = await req('/api/data/export-all');
    if (r.status === 404) r = await req('/api/data/backup');
    if (!r.ok) throw new Error(`exportar → ${r.status}`);
    if ((await r.arrayBuffer()).byteLength < 50) throw new Error('exportação vazia');
  }],
  ['convite de pareamento', async () => {
    const r = await req('/api/pair/invite', { method: 'POST' });
    if (r.status === 409) return 'Wi-Fi desligado: rota responde'; // ponytail: não liga a rede só para testar
    if (!r.ok) throw new Error(`convite → ${r.status}`);
    if (!(await r.json()).url) throw new Error('sem link');
  }]
];

const results = [];
try {
  if (!external) {
    const port = await new Promise(r => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
    base = `http://127.0.0.1:${port}`;
    dataDir = mkdtempSync(join(tmpdir(), 'ripper-smoke-'));
    server = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RIPPER_DATA: dataDir, RIPPER_TOKEN: '', RIPPER_TEST_PROVIDER: 'stream', HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0' },
      stdio: 'ignore'
    });
    for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
  }
  for (const [name, run] of FLOWS) {
    const t = Date.now();
    try {
      const note = await run();
      results.push({ name, ok: true, skipped: note === 'skip', note: note === 'skip' ? undefined : note, ms: Date.now() - t });
    } catch (e) { results.push({ name, ok: false, error: String(e.message).slice(0, 300), ms: Date.now() - t }); }
  }
} catch (e) { results.push({ name: 'subir servidor', ok: false, error: e.message }); }
finally {
  if (external) { // contra servidor real: apaga o que criou
    for (const id of cleanup.routines) await req(`/api/routines/${id}`, { method: 'DELETE' }).catch(() => {});
    for (const id of cleanup.chats) await req(`/api/chats/${id}`, { method: 'DELETE' }).catch(() => {});
    for (const id of cleanup.agents) await req(`/api/agents/${id}`, { method: 'DELETE' }).catch(() => {});
  }
  server?.kill();
  if (dataDir) setTimeout(() => { try { rmSync(dataDir, { recursive: true, force: true }); } catch {} }, 500);
}

const failed = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? (r.skipped ? '–' : '✓') : '✗'} ${r.name}${r.error ? ': ' + r.error : r.note ? ` (${r.note})` : ''}`);
console.log(failed.length ? `\n${failed.length} de ${results.length} fluxos falharam` : `\nsmoke ok (${results.length} fluxos)`);
if (asJson) console.log(JSON.stringify({ at: Date.now(), ok: !failed.length, results }));
process.exitCode = failed.length ? 1 : 0;
