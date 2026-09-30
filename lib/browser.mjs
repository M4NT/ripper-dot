// Navegador por agente: Chromium sem janela dentro do contêiner Docker do agente.
// Cada ação gera uma captura em /work/.ripper/screen.jpg, que a aba "Computador" mostra ao vivo.
import { mkdirSync, writeFileSync } from 'node:fs';

// Instala Chromium + puppeteer-core no contêiner (uma vez; fica no contêiner até ele ser removido).
const SETUP = `test -x /usr/bin/chromium && test -d /opt/ripper-browser/node_modules/puppeteer-core || (
  export DEBIAN_FRONTEND=noninteractive;
  apt-get update -qq >/dev/null && apt-get install -y -qq chromium fonts-liberation fonts-noto-color-emoji >/dev/null &&
  mkdir -p /opt/ripper-browser && cd /opt/ripper-browser && npm init -y >/dev/null && npm i -s puppeteer-core@23 >/dev/null
) && echo RIPPER_BROWSER_READY`;

// Serviço que mantém a mesma aba aberta entre as ações do agente.
const DAEMON = `import { createRequire } from 'node:module';
import http from 'node:http';
const require = createRequire('/opt/ripper-browser/');
const puppeteer = require('puppeteer-core');
// Com tela virtual (imagem de referência), o navegador abre com janela: é a mesma que você vê e controla no noVNC.
const headful = !!process.env.DISPLAY;
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: !headful,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=pt-BR', '--no-first-run', '--no-default-browser-check',
    ...(headful ? ['--start-maximized', '--window-position=0,0', '--window-size=1280,800'] : [])],
  defaultViewport: headful ? null : { width: 1280, height: 800 } });
browser.on('disconnected', () => process.exit(0)); // janela fechada por você: o próximo comando reabre
let page = (await browser.pages())[0] || await browser.newPage();
// Se você abrir outra aba pela tela, o agente passa a trabalhar nela.
browser.on('targetcreated', async t => { const p = await t.page().catch(() => null); if (p) page = p; });
const current = async () => { if (page.isClosed()) page = (await browser.pages()).at(-1) || await browser.newPage(); return page; };
const SHOT = '/work/.ripper/screen.jpg';
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = () => page.screenshot({ path: SHOT, type: 'jpeg', quality: 60 }).catch(() => {});
async function summary() {
  const title = await page.title().catch(() => '');
  const text = (await page.evaluate(() => document.body?.innerText || '').catch(() => '')).replace(/\\n{3,}/g, '\\n\\n').slice(0, 3000);
  const controls = await page.evaluate(() => [...document.querySelectorAll('a,button,input,textarea,select,[role=button]')]
    .filter(e => e.offsetParent).slice(0, 40)
    .map(e => (e.innerText || e.value || e.placeholder || e.getAttribute('aria-label') || e.name || '').trim().replace(/\\s+/g, ' ').slice(0, 40))
    .filter(Boolean)).catch(() => []);
  return { title, url: page.url(), text, controls };
}
async function find(target) {
  try { const el = await page.$(target); if (el) return el; } catch {}
  const h = await page.evaluateHandle(t => {
    const low = t.toLowerCase();
    return [...document.querySelectorAll('a,button,input,textarea,select,[role=button],label,[onclick]')]
      .find(e => (e.innerText || e.value || e.placeholder || e.getAttribute('aria-label') || e.name || '').toLowerCase().includes(low)) || null;
  }, target);
  return h.asElement();
}
const actions = {
  go: async ({ url }) => { await page.goto(/^https?:/.test(url) ? url : 'https://' + url, { waitUntil: 'domcontentloaded', timeout: 30000 }); await wait(900); },
  click: async ({ target }) => { const el = await find(target); if (!el) throw new Error('Não achei: ' + target); await el.click(); await wait(1200); },
  type: async ({ target, text, submit }) => {
    const el = await find(target); if (!el) throw new Error('Não achei o campo: ' + target);
    await el.click({ clickCount: 3 }); await el.type(text, { delay: 12 });
    if (submit) { await page.keyboard.press('Enter'); await wait(1500); }
  },
  scroll: async ({ dy = 700 }) => { await page.mouse.wheel({ deltaY: dy }); await wait(400); },
  back: async () => { await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {}); await wait(600); },
  read: async () => {}
};
http.createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c;
  await current();
  try { const cmd = JSON.parse(b); await actions[cmd.action](cmd); await shot(); res.end(JSON.stringify({ ok: true, ...(await summary()) })); }
  catch (e) { await shot(); res.end(JSON.stringify({ ok: false, error: e.message, ...(await summary()) })); }
}).listen(7777, '127.0.0.1');
await shot();
`;

// Cliente: fala com o serviço; se ele não estiver no ar, sobe e espera.
const CTL = `const cmd = Buffer.from(process.argv[2], 'base64').toString('utf8');
const call = async () => (await fetch('http://127.0.0.1:7777', { method: 'POST', body: cmd })).text();
let out;
try { out = await call(); } catch {
  const { spawn } = await import('node:child_process');
  spawn('node', ['/work/.ripper/browserd.mjs'], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 60 && !out; i++) { await new Promise(r => setTimeout(r, 500)); try { out = await call(); } catch {} }
}
console.log('@@JSON@@' + (out || JSON.stringify({ ok: false, error: 'O navegador não iniciou.' })));
`;

/** Navegador de um agente. raw = computador Docker sem o portão de aprovação (instalação interna). */
export function browserFor(raw, dirUrl) {
  let ready = false;
  const scripts = new URL('.ripper/', dirUrl);
  async function setup() {
    if (ready) return;
    mkdirSync(scripts, { recursive: true });
    writeFileSync(new URL('browserd.mjs', scripts), DAEMON);
    writeFileSync(new URL('bctl.mjs', scripts), CTL);
    const r = await raw.exec(SETUP);
    if (!r.includes('RIPPER_BROWSER_READY')) throw new Error('Não consegui preparar o navegador no computador do agente: ' + r.slice(-300));
    ready = true;
  }
  async function run(cmd) {
    await setup();
    const r = await raw.exec(`node /work/.ripper/bctl.mjs ${Buffer.from(JSON.stringify(cmd)).toString('base64')}`);
    const j = r.split('@@JSON@@')[1];
    let d; try { d = JSON.parse(j.split('\n')[0]); } catch { return 'O navegador não respondeu: ' + r.slice(-300); }
    // Resposta enxuta para o modelo (tokens): título, URL, controles visíveis e o começo do texto.
    return [d.ok ? '' : `Erro: ${d.error}`, `Página: ${d.title}`, `URL: ${d.url}`,
      d.controls?.length ? `Controles visíveis: ${d.controls.join(' | ')}` : '', `Texto:\n${d.text}`].filter(Boolean).join('\n');
  }
  return {
    open: url => run({ action: 'go', url }),
    click: target => run({ action: 'click', target }),
    type: (target, text, submit) => run({ action: 'type', target, text, submit }),
    scroll: dy => run({ action: 'scroll', dy }),
    back: () => run({ action: 'back' }),
    read: () => run({ action: 'read' })
  };
}

// Ações de navegador que precisam do seu ok (rascunho antes de enviar).
const RISKY_CLICK = /\b(comprar|pagar|pagamento|finalizar|checkout|enviar|send|publicar|postar|post|excluir|apagar|deletar|delete|remove|confirmar|transferir|assinar|subscribe|buy|pay|submit)\b/i;
const SENSITIVE_FIELD = /(senha|password|passwd|cart[aã]o|card|cvv|cpf|token|secret)/i;
export function browserRisk(action, { target = '', submit = false } = {}) {
  if (action === 'click' && RISKY_CLICK.test(target)) return `clica em “${target}”, que pode enviar, comprar ou apagar algo`;
  if (action === 'type' && SENSITIVE_FIELD.test(target)) return `digita em um campo sensível (${target})`;
  if (action === 'type' && submit) return 'envia um formulário';
  return null;
}
