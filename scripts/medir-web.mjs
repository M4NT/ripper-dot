// Medição de desempenho no celular: carregamento (LCP) e resposta a toque (INP) nas telas principais.
// Sobe um servidor isolado, entra com token e mede em 375 px com toque emulado.
// Uso: node scripts/medir-web.mjs   (cada rodada imprime uma tabela; compare antes e depois de mudanças)
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const TELAS = ['/#/chats', '/#/agents', '/#/inbox', '/#/settings'];
const TOQUES = ['nav.tabbar button:nth-child(1)', 'nav.tabbar button:nth-child(2)', 'nav.tabbar button:nth-child(3)'];

const port = await new Promise(r => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const base = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), 'ripper-medir-'));
const token = 'medir-' + Math.random().toString(36).slice(2);
const api = (path, opts = {}) => fetch(base + path, { ...opts, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: base, ...opts.headers } });
const server = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RIPPER_DATA: dataDir, RIPPER_TEST_PROVIDER: 'stream', RIPPER_TOKEN: token, HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0' },
  stdio: ['ignore', 'ignore', 'inherit']
});
let browser;
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ onboarded: true }) });
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // LCP e eventos de interação (Event Timing) registrados desde o início da página
  await page.addInitScript(() => {
    window.__lcp = 0; window.__eventos = [];
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp = Math.round(e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.interactionId) window.__eventos.push(e.duration); }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  });

  console.log('tela'.padEnd(12), 'LCP (ms)'.padEnd(12), 'toque mais lento (ms)');
  for (const tela of TELAS) {
    await page.goto('about:blank'); // documento novo: o observador de LCP roda em cada tela
    await page.goto(base + '/?token=' + token + tela, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const lcp = await page.evaluate(() => window.__lcp);
    let pior = 0;
    if (tela !== '/#/settings') {
      for (const seletor of TOQUES) {
        if (!(await page.locator(seletor).count())) continue;
        await page.evaluate(() => { window.__eventos = []; });
        await page.locator(seletor).first().tap();
        await page.waitForTimeout(400);
        const dur = await page.evaluate(() => Math.max(0, ...window.__eventos));
        pior = Math.max(pior, dur);
      }
    }
    console.log(tela.padEnd(12), String(lcp).padEnd(12), pior ? String(Math.round(pior)) : '-');
  }
} finally {
  await browser?.close();
  server.kill();
}
