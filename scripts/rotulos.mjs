// Auditoria de rótulos: procura botões e links sem nome acessível (leitor de tela não sabe o que são).
// Sobe um servidor isolado, visita as telas principais e lista os que não têm texto, aria-label, title ou aria-labelledby.
// Uso: node scripts/rotulos.mjs   (sai com código 1 se achar algum)
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const TELAS = ['/#/', '/#/new', '/#/agents', '/#/projects', '/#/inbox', '/#/flows', '/#/explore', '/#/chats', '/#/marketplace', '/#/settings', '/#/connectors', '/#/log', '/#/library'];

const port = await new Promise(r => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const base = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), 'ripper-rotulos-'));
const token = 'rotulos-' + Math.random().toString(36).slice(2);
const api = (path, opts = {}) => fetch(base + path, { ...opts, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: base, ...opts.headers } });
const server = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RIPPER_DATA: dataDir, RIPPER_TEST_PROVIDER: 'stream', RIPPER_TOKEN: token, HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0' },
  stdio: ['ignore', 'ignore', 'inherit']
});
let browser;
let achados = 0;
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ onboarded: true }) });
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Number(process.env.LARGURA) || 1280, height: 800 }, colorScheme: 'dark' });
  await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (const tela of TELAS) {
    await page.goto('about:blank');
    await page.goto(`${base}/?token=${token}${tela}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
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
  server.kill();
  process.exitCode = achados ? 1 : 0;
}
