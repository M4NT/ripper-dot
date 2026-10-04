// Smoke da interface no navegador (roda no CI): servidor isolado + provedor de teste,
// um prompt que usa ferramentas e uma volta por todas as telas. Falha em erro de JS ou tela "Algo quebrou".
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { firefox } from 'playwright';

const port = await new Promise(r => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const base = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), 'ripper-smoke-'));
const server = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RIPPER_DATA: dataDir, RIPPER_TEST_PROVIDER: 'stream', HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0' },
  stdio: ['ignore', 'ignore', 'inherit']
});
const fail = [];
let browser;
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
  browser = await firefox.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  let where = 'início';
  page.on('pageerror', e => fail.push(`${where}: ${e.message}`));
  const broken = async () => (await page.locator('text=Algo quebrou').count()) > 0 && fail.push(`${where}: tela "Algo quebrou"`);

  // 1) Prompt com ferramentas pela UI (linha de ações + ThinkingOrb + streaming)
  where = 'chat com ferramentas';
  // domcontentloaded: o app renderiza após o DOM; o evento 'load' às vezes não dispara com a máquina sob carga
  await page.goto(base + '/#/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const box = page.locator('textarea').first();
  await box.waitFor({ timeout: 15_000 });
  await box.fill('[[ripper:test:tools]] resposta-do-smoke');
  await box.press('Enter');
  await page.waitForTimeout(400);
  await broken(); // durante as ferramentas
  await page.locator('text=resposta-do-smoke').last().waitFor({ timeout: 20_000 }).catch(() => fail.push(`${where}: resposta não apareceu`));
  await broken();

  // 2) Todas as telas, nos dois modos de interface
  const st = await (await fetch(base + '/api/state')).json();
  const chat = st.chats[0], agent = st.agents[0];
  const routes = ['/', '/inbox', '/agents', '/new', '/chats', '/marketplace', '/settings', '/settings/models', '/settings/computer', '/settings/security',
    '/settings/backup', '/settings/memory', '/settings/appearance', '/settings/advanced', '/explore', '/library', '/projects', '/connectors',
    '/skills', '/admin', '/admin/uso', chat && `/c/${chat.id}`, agent && `/agents/${agent.id}/settings`].filter(Boolean);
  for (const mode of ['simple', 'enterprise']) {
    await fetch(base + '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ ui: { mode } }) });
    for (const r of routes) {
      where = `${mode} ${r}`;
      await page.goto(base + '/#' + r, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForTimeout(500);
      await broken();
    }
  }
} catch (e) {
  fail.push(`smoke: ${e.message}`);
} finally {
  await browser?.close();
  server.kill();
}
if (fail.length) { console.error('UI smoke falhou:\n- ' + fail.join('\n- ')); process.exit(1); }
console.log('UI smoke ok');
