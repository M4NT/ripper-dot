// Auditoria de rótulos: procura botões e links sem nome acessível (leitor de tela não sabe o que são).
// Sobe um servidor isolado com dados de exemplo (agente com categoria, conversa com texto, tabela e resposta longa)
// e visita as telas principais, a conversa e a ficha do agente. Lista o que não tem texto, aria-label, title ou aria-labelledby.
// Uso: node scripts/rotulos.mjs            (1280 px)
//      LARGURA=375 node scripts/rotulos.mjs (celular)
// Sai com código 1 se achar algum.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const TELAS = ['/#/', '/#/new', '/#/agents', '/#/projects', '/#/inbox', '/#/flows', '/#/explore', '/#/chats', '/#/marketplace', '/#/settings', '/#/connectors', '/#/log', '/#/library'];
const LARGURA = Number(process.env.LARGURA) || 1280;

const port = await new Promise(r => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const base = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), 'ripper-rotulos-'));
const token = 'rotulos-' + Math.random().toString(36).slice(2);
const api = (path, opts = {}) => fetch(base + path, { ...opts, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: base, ...opts.headers } });
const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', RIPPER_DATA: dataDir, RIPPER_TEST_PROVIDER: 'stream', RIPPER_TOKEN: token, HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0' };
const sobe = () => spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], { env, stdio: ['ignore', 'ignore', 'inherit'] });
async function espera() { for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/health')).ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); } throw new Error('servidor nao subiu'); }

let srv = sobe();
let browser;
let achados = 0;
try {
  await espera();
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ onboarded: true }) });
  // Dados de exemplo: um agente com categoria e uma conversa com texto, tabela e resposta longa.
  const agentId = (await (await api('/api/state')).json()).agents[0].id;
  srv.kill(); await new Promise(r => setTimeout(r, 800));
  const dbPath = join(dataDir, 'db.json');
  const db = JSON.parse(readFileSync(dbPath, 'utf8'));
  const agora = Date.now();
  db.agents.push({ ...db.agents[0], id: 'agente-rotulos', name: 'Analista de vendas', category: 'Vendas', description: 'Analisa números.' });
  const tabela = '| Fornecedor | Valor |\n|---|---|\n| A | R$ 1,00 |';
  const longa = Array.from({ length: 30 }, (_, k) => 'Parágrafo ' + (k + 1) + ' de resposta longa.').join('\n\n');
  db.chats.push({ id: 'chat-rotulos', title: 'Conversa de exemplo', agentId, agentIds: [agentId], projectId: null, tags: [], archived: false, createdAt: agora, updatedAt: agora, preview: 'Pronto', count: 0, messages: [
    { id: 'u1', role: 'user', content: 'resumo', createdAt: agora - 60000 },
    { id: 'a1', role: 'assistant', agentId, content: 'Segue:\n\n' + tabela + '\n\n' + longa, createdAt: agora },
  ] });
  writeFileSync(dbPath, JSON.stringify(db, null, 2));
  srv = sobe(); await espera();

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: LARGURA, height: 800 }, colorScheme: 'dark' });
  await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const telas = [...TELAS, '/#/c/chat-rotulos', '/#/a/agente-rotulos/settings'];
  for (const tela of telas) {
    await page.goto('about:blank');
    await page.goto(`${base}/?token=${token}${tela}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    if (await page.getByRole('button', { name: 'Pular' }).count()) { await page.getByRole('button', { name: 'Pular' }).first().click(); await page.waitForTimeout(400); }
    const sem = await page.evaluate(() => {
      const nome = el => {
        const rotulo = el.getAttribute('aria-label') || el.getAttribute('title');
        if (rotulo && rotulo.trim()) return rotulo.trim();
        const ids = el.getAttribute('aria-labelledby');
        if (ids) { const t = ids.split(' ').map(i => document.getElementById(i)?.textContent || '').join(' ').trim(); if (t) return t; }
        return (el.textContent || '').replace(/\s+/g, ' ').trim();
      };
      return [...document.querySelectorAll('button, a[href]')]
        .filter(el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; })
        .filter(el => !nome(el))
        .map(el => ({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').split(' ')[0], html: el.outerHTML.slice(0, 120) }));
    });
    if (sem.length) {
      achados += sem.length;
      console.log(`${tela}: ${sem.length} sem nome`);
      for (const s of sem.slice(0, 5)) console.log(`   · <${s.tag} class="${s.cls}">  ${s.html.replace(/\s+/g, ' ').slice(0, 90)}`);
    } else console.log(`${tela}: ok`);
  }
  console.log(achados ? `\n${achados} botão(ões) ou link(s) sem nome acessível.` : '\nTodos os botões e links visíveis têm nome.');
} finally {
  await browser?.close();
  srv.kill();
  process.exitCode = achados ? 1 : 0;
}
