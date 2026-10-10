// Navegador por agente: Chromium no contêiner Docker, daemon persistente.
// Cada ação devolve um snapshot de acessibilidade com refs estáveis (e1, e2…) para clicar/digitar.
// Screenshot em /work/.ripper/screen.jpg só quando pedido (action=screenshot ou screenshot:true).
import { mkdirSync, writeFileSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Instala Chromium + puppeteer-core no contêiner (uma vez; fica no contêiner até ele ser removido).
const SETUP = `test -x /usr/bin/chromium && test -d /opt/ripper-browser/node_modules/puppeteer-core || (
  export DEBIAN_FRONTEND=noninteractive;
  apt-get update -qq >/dev/null && apt-get install -y -qq chromium fonts-liberation fonts-noto-color-emoji >/dev/null &&
  mkdir -p /opt/ripper-browser && cd /opt/ripper-browser && npm init -y >/dev/null && npm i -s puppeteer-core@23 >/dev/null
) && echo RIPPER_BROWSER_READY`;

const HEARTBEAT_MS = 4000;

/** Ref estável (e12, @e12, ref=e12) ou null. */
export function parseBrowserRef(target) {
  const t = String(target || '').trim();
  const m = /^(?:@|ref=)?(e\d+)$/i.exec(t);
  return m ? m[1].toLowerCase() : null;
}

/** Nome acessível a partir dos campos comuns (sem DOM). */
export function accessibleName(el) {
  const labelled = el && el.labelText ? el.labelText : '';
  const raw = (el && (el.ariaLabel || el.alt || labelled || el.placeholder || el.title || el.innerText || el.value || el.name)) || '';
  return String(raw).trim().replace(/\s+/g, ' ');
}

/**
 * Escolhe um nó do snapshot: ref exato, nome exato, prefixo único ou inclusão única.
 * "Log" com Login+Logout devolve null (ambíguo) — o find() antigo usava includes() e pegava o primeiro.
 */
export function matchAccessibleTarget(target, nodes) {
  const ref = parseBrowserRef(target);
  const list = nodes || [];
  if (ref) return list.find(n => n.ref === ref) || null;
  const t = String(target || '').trim().toLowerCase();
  if (!t) return null;
  const nameOf = n => String(n.name || '').toLowerCase();
  const exact = list.filter(n => nameOf(n) === t);
  if (exact.length) return exact[0];
  const prefix = list.filter(n => nameOf(n).startsWith(t));
  if (prefix.length === 1) return prefix[0];
  const inc = list.filter(n => nameOf(n).includes(t));
  if (inc.length === 1) return inc[0];
  return null;
}

/** Snapshot compacto para o modelo: role, nome e ref. Sem template string (injetado no daemon). */
export function renderA11ySnapshot(nodes) {
  return (nodes || []).map(n => {
    const name = n.name ? ' "' + String(n.name).replace(/"/g, '\\"') + '"' : '';
    const val = n.value != null && n.value !== '' ? ' = "' + String(n.value).replace(/"/g, '\\"') + '"' : '';
    const dis = n.disabled ? ' disabled' : '';
    return '- ' + (n.role || 'generic') + name + val + dis + ' [ref=' + n.ref + ']';
  }).join('\n');
}

/** Resposta enxuta: título, URL e snapshot. innerText longo só como fallback de daemon antigo. */
export function formatBrowserReply(d) {
  if (!d || typeof d !== 'object') return 'O navegador não devolveu JSON.';
  const lines = [];
  if (d.ok === false) lines.push('Erro: ' + (d.error || 'falhou'));
  if (d.title) lines.push('Página: ' + d.title);
  if (d.url) lines.push('URL: ' + d.url);
  const snap = d.snapshot || (d.nodes && d.nodes.length ? renderA11ySnapshot(d.nodes) : '');
  if (snap) lines.push('Snapshot:\n' + snap);
  else if (d.controls && d.controls.length) lines.push('Controles visíveis: ' + d.controls.join(' | '));
  if (!snap && d.text) lines.push('Texto:\n' + d.text);
  return lines.filter(Boolean).join('\n');
}

export function wantsScreenshot(cmd) {
  return !!(cmd && (cmd.action === 'screenshot' || cmd.screenshot === true));
}

/** 0 por padrão. pace=human (cmd ou RIPPER_BROWSER_PACE) reativa a cadência antiga. */
export function actionDelayMs(cmd, env) {
  const pace = (cmd && cmd.pace) || (env && env.RIPPER_BROWSER_PACE) || '';
  return pace === 'human' ? 700 : 0;
}

export function writeJsonAtomic(fileUrl, obj) {
  const tmp = new URL(fileUrl.href + '.tmp');
  writeFileSync(tmp, JSON.stringify(obj));
  renameSync(tmp, fileUrl);
}

export function readJsonIf(fileUrl) {
  try { return JSON.parse(readFileSync(fileUrl, 'utf8')); } catch { return null; }
}

export function daemonHeartbeatFresh(scripts, now = Date.now(), maxAgeMs = HEARTBEAT_MS) {
  try { return now - statSync(new URL('alive', scripts)).mtimeMs < maxAgeMs; } catch { return false; }
}

/** Roda no Chromium (page.evaluate): marca data-ripper-ref estável e devolve os nós. */
export function pageCollectSnapshot() {
  const attr = 'data-ripper-ref';
  let next = 1;
  document.querySelectorAll('[' + attr + ']').forEach(el => {
    const n = parseInt(String(el.getAttribute(attr) || '').replace(/^e/i, ''), 10);
    if (n >= next) next = n + 1;
  });
  function visible(el) {
    if (!el || el.hidden) return false;
    if (el.closest && el.closest('[hidden], [aria-hidden="true"]')) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function roleOf(el) {
    const role = el.getAttribute('role');
    if (role) return role;
    const tag = (el.tagName || '').toLowerCase();
    const type = (el.type || '').toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'input') {
      if (type === 'submit' || type === 'button' || type === 'reset' || type === 'file') return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      return 'textbox';
    }
    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') return 'heading';
    if (tag === 'img') return 'image';
    if (tag === 'label') return 'label';
    if (tag === 'p') return 'paragraph';
    return 'generic';
  }
  function nameOf(el) {
    let labelled = '';
    if (el.labels && el.labels[0]) labelled = el.labels[0].innerText || '';
    const raw = el.getAttribute('aria-label') || el.getAttribute('alt') || labelled || el.placeholder || el.title || el.innerText || el.value || el.name || '';
    return String(raw).trim().replace(/\s+/g, ' ').slice(0, 80);
  }
  const seen = new Set();
  const nodes = [];
  let paragraphs = 0;
  const list = document.querySelectorAll('a,button,input,textarea,select,summary,h1,h2,h3,h4,label,img,[role],[onclick],p');
  for (let i = 0; i < list.length && nodes.length < 80; i++) {
    const el = list[i];
    if (!visible(el) || seen.has(el)) continue;
    const role = roleOf(el);
    if (role === 'paragraph') {
      if (paragraphs >= 12) continue;
      paragraphs += 1;
    }
    const name = nameOf(el);
    if (role === 'generic' && !name) continue;
    seen.add(el);
    if (!el.getAttribute(attr)) {
      el.setAttribute(attr, 'e' + next);
      next += 1;
    }
    const node = { ref: el.getAttribute(attr), role: role, name: name };
    if (el.disabled) node.disabled = true;
    const type = (el.type || '').toLowerCase();
    if (el.value && type !== 'password' && role !== 'heading' && role !== 'paragraph') node.value = String(el.value).slice(0, 40);
    nodes.push(node);
  }
  return nodes;
}

/** Roda no Chromium (evaluateHandle): ref, nome preciso, depois seletor CSS. */
export function pageFindElement(target) {
  const t = String(target || '').trim();
  if (!t) {
    const focused = document.activeElement;
    if (focused && focused !== document.body && focused !== document.documentElement) return focused;
    return document.querySelector('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]),textarea,[contenteditable="true"]');
  }
  const m = /^(?:@|ref=)?(e\d+)$/i.exec(t);
  if (m) return document.querySelector('[data-ripper-ref="' + m[1].toLowerCase() + '"]');
  function visible(el) {
    if (!el || el.hidden) return false;
    if (el.closest && el.closest('[hidden], [aria-hidden="true"]')) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function nameOf(el) {
    let labelled = '';
    if (el.labels && el.labels[0]) labelled = el.labels[0].innerText || '';
    const raw = el.getAttribute('aria-label') || el.getAttribute('alt') || labelled || el.placeholder || el.title || el.innerText || el.value || el.name || '';
    return String(raw).trim().replace(/\s+/g, ' ');
  }
  const candidates = [];
  const list = document.querySelectorAll('a,button,input,textarea,select,summary,label,[role],[onclick],[contenteditable],[data-ripper-ref]');
  for (let i = 0; i < list.length; i++) if (visible(list[i])) candidates.push(list[i]);
  const low = t.toLowerCase();
  const exact = candidates.filter(el => nameOf(el).toLowerCase() === low);
  if (exact.length) return exact[0];
  const prefix = candidates.filter(el => nameOf(el).toLowerCase().startsWith(low));
  if (prefix.length === 1) return prefix[0];
  const inc = candidates.filter(el => nameOf(el).toLowerCase().includes(low));
  if (inc.length === 1) return inc[0];
  try {
    const bySel = document.querySelector(t);
    if (bySel && visible(bySel)) return bySel;
  } catch {}
  return null;
}

function isObj(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function buildDaemon() {
  return [
    "import { createRequire } from 'node:module';",
    "import { writeFileSync, readFileSync, renameSync, mkdirSync, watch } from 'node:fs';",
    "const require = createRequire('/opt/ripper-browser/');",
    "const puppeteer = require('puppeteer-core');",
    "const DIR = '/work/.ripper';",
    "const CMD = DIR + '/cmd.json';",
    "const RES = DIR + '/res.json';",
    "const ALIVE = DIR + '/alive';",
    "const SHOT = DIR + '/screen.jpg';",
    "mkdirSync(DIR, { recursive: true });",
    "const writeAlive = () => { try { writeFileSync(ALIVE, String(Date.now())); } catch {} };",
    "writeAlive();",
    "setInterval(writeAlive, 1000);",
    "const wait = ms => new Promise(r => setTimeout(r, ms));",
    "const parseBrowserRef = " + parseBrowserRef.toString() + ";",
    "const renderA11ySnapshot = " + renderA11ySnapshot.toString() + ";",
    "const wantsScreenshot = " + wantsScreenshot.toString() + ";",
    "const actionDelayMs = " + actionDelayMs.toString() + ";",
    "const pageCollectSnapshot = " + pageCollectSnapshot.toString() + ";",
    "const pageFindElement = " + pageFindElement.toString() + ";",
    "const writeJsonAtomic = (file, obj) => { writeFileSync(file + '.tmp', JSON.stringify(obj)); renameSync(file + '.tmp', file); };",
    "const headful = !!process.env.DISPLAY;",
    "const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null }).catch(() => null) || await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: !headful, userDataDir: '/work/.ripper/chromium',",
    "  args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=pt-BR', '--no-first-run', '--no-default-browser-check',",
    "    ...(headful ? ['--start-maximized', '--window-position=0,0', '--window-size=1280,800'] : [])],",
    "  defaultViewport: headful ? null : { width: 1280, height: 800 } });",
    "browser.on('disconnected', () => process.exit(0));",
    "let page = (await browser.pages())[0] || await browser.newPage();",
    "browser.on('targetcreated', async t => { const p = await t.page().catch(() => null); if (p) page = p; });",
    "const current = async () => { if (page.isClosed()) page = (await browser.pages()).at(-1) || await browser.newPage(); return page; };",
    "const shot = () => page.screenshot({ path: SHOT, type: 'jpeg', quality: 60 }).catch(() => {});",
    "async function summary() {",
    "  const title = await page.title().catch(() => '');",
    "  const nodes = await page.evaluate(pageCollectSnapshot).catch(() => []);",
    "  return { title, url: page.url(), nodes, snapshot: renderA11ySnapshot(nodes) };",
    "}",
    "async function find(target) {",
    "  const ref = parseBrowserRef(target);",
    "  if (ref) { const el = await page.$('[data-ripper-ref=\"' + ref + '\"]'); if (el) return el; }",
    "  const h = await page.evaluateHandle(pageFindElement, target);",
    "  return h.asElement();",
    "}",
    "async function settle() {",
    "  try { await page.waitForFunction(() => document.readyState === 'complete' || document.readyState === 'interactive', { timeout: 1500 }); } catch {}",
    "}",
    "async function maybePace(cmd) {",
    "  const ms = actionDelayMs(cmd, process.env);",
    "  if (ms) await wait(ms + Math.random() * 1300);",
    "}",
    "const actions = {",
    "  go: async ({ url }) => { await page.goto(/^https?:/.test(url) ? url : 'https://' + url, { waitUntil: 'domcontentloaded', timeout: 30000 }); },",
    "  click: async ({ target }) => { await page.evaluate(pageCollectSnapshot).catch(() => {}); const el = await find(target); if (!el) throw new Error('Não achei: ' + target); await el.click(); },",
    "  type: async (cmd) => {",
    "    const target = cmd.target, text = cmd.text, submit = cmd.submit;",
    "    await page.evaluate(pageCollectSnapshot).catch(() => {});",
    "    const el = await find(target); if (!el) throw new Error('Não achei o campo: ' + target);",
    "    await el.click({ clickCount: 3 });",
    "    const delay = actionDelayMs(cmd, process.env);",
    "    if (delay) await el.type(text, { delay: 45 }); else await el.type(text);",
    "    if (submit) await page.keyboard.press('Enter');",
    "  },",
    "  scroll: async ({ dy = 700 }) => { await page.evaluate(y => window.scrollBy(0, y), dy); },",
    "  back: async () => { await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {}); },",
    "  read: async () => {},",
    "  screenshot: async () => { await shot(); }",
    "};",
    "let lastId = '';",
    "async function handle(cmd) {",
    "  if (!cmd || !cmd.id || cmd.id === lastId) return;",
    "  lastId = cmd.id;",
    "  await current();",
    "  await maybePace(cmd);",
    "  try {",
    "    const fn = actions[cmd.action];",
    "    if (!fn) throw new Error('Ação desconhecida: ' + cmd.action);",
    "    await fn(cmd);",
    "    await settle();",
    "    if (wantsScreenshot(cmd) && cmd.action !== 'screenshot') await shot();",
    "    writeJsonAtomic(RES, { id: cmd.id, ok: true, ...(await summary()) });",
    "  } catch (e) {",
    "    if (wantsScreenshot(cmd)) await shot();",
    "    writeJsonAtomic(RES, { id: cmd.id, ok: false, error: e.message, ...(await summary()) });",
    "  }",
    "}",
    "async function tick() {",
    "  let cmd;",
    "  try { cmd = JSON.parse(readFileSync(CMD, 'utf8')); } catch { return; }",
    "  await handle(cmd);",
    "}",
    "try { watch(DIR, () => { tick().catch(() => {}); }); } catch {}",
    "setInterval(() => { tick().catch(() => {}); }, 40);",
    "await tick();"
  ].join('\n');
}

const STARTER = [
  "import { spawn, execSync } from 'node:child_process';",
  "import { statSync } from 'node:fs';",
  "const force = process.argv.includes('--restart');",
  "let fresh = false;",
  "try { fresh = Date.now() - statSync('/work/.ripper/alive').mtimeMs < 4000; } catch {}",
  "if (force || !fresh) {",
  "  try { execSync('pkill -f /work/.ripper/browserd.mjs', { stdio: 'ignore' }); } catch {}",
  "  spawn('node', ['/work/.ripper/browserd.mjs'], { detached: true, stdio: 'ignore' }).unref();",
  "}",
  "console.log('RIPPER_BROWSER_DAEMON');"
].join('\n');

let cachedDaemon;
/** Fonte do daemon (para testes e para gravar em .ripper/browserd.mjs). */
export function daemonSource() {
  return cachedDaemon ||= buildDaemon();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForResult(scripts, id, { timeoutMs, pollMs }) {
  const resUrl = new URL('res.json', scripts);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const d = readJsonIf(resUrl);
    if (d && d.id === id) return d;
    await sleep(pollMs);
  }
  return null;
}

/** Navegador de um agente. raw = computador Docker sem o portão de aprovação (instalação interna). */
export function browserFor(raw, dirUrl, opts = {}) {
  let ready = false;
  const scripts = new URL('.ripper/', dirUrl);
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const pollMs = opts.pollMs ?? 20;

  async function setup() {
    mkdirSync(scripts, { recursive: true });
    const src = daemonSource();
    writeFileSync(new URL('browserd.mjs', scripts), src);
    writeFileSync(new URL('bstart.mjs', scripts), STARTER);
    const rev = createHash('sha1').update(src).digest('hex').slice(0, 12);
    let prev = '';
    try { prev = readFileSync(new URL('daemon.rev', scripts), 'utf8'); } catch {}
    const alive = daemonHeartbeatFresh(scripts);
    if (ready && alive && prev === rev) return;
    const restart = prev !== rev && prev !== '';
    const r = await raw.exec(SETUP + ' && node /work/.ripper/bstart.mjs' + (restart ? ' --restart' : ''));
    if (!r.includes('RIPPER_BROWSER_READY')) throw new Error('Não consegui preparar o navegador no computador do agente: ' + r.slice(-300));
    writeFileSync(new URL('daemon.rev', scripts), rev);
    ready = true;
    const t0 = Date.now();
    while (!daemonHeartbeatFresh(scripts) && Date.now() - t0 < 15_000) await sleep(40);
  }

  async function run(cmd) {
    await setup();
    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    try { unlinkSync(new URL('res.json', scripts)); } catch {}
    writeJsonAtomic(new URL('cmd.json', scripts), { id, ...cmd });
    let d = await waitForResult(scripts, id, { timeoutMs, pollMs });
    if (!d && !daemonHeartbeatFresh(scripts)) {
      ready = false;
      await setup();
      d = await waitForResult(scripts, id, { timeoutMs: Math.min(timeoutMs, 30_000), pollMs });
    }
    if (!d) return 'O navegador não respondeu a tempo (daemon ou Chromium).';
    return formatBrowserReply(d);
  }

  return {
    open: (url, extra) => run({ action: 'go', url, ...(isObj(extra) ? extra : {}) }),
    click: (target, extra) => run({ action: 'click', target, ...(isObj(extra) ? extra : {}) }),
    type: (target, text, submit, extra) => {
      const more = isObj(submit) ? submit : { submit, ...(isObj(extra) ? extra : {}) };
      return run({ action: 'type', target, text, ...more });
    },
    scroll: (dy, extra) => isObj(dy) ? run({ action: 'scroll', ...dy }) : run({ action: 'scroll', dy, ...(isObj(extra) ? extra : {}) }),
    back: extra => run({ action: 'back', ...(isObj(extra) ? extra : {}) }),
    read: extra => run({ action: 'read', ...(isObj(extra) ? extra : {}) }),
    screenshot: extra => run({ action: 'screenshot', screenshot: true, ...(isObj(extra) ? extra : {}) })
  };
}

// Ações de navegador que precisam do seu ok (rascunho antes de enviar).
// Inclui interações em redes sociais (responder, comentar, curtir, seguir, mandar mensagem): o agente age como uma pessoa, com o seu ok.
const RISKY_CLICK = /\b(comprar|pagar|pagamento|finalizar|checkout|enviar|send|publicar|postar|post|excluir|apagar|deletar|delete|remove|confirmar|transferir|assinar|subscribe|buy|pay|submit|responder|reply|comentar|comment|curtir|like|seguir|follow|compartilhar|share|repostar|repost|retweet|tweet|mensagem|message)\b/i;
const SENSITIVE_FIELD = /(senha|password|passwd|cart[aã]o|card|cvv|cpf|token|secret)/i;
export function browserRisk(action, { target = '', submit = false } = {}) {
  if (action === 'click' && RISKY_CLICK.test(target)) return `clica em “${target}”, que pode enviar, comprar ou apagar algo`;
  if (action === 'type' && SENSITIVE_FIELD.test(target)) return `digita em um campo sensível (${target})`;
  if (action === 'type' && submit) return 'envia um formulário';
  return null;
}
