// Auditoria de celular: sobe um servidor isolado, entra com token e mede as telas principais em 375px.
// Mede: rolagem lateral da página e alvos de toque menores que 44px (spec de UI/UX mobile).
// Uso: node scripts/mobile-audit.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const TELAS = ['/#/', '/#/new', '/#/agents', '/#/projects', '/#/inbox', '/#/flows', '/#/explore', '/#/chats', '/#/marketplace', '/#/settings', '/#/connectors', '/#/log'];
const MIN_TOQUE = 44;

const port = await new Promise(r => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const base = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), 'ripper-mobile-'));
const token = 'mobile-audit-' + Math.random().toString(36).slice(2);
const api = (path, opts = {}) => fetch(base + path, { ...opts, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: base, ...opts.headers } });
const server = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RIPPER_DATA: dataDir, RIPPER_TEST_PROVIDER: 'stream', RIPPER_TOKEN: token, HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0' },
  stdio: ['ignore', 'ignore', 'inherit']
});
let browser;
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ onboarded: true }) });
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, colorScheme: 'dark' });
  await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  console.log(`tela`.padEnd(16), 'rolagem lateral'.padEnd(18), `alvos < ${MIN_TOQUE}px`);
  const contagem = new Map(); // rótulo+tamanho -> em quantas telas aparece
  for (const tela of TELAS) {
    await page.goto(base + tela, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    const r = await page.evaluate(MIN_TOQUE => {
      const largura = document.documentElement.clientWidth;
      const estouro = Math.max(0, document.documentElement.scrollWidth - largura);
      const alvos = [...document.querySelectorAll('button, a[href], [role=button], input, select, textarea')]
        .filter(el => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; })
        .map(el => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), cls: String(el.className && el.className.baseVal === undefined ? el.className : '').split(' ')[0], tag: el.tagName.toLowerCase(), txt: (el.getAttribute('aria-label') || el.textContent || el.placeholder || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40) }; })
        .filter(a => a.w < MIN_TOQUE || a.h < MIN_TOQUE);
      return { estouro, pequenos: alvos.length, exemplos: alvos.slice(0, 3), todos: alvos };
    }, MIN_TOQUE);
    console.log(tela.padEnd(16), (r.estouro ? `${r.estouro}px` : 'ok').padEnd(18), r.pequenos);
    for (const e of r.exemplos) console.log(' '.repeat(16), `· ${e.w}x${e.h} "${e.txt}"`);
    for (const e of r.todos) { const k = `${e.w}x${e.h} ${e.tag}.${e.cls} "${e.txt}"`; contagem.set(k, (contagem.get(k) || 0) + 1); }
  }
  console.log('');
  console.log('Mais repetidos entre as telas:');
  for (const [k, n] of [...contagem].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(String(n).padStart(3), 'telas ·', k);
} finally {
  await browser?.close();
  server.kill();
}
