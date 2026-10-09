// Interface ponta a ponta no navegador (roda no CI): servidor isolado + provedor de teste + RIPPER_TOKEN.
// Fluxos: enviar mensagem (com ferramentas), aprovar comando, criar agente, conversa em grupo, criar rotina;
// depois uma volta por todas as telas. Falha em erro de JS, tela "Algo quebrou" ou fluxo que não terminou.
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
const token = 'ui-smoke-' + Math.random().toString(36).slice(2);
const api = (path, opts = {}) => fetch(base + path, { ...opts, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: base, ...opts.headers } });
const state = async () => (await api('/api/state')).json();
const server = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RIPPER_DATA: dataDir, RIPPER_TEST_PROVIDER: 'stream', RIPPER_TOKEN: token, HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0' },
  stdio: ['ignore', 'ignore', 'inherit']
});
const fail = [];
let browser;
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ onboarded: true }) }); // pula o assistente de primeiro uso
  browser = await firefox.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  let where = 'início';
  page.on('pageerror', e => fail.push(`${where}: ${e.message}`));
  const broken = async () => (await page.locator('text=Algo quebrou').count()) > 0 && fail.push(`${where}: tela "Algo quebrou"`);

  // 1) Prompt com ferramentas pela UI (linha de ações + ThinkingOrb + streaming)
  where = 'chat com ferramentas';
  // domcontentloaded: o app renderiza após o DOM; o evento 'load' às vezes não dispara com a máquina sob carga
  await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded', timeout: 60_000 }); // cookie de login
  await page.goto(base + '/#/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const box = page.locator('textarea').first();
  await box.waitFor({ timeout: 15_000 });
  await box.fill('[[ripper:test:tools]] resposta-do-smoke');
  await box.press('Enter');
  await page.waitForTimeout(400);
  await broken(); // durante as ferramentas
  await page.locator('text=resposta-do-smoke').last().waitFor({ timeout: 20_000 }).catch(() => fail.push(`${where}: resposta não apareceu`));
  await broken();

  const step = async (name, fn) => { where = name; try { await fn(); } catch (e) { if (process.env.SMOKE_SHOTS) await page.screenshot({ path: join(process.env.SMOKE_SHOTS, where.replace(/\W+/g, '-') + '.png') }).catch(() => {}); fail.push(`${name}: ${e.message.split('\n')[0]}`); } await broken(); };
  const send = async text => { const b = page.locator('textarea').first(); await b.waitFor({ timeout: 15_000 }); await b.fill(text); await page.getByRole('button', { name: 'Enviar', exact: true }).click({ timeout: 10_000 }); };
  const until = async (fn, ms = 15_000) => { for (let t = Date.now(); Date.now() - t < ms; await page.waitForTimeout(200)) { const v = await fn(); if (v) return v; } throw new Error('tempo esgotado'); };

  // 2) Aprovar: o agente pede para rodar um comando, o botão Aprovar libera
  await step('aprovar comando', async () => {
    await send('[[ripper:test:approve]] apagar dist');
    // Comando pede o verbo do que faz: "Permitir comando" (Aprovar nos demais tipos)
    await page.getByRole('button', { name: /^(Permitir comando|Aprovar)$/ }).first().click({ timeout: 15_000 });
    await page.locator('text=comando aprovado').last().waitFor({ timeout: 15_000 });
  });

  // 3) Criar agente pela tela /new
  await step('criar agente', async () => {
    await page.goto(base + '/#/new', { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Nome do agente').fill('Agente do Smoke');
    await page.getByRole('button', { name: /Criar agente/ }).first().click();
    await until(async () => (await state()).agents.some(a => a.name === 'Agente do Smoke'));
  });

  // 4) Conversa em grupo: projeto com dois agentes → botão Conversa em grupo → mensagem
  await step('conversa em grupo', async () => {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ ui: { mode: 'enterprise' } }) }); // projetos e grupos ficam no Enterprise
    const ids = (await state()).agents.slice(0, 2).map(a => a.id);
    if (ids.length < 2) throw new Error('precisa de dois agentes');
    const proj = await (await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Projeto do Smoke', agentIds: ids }) })).json();
    await page.goto(`${base}/?grupo#/p/${proj.id}`, { waitUntil: 'domcontentloaded' }); // carga nova: relê o modo Enterprise
    await page.getByRole('button', { name: 'Conversa em grupo' }).click({ timeout: 15_000 });
    await send('oi-grupo-smoke');
    await until(async () => (await state()).chats.some(c => (c.agentIds || []).length >= 2));
  });

  // 5) Criar rotina na aba Rotinas do agente
  await step('criar rotina', async () => {
    const a = (await state()).agents[0];
    await page.goto(`${base}/#/agents/${a.id}/settings`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Rotinas', exact: true }).or(page.getByRole('tab', { name: 'Rotinas' })).first().click({ timeout: 15_000 });
    await page.getByPlaceholder('Resumo de IA').fill('Rotina do Smoke');
    await page.locator('textarea').last().fill('Resuma as vendas do dia.');
    await page.getByRole('button', { name: /Criar rotina/ }).click();
    await until(async () => (await state()).routines?.some(r => r.name === 'Rotina do Smoke'));
  });

  // 6) Todas as telas, nos dois modos de interface
  const st = await state();
  const chat = st.chats[0], agent = st.agents[0];
  const routes = ['/', '/inbox', '/agents', '/new', '/chats', '/marketplace', '/settings', '/settings/models', '/settings/computer', '/settings/security',
    '/settings/backup', '/settings/memory', '/settings/appearance', '/settings/advanced', '/explore', '/library', '/projects', '/connectors',
    '/skills', '/admin', '/admin/uso', chat && `/c/${chat.id}`, agent && `/agents/${agent.id}/settings`].filter(Boolean);
  for (const mode of ['simple', 'enterprise']) {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ ui: { mode } }) });
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
