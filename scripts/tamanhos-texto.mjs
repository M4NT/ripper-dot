// Mede o tamanho calculado da fonte de cada texto nas telas principais (375 e 1280 px).
// Usado para provar que uma mudança de unidade (px para rem) não muda a aparência no padrão.
// Uso: node scripts/tamanhos-texto.mjs > saida.json   (compare duas saídas com diff)
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const TELAS = ['/#/', '/#/agents', '/#/inbox', '/#/chats', '/#/settings', '/#/marketplace'];
const LARGURAS = [375, 1280];

const port = await new Promise(r => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const base = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), 'ripper-texto-'));
const token = 'texto-' + Math.random().toString(36).slice(2);
const api = (p, o = {}) => fetch(base + p, { ...o, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: base, ...o.headers } });
const server = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RIPPER_DATA: dataDir, RIPPER_TEST_PROVIDER: 'stream', RIPPER_TOKEN: token, HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0' },
  stdio: ['ignore', 'ignore', 'ignore']
});
let browser;
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ onboarded: true }) });
  browser = await chromium.launch();
  const saida = {};
  for (const largura of LARGURAS) {
    const page = await browser.newPage({ viewport: { width: largura, height: 800 }, colorScheme: 'dark' });
    await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    for (const tela of TELAS) {
      await page.goto('about:blank');
      await page.goto(`${base}/?token=${token}${tela}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      const tamanhos = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('body *')) {
          const temTexto = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
          if (!temTexto) continue;
          out.push(`${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]}=${getComputedStyle(el).fontSize}`);
        }
        return out.sort();
      });
      saida[`${largura}:${tela}`] = tamanhos;
    }
    await page.close();
  }
  console.log(JSON.stringify(saida, null, 1));
} finally {
  await browser?.close();
  server.kill();
}
