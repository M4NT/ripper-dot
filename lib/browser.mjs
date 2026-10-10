// Navegador por agente: Chromium no contêiner, daemon persistente.
// Snapshot de acessibilidade com refs estáveis (mapa no daemon — a página não planta data-*).
// Print leve após cada ação (e a cada ~2,5 s) para a aba Computador; JPEG 0600.
// IPC por arquivo no volume: O_NOFOLLOW, HMAC, allowlist, shred de cmd/res; scripts vão via exec para /opt.
import {
  mkdirSync, readFileSync, renameSync, lstatSync, unlinkSync,
  openSync, writeSync, closeSync, fsyncSync, chmodSync, constants
} from 'node:fs';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SETUP = `test -x /usr/bin/chromium && test -d /opt/ripper-browser/node_modules/puppeteer-core || (
  export DEBIAN_FRONTEND=noninteractive;
  apt-get update -qq >/dev/null && apt-get install -y -qq chromium fonts-liberation fonts-noto-color-emoji >/dev/null &&
  mkdir -p /opt/ripper-browser && cd /opt/ripper-browser && npm init -y >/dev/null && npm i -s puppeteer-core@23 >/dev/null
) && echo RIPPER_BROWSER_READY`;

const HEARTBEAT_MS = 4000;
const MAX_CMD_BYTES = 32_000;
export const BROWSER_ACTIONS = Object.freeze(['go', 'click', 'type', 'scroll', 'back', 'read', 'screenshot']);

const RISKY_CLICK = /\b(comprar|pagar|pagamento|finalizar|checkout|enviar|send|publicar|postar|post|excluir|apagar|deletar|delete|remove|confirmar|transferir|assinar|subscribe|buy|pay|submit|responder|reply|comentar|comment|curtir|like|seguir|follow|compartilhar|share|repostar|repost|retweet|tweet|mensagem|message)\b/i;
const SENSITIVE_FIELD = /(senha|password|passwd|cart[aã]o|card|cvv|cpf|token|secret)/i;

/** Ref estável (e12, @e12, ref=e12) ou null. */
export function parseBrowserRef(target) {
  const t = String(target || '').trim();
  const m = /^(?:@|ref=)?(e\d+)$/i.exec(t);
  return m ? m[1].toLowerCase() : null;
}

export function accessibleName(el) {
  const labelled = el && el.labelText ? el.labelText : '';
  const raw = (el && (el.ariaLabel || el.alt || labelled || el.placeholder || el.title || el.innerText || el.value || el.name)) || '';
  return String(raw).trim().replace(/\s+/g, ' ');
}

export function isSensitiveField(text) {
  return SENSITIVE_FIELD.test(String(text || ''));
}

/**
 * Escolhe um nó do snapshot: ref exato, nome exato, prefixo único ou inclusão única.
 * "Log" com Login+Logout devolve null (ambíguo).
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

/** Nome do controle para o portão: ref e7 → "Finalizar compra" se o snapshot tiver o nó. */
export function resolveRiskTarget(target, nodes) {
  const ref = parseBrowserRef(target);
  if (!ref) return String(target || '');
  const node = (nodes || []).find(n => n.ref === ref);
  return node && node.name ? String(node.name) : String(target || '');
}

export function renderA11ySnapshot(nodes) {
  return (nodes || []).map(n => {
    const name = n.name ? ' "' + String(n.name).replace(/"/g, '\\"') + '"' : '';
    const val = n.value != null && n.value !== '' ? ' = "' + String(n.value).replace(/"/g, '\\"') + '"' : '';
    const dis = n.disabled ? ' disabled' : '';
    return '- ' + (n.role || 'generic') + name + val + dis + ' [ref=' + n.ref + ']';
  }).join('\n');
}

/** Título, URL, snapshot; texto da página quando o daemon mandar (read). */
export function formatBrowserReply(d) {
  if (!d || typeof d !== 'object') return 'O navegador não devolveu JSON.';
  const lines = [];
  if (d.ok === false) lines.push('Erro: ' + (d.error || 'falhou'));
  if (d.title) lines.push('Página: ' + d.title);
  if (d.url) lines.push('URL: ' + d.url);
  const snap = d.snapshot || (d.nodes && d.nodes.length ? renderA11ySnapshot(d.nodes) : '');
  if (snap) lines.push('Snapshot:\n' + snap);
  else if (d.controls && d.controls.length) lines.push('Controles visíveis: ' + d.controls.join(' | '));
  if (d.text) lines.push('Texto:\n' + d.text);
  return lines.filter(Boolean).join('\n');
}

export function wantsScreenshot(cmd) {
  return !!(cmd && (cmd.action === 'screenshot' || cmd.screenshot === true));
}

export function actionDelayMs(cmd, env) {
  const pace = (cmd && cmd.pace) || (env && env.RIPPER_BROWSER_PACE) || '';
  return pace === 'human' ? 700 : 0;
}

export function actionTimeoutMs(action) {
  return action === 'go' ? 35_000 : 15_000;
}

export function sanitizeBrowserUrl(url) {
  let u = String(url || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  let parsed;
  try { parsed = new URL(u); } catch { return null; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.href;
}

export function sanitizeBrowserCommand(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (BROWSER_ACTIONS.indexOf(raw.action) < 0) return null;
  const id = String(raw.id || '');
  if (!id || id.length > 80) return null;
  const ts = Number(raw.ts);
  if (!Number.isFinite(ts)) return null;
  const out = { id: id, ts: ts, action: raw.action };
  if (raw.action === 'go') {
    const url = sanitizeBrowserUrl(raw.url);
    if (!url) return null;
    out.url = url;
  }
  if (raw.action === 'click' || raw.action === 'type') out.target = String(raw.target || '').slice(0, 200);
  if (raw.action === 'type') {
    out.text = String(raw.text == null ? '' : raw.text).slice(0, 8000);
    if (raw.submit) out.submit = true;
    if (raw.secret) out.secret = true;
  }
  if (raw.action === 'scroll') {
    const dy = Number(raw.dy);
    out.dy = Number.isFinite(dy) ? Math.max(-4000, Math.min(4000, Math.trunc(dy))) : 700;
  }
  if (raw.screenshot === true) out.screenshot = true;
  if (raw.pace === 'human') out.pace = 'human';
  if (raw.includeText === true || raw.action === 'read') out.includeText = true;
  return out;
}

export function shouldAcceptCommand(cmd, state) {
  if (!cmd || !cmd.id) return false;
  if (state && state.lastIds && state.lastIds.has(cmd.id)) return false;
  if (state && state.lastId && cmd.id === state.lastId) return false;
  if (state && state.bootAt && Number(cmd.ts) < Number(state.bootAt)) return false;
  return true;
}

export function signBrowserCommand(cmd, token) {
  const body = sanitizeBrowserCommand(cmd);
  if (!body || !token) return '';
  return createHmac('sha256', String(token)).update(JSON.stringify(body)).digest('hex').slice(0, 32);
}

export function verifyBrowserCommand(cmd, token) {
  if (!cmd || !token) return false;
  const expect = signBrowserCommand(cmd, token);
  const mac = String(cmd.mac || '');
  if (!expect || mac.length !== expect.length) return false;
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function assignSnapshotRefs(rawNodes) {
  const counts = new Map();
  return (rawNodes || []).map((n, i) => {
    const key = String(n.role || '') + '\0' + String(n.name || '') + '\0' + String(n.tag || '');
    const nth = counts.get(key) || 0;
    counts.set(key, nth + 1);
    const node = { ...n, ref: 'e' + (i + 1), nth: n.nth != null ? n.nth : nth };
    if (node.value && (isSensitiveField(node.name) || node.type === 'password')) delete node.value;
    return node;
  });
}

export function redactResult(d, cmd) {
  if (!d || typeof d !== 'object') return d;
  const secret = !!(cmd && (cmd.secret || isSensitiveField(cmd.target)));
  const nodes = (d.nodes || []).map(n => {
    const node = { ...n };
    if (secret || isSensitiveField(node.name) || node.type === 'password') delete node.value;
    return node;
  });
  const out = { ...d, nodes };
  if (out.snapshot) out.snapshot = renderA11ySnapshot(nodes);
  return out;
}

const O_NOFOLLOW = constants.O_NOFOLLOW || 0;
const EXCL_NOFOLLOW = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW;

export function writeFileNoFollow(fileUrl, data, { mode = 0o600 } = {}) {
  const dest = fileURLToPath(fileUrl);
  const tmp = dest + '.' + randomBytes(8).toString('hex') + '.tmp';
  let fd;
  try {
    fd = openSync(tmp, EXCL_NOFOLLOW, mode);
    writeSync(fd, typeof data === 'string' ? data : Buffer.from(data));
    try { fsyncSync(fd); } catch {}
  } catch (e) {
    try { unlinkSync(tmp); } catch {}
    throw e;
  } finally {
    if (fd != null) try { closeSync(fd); } catch {}
  }
  try { renameSync(tmp, dest); }
  catch (e) { try { unlinkSync(tmp); } catch {} throw e; }
}

export function writeJsonAtomic(fileUrl, obj) {
  writeFileNoFollow(fileUrl, JSON.stringify(obj));
}

export function readFileNoFollow(fileUrl, encoding = 'utf8') {
  const path = fileURLToPath(fileUrl);
  const st = lstatSync(path);
  if (st.isSymbolicLink()) {
    const err = new Error('Recusa symlink em ' + path);
    err.code = 'EROFS_SYMLINK';
    throw err;
  }
  if (!st.isFile()) throw new Error('Não é arquivo regular: ' + path);
  return readFileSync(path, encoding);
}

export function readJsonIf(fileUrl) {
  try { return JSON.parse(readFileNoFollow(fileUrl)); } catch { return null; }
}

export function unlinkNoFollow(fileUrl) {
  try { unlinkSync(fileURLToPath(fileUrl)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}

export function ensureDirNoFollow(dirUrl, mode = 0o700) {
  const p = fileURLToPath(dirUrl);
  try {
    const st = lstatSync(p);
    if (st.isSymbolicLink()) throw new Error('Recusa symlink no diretório do navegador.');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    mkdirSync(p, { recursive: true, mode });
  }
  try { chmodSync(p, mode); } catch {}
}

export function daemonHeartbeatFresh(scripts, now = Date.now(), maxAgeMs = HEARTBEAT_MS) {
  try {
    const d = JSON.parse(readFileNoFollow(new URL('alive', scripts)));
    if (!d || d.chromium !== true) return false;
    return now - Number(d.t) < maxAgeMs;
  } catch { return false; }
}

/** Roda no Chromium: descreve nós visíveis. Não grava atributo na página (refs ficam no daemon). */
export function pageCollectSnapshot() {
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
  const counts = new Map();
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
    const tag = (el.tagName || '').toLowerCase();
    const type = (el.type || '').toLowerCase();
    const key = role + '\0' + name + '\0' + tag;
    const nth = counts.get(key) || 0;
    counts.set(key, nth + 1);
    const node = { role: role, name: name, tag: tag, type: type, nth: nth };
    if (el.disabled) node.disabled = true;
    if (el.value && type !== 'password' && role !== 'heading' && role !== 'paragraph') node.value = String(el.value).slice(0, 40);
    nodes.push(node);
  }
  return nodes;
}

export function pageFindByFingerprint(fp) {
  if (!fp) return null;
  function visible(el) {
    if (!el || el.hidden) return false;
    if (el.closest && el.closest('[hidden], [aria-hidden="true"]')) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
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
  const hits = [];
  const list = document.querySelectorAll('a,button,input,textarea,select,summary,label,[role],[onclick],[contenteditable],h1,h2,h3,h4,p,img');
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    if (!visible(el)) continue;
    if (roleOf(el) !== fp.role) continue;
    if (nameOf(el) !== fp.name) continue;
    if (fp.tag && (el.tagName || '').toLowerCase() !== fp.tag) continue;
    hits.push(el);
  }
  if (!hits.length) return null;
  if (hits.length === 1) return hits[0];
  const nth = Number(fp.nth);
  return hits[Number.isFinite(nth) ? nth : 0] || null;
}

export function pageFindElement(target) {
  const t = String(target || '').trim();
  if (!t) {
    const focused = document.activeElement;
    if (focused && focused !== document.body && focused !== document.documentElement) return focused;
    return document.querySelector('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]),textarea,[contenteditable="true"]');
  }
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
  const list = document.querySelectorAll('a,button,input,textarea,select,summary,label,[role],[onclick],[contenteditable]');
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
    "import { writeFileSync, readFileSync, renameSync, mkdirSync, unlinkSync, statSync, chmodSync } from 'node:fs';",
    "import { createHmac, timingSafeEqual } from 'node:crypto';",
    "const require = createRequire('/opt/ripper-browser/');",
    "const puppeteer = require('puppeteer-core');",
    "const DIR = '/work/.ripper';",
    "const CMD = DIR + '/cmd.json';",
    "const RES = DIR + '/res.json';",
    "const ALIVE = DIR + '/alive';",
    "const SHOT = DIR + '/screen.jpg';",
    "const MAX_CMD_BYTES = " + MAX_CMD_BYTES + ";",
    "const BOOT = Date.now();",
    "const TOKEN = process.env.RIPPER_BROWSER_TOKEN || '';",
    "mkdirSync(DIR, { recursive: true, mode: 0o700 });",
    "try { chmodSync(DIR, 0o700); } catch {}",
    "const wait = ms => new Promise(r => setTimeout(r, ms));",
    "const BROWSER_ACTIONS = " + JSON.stringify(BROWSER_ACTIONS) + ";",
    "const parseBrowserRef = " + parseBrowserRef.toString() + ";",
    "const renderA11ySnapshot = " + renderA11ySnapshot.toString() + ";",
    "const wantsScreenshot = " + wantsScreenshot.toString() + ";",
    "const actionDelayMs = " + actionDelayMs.toString() + ";",
    "const actionTimeoutMs = " + actionTimeoutMs.toString() + ";",
    "const sanitizeBrowserUrl = " + sanitizeBrowserUrl.toString() + ";",
    "const sanitizeBrowserCommand = " + sanitizeBrowserCommand.toString() + ";",
    "const shouldAcceptCommand = " + shouldAcceptCommand.toString() + ";",
    "const signBrowserCommand = " + signBrowserCommand.toString() + ";",
    "const verifyBrowserCommand = " + verifyBrowserCommand.toString() + ";",
    "const assignSnapshotRefs = " + assignSnapshotRefs.toString() + ";",
    "const isSensitiveField = " + isSensitiveField.toString() + ";",
    "const SENSITIVE_FIELD = /(senha|password|passwd|cart[aã]o|card|cvv|cpf|token|secret)/i;",
    "const redactResult = " + redactResult.toString() + ";",
    "const pageCollectSnapshot = " + pageCollectSnapshot.toString() + ";",
    "const pageFindByFingerprint = " + pageFindByFingerprint.toString() + ";",
    "const pageFindElement = " + pageFindElement.toString() + ";",
    "const writeJsonAtomic = (file, obj) => { const tmp = file + '.' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.tmp'; writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 }); renameSync(tmp, file); };",
    "async function beat() {",
    "  let chromium = false;",
    "  try { chromium = await Promise.race([page.evaluate(() => true), wait(2000).then(() => false)]); } catch {}",
    "  writeJsonAtomic(ALIVE, { t: Date.now(), chromium: !!chromium });",
    "}",
    "const headful = !!process.env.DISPLAY;",
    "const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null }).catch(() => null) || await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: !headful, userDataDir: '/work/.ripper/chromium',",
    "  args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=pt-BR', '--no-first-run', '--no-default-browser-check',",
    "    ...(headful ? ['--start-maximized', '--window-position=0,0', '--window-size=1280,800'] : [])],",
    "  defaultViewport: headful ? null : { width: 1280, height: 800 } });",
    "browser.on('disconnected', () => process.exit(0));",
    "let page = (await browser.pages())[0] || await browser.newPage();",
    "browser.on('targetcreated', async t => { const p = await t.page().catch(() => null); if (p) page = p; });",
    "const current = async () => { if (page.isClosed()) page = (await browser.pages()).at(-1) || await browser.newPage(); return page; };",
    "const shot = async (q) => { await page.screenshot({ path: SHOT, type: 'jpeg', quality: q || 40 }).catch(() => {}); try { chmodSync(SHOT, 0o600); } catch {} };",
    "let lastNodes = [];",
    "async function summary(cmd) {",
    "  const title = await page.title().catch(() => '');",
    "  const raw = await page.evaluate(pageCollectSnapshot).catch(() => []);",
    "  lastNodes = assignSnapshotRefs(raw);",
    "  const out = { title, url: page.url(), nodes: lastNodes, snapshot: renderA11ySnapshot(lastNodes) };",
    "  if (cmd && cmd.includeText) {",
    "    out.text = (await page.evaluate(() => (document.body && document.body.innerText) || '').catch(() => '')).replace(/\\n{3,}/g, '\\n\\n').slice(0, 3000);",
    "  }",
    "  return redactResult(out, cmd);",
    "}",
    "async function find(target) {",
    "  const ref = parseBrowserRef(target);",
    "  if (ref) {",
    "    const fp = lastNodes.find(n => n.ref === ref);",
    "    if (!fp) return null;",
    "    const h = await page.evaluateHandle(pageFindByFingerprint, fp);",
    "    return h.asElement();",
    "  }",
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
    "async function withTimeout(p, ms, label) {",
    "  let t;",
    "  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('Tempo esgotado: ' + label)), ms); });",
    "  try { return await Promise.race([p, timeout]); } finally { clearTimeout(t); }",
    "}",
    "const actions = {",
    "  go: async ({ url }) => { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); },",
    "  click: async ({ target }) => { const raw = await page.evaluate(pageCollectSnapshot).catch(() => []); lastNodes = assignSnapshotRefs(raw); const el = await find(target); if (!el) throw new Error('Não achei: ' + target); await el.click(); },",
    "  type: async (cmd) => {",
    "    const raw = await page.evaluate(pageCollectSnapshot).catch(() => []); lastNodes = assignSnapshotRefs(raw);",
    "    const el = await find(cmd.target); if (!el) throw new Error('Não achei o campo: ' + cmd.target);",
    "    await el.click({ clickCount: 3 });",
    "    const delay = actionDelayMs(cmd, process.env);",
    "    if (delay) await el.type(cmd.text, { delay: 45 }); else await el.type(cmd.text);",
    "    if (cmd.submit) await page.keyboard.press('Enter');",
    "  },",
    "  scroll: async ({ dy = 700 }) => { await page.mouse.wheel({ deltaY: dy }); },",
    "  back: async () => { await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {}); },",
    "  read: async () => {},",
    "  screenshot: async () => { await shot(60); }",
    "};",
    "let lastId = '';",
    "const lastIds = new Set();",
    "try { const leftover = JSON.parse(readFileSync(CMD, 'utf8')); if (!shouldAcceptCommand(leftover, { bootAt: BOOT, lastId: '', lastIds })) unlinkSync(CMD); } catch {}",
    "async function handle(rawCmd) {",
    "  if (TOKEN && !verifyBrowserCommand(rawCmd, TOKEN)) return;",
    "  const cmd = sanitizeBrowserCommand(rawCmd);",
    "  if (!shouldAcceptCommand(cmd, { bootAt: BOOT, lastId, lastIds })) return;",
    "  lastId = cmd.id;",
    "  lastIds.add(cmd.id);",
    "  if (lastIds.size > 64) lastIds.delete(lastIds.values().next().value);",
    "  try { unlinkSync(CMD); } catch {}",
    "  await current();",
    "  await maybePace(cmd);",
    "  try {",
    "    const fn = actions[cmd.action];",
    "    if (!fn) throw new Error('Ação desconhecida: ' + cmd.action);",
    "    await withTimeout(fn(cmd), actionTimeoutMs(cmd.action), cmd.action);",
    "    await settle();",
    "    await shot(wantsScreenshot(cmd) ? 60 : 40);",
    "    writeJsonAtomic(RES, { id: cmd.id, ok: true, ...(await summary(cmd)) });",
    "  } catch (e) {",
    "    await shot(40);",
    "    writeJsonAtomic(RES, { id: cmd.id, ok: false, error: e.message, ...(await summary(cmd)) });",
    "  }",
    "  await beat();",
    "}",
    "let running = false;",
    "async function tick() {",
    "  if (running) return;",
    "  let raw;",
    "  try {",
    "    const st = statSync(CMD);",
    "    if (st.size > MAX_CMD_BYTES) { unlinkSync(CMD); return; }",
    "    raw = JSON.parse(readFileSync(CMD, 'utf8'));",
    "  } catch { return; }",
    "  running = true;",
    "  try { await handle(raw); } finally { running = false; }",
    "}",
    "setInterval(() => { tick().catch(() => {}); }, 40);",
    "setInterval(() => { beat().catch(() => {}); }, 1000);",
    "setInterval(() => { shot(40).catch(() => {}); }, 2500);",
    "await beat();"
  ].join('\n');
}

let cachedDaemon;
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
    if (Date.now() - t0 > 2000 && !daemonHeartbeatFresh(scripts)) return null;
    await sleep(pollMs);
  }
  return null;
}

function deployCommand(token, restart) {
  const b64 = Buffer.from(daemonSource()).toString('base64');
  const killWait = restart
    ? `(pkill -f /opt/ripper-browser/browserd.mjs || true); for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do pgrep -f /opt/ripper-browser/browserd.mjs >/dev/null || break; sleep 0.05; done;`
    : `true`;
  const start = `(pgrep -f /opt/ripper-browser/browserd.mjs >/dev/null && test '${restart ? 1 : 0}' = '0') || nohup env RIPPER_BROWSER_TOKEN='${token}' node /opt/ripper-browser/browserd.mjs >/tmp/browserd.log 2>&1 &`;
  return [SETUP, 'mkdir -p /opt/ripper-browser', "printf '%s' '" + b64 + "' | base64 -d > /opt/ripper-browser/browserd.mjs", killWait, start, 'echo RIPPER_BROWSER_DAEMON'].join(' && ');
}

/** Navegador de um agente. raw = computador Docker sem o portão de aprovação (instalação interna). */
export function browserFor(raw, dirUrl, opts = {}) {
  let ready = false;
  let lastNodes = [];
  let chain = Promise.resolve();
  const scripts = new URL('.ripper/', dirUrl);
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const pollMs = opts.pollMs ?? 20;
  const token = opts.token || randomBytes(16).toString('hex');
  const srcHash = createHash('sha1').update(daemonSource()).digest('hex').slice(0, 12);
  let deployedRev = '';

  function wipeIpc() {
    unlinkNoFollow(new URL('cmd.json', scripts));
    unlinkNoFollow(new URL('res.json', scripts));
  }

  async function setup() {
    ensureDirNoFollow(scripts, 0o700);
    wipeIpc();
    const alive = daemonHeartbeatFresh(scripts);
    if (ready && alive && deployedRev === srcHash) return;
    const restart = deployedRev !== '' && deployedRev !== srcHash;
    const r = await raw.exec(deployCommand(token, restart || !alive));
    if (!r.includes('RIPPER_BROWSER_READY')) throw new Error('Não consegui preparar o navegador no computador do agente: ' + r.slice(-300));
    deployedRev = srcHash;
    ready = true;
    const t0 = Date.now();
    while (!daemonHeartbeatFresh(scripts) && Date.now() - t0 < 15_000) await sleep(40);
  }

  async function runOnce(cmd) {
    await setup();
    const id = randomBytes(8).toString('hex');
    const ts = Date.now();
    const secret = !!(cmd.secret || (cmd.action === 'type' && (isSensitiveField(cmd.target) || isSensitiveField(resolveRiskTarget(cmd.target, lastNodes)))));
    const payload = sanitizeBrowserCommand({ id, ts, secret, ...cmd, id, ts, secret });
    if (!payload) return 'Comando de navegador inválido.';
    wipeIpc();
    const signed = { ...payload, mac: signBrowserCommand(payload, token) };
    writeFileNoFollow(new URL('cmd.json', scripts), JSON.stringify(signed), { mode: 0o600 });
    let d = await waitForResult(scripts, id, { timeoutMs, pollMs });
    if (!d && !daemonHeartbeatFresh(scripts)) {
      ready = false;
      wipeIpc();
      await setup();
      d = await waitForResult(scripts, id, { timeoutMs: Math.min(timeoutMs, 30_000), pollMs });
    }
    wipeIpc();
    if (!d) return 'O navegador não respondeu a tempo (daemon ou Chromium).';
    const clean = redactResult(d, payload);
    if (Array.isArray(clean.nodes)) lastNodes = clean.nodes;
    return formatBrowserReply(clean);
  }

  function run(cmd) {
    const p = chain.then(() => runOnce(cmd));
    chain = p.catch(() => {});
    return p;
  }

  const api = {
    open: (url, extra) => run({ action: 'go', url, ...(isObj(extra) ? extra : {}) }),
    click: (target, extra) => run({ action: 'click', target, ...(isObj(extra) ? extra : {}) }),
    type: (target, text, submit, extra) => {
      const more = isObj(submit) ? submit : { submit, ...(isObj(extra) ? extra : {}) };
      return run({ action: 'type', target, text, ...more });
    },
    scroll: (dy, extra) => isObj(dy) ? run({ action: 'scroll', ...dy }) : run({ action: 'scroll', dy, ...(isObj(extra) ? extra : {}) }),
    back: extra => run({ action: 'back', ...(isObj(extra) ? extra : {}) }),
    read: extra => run({ action: 'read', includeText: true, ...(isObj(extra) ? extra : {}) }),
    screenshot: extra => run({ action: 'screenshot', screenshot: true, ...(isObj(extra) ? extra : {}) }),
    snapshotNodes: () => lastNodes,
    labelOf: target => resolveRiskTarget(target, lastNodes),
    risk: (action, opts) => browserRisk(action, { ...(opts || {}), nodes: lastNodes })
  };
  return api;
}

// Ações de navegador que precisam do seu ok (rascunho antes de enviar).
// Com refs, passe nodes (último snapshot) ou use browserFor().risk — senão o alvo "e7" fura o portão.
export function browserRisk(action, { target = '', submit = false, nodes } = {}) {
  const label = resolveRiskTarget(target, nodes);
  if (action === 'click' && RISKY_CLICK.test(label)) return `clica em “${label}”, que pode enviar, comprar ou apagar algo`;
  if (action === 'type' && SENSITIVE_FIELD.test(label)) return `digita em um campo sensível (${label})`;
  if (action === 'type' && submit) return 'envia um formulário';
  return null;
}
