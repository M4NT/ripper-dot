import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, renameSync, existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  parseBrowserRef,
  matchAccessibleTarget,
  renderA11ySnapshot,
  formatBrowserReply,
  wantsScreenshot,
  actionDelayMs,
  accessibleName,
  daemonSource,
  daemonHeartbeatFresh,
  writeJsonAtomic,
  readJsonIf,
  browserFor,
  browserRisk
} from '../lib/browser.mjs';

function fakeDaemon(scriptsDir, handle) {
  mkdirSync(scriptsDir, { recursive: true });
  const cmdPath = join(scriptsDir, 'cmd.json');
  const resPath = join(scriptsDir, 'res.json');
  const alivePath = join(scriptsDir, 'alive');
  let last = '';
  const t = setInterval(() => {
    writeFileSync(alivePath, String(Date.now()));
    let raw;
    try { raw = readFileSync(cmdPath, 'utf8'); } catch { return; }
    if (raw === last) return;
    last = raw;
    let cmd;
    try { cmd = JSON.parse(raw); } catch { return; }
    const out = handle(cmd) || {};
    writeFileSync(resPath + '.tmp', JSON.stringify({ id: cmd.id, ok: true, ...out }));
    renameSync(resPath + '.tmp', resPath);
  }, 10);
  writeFileSync(alivePath, String(Date.now()));
  return () => clearInterval(t);
}

test('parseBrowserRef aceita e12, @e12 e ref=e12', () => {
  assert.equal(parseBrowserRef('e12'), 'e12');
  assert.equal(parseBrowserRef('@e3'), 'e3');
  assert.equal(parseBrowserRef('ref=e1'), 'e1');
  assert.equal(parseBrowserRef('E9'), 'e9');
  assert.equal(parseBrowserRef('Entrar'), null);
  assert.equal(parseBrowserRef('e'), null);
});

test('matchAccessibleTarget: ref estável e texto só quando único', () => {
  const nodes = [
    { ref: 'e1', role: 'button', name: 'Login' },
    { ref: 'e2', role: 'button', name: 'Logout' },
    { ref: 'e3', role: 'textbox', name: 'E-mail' }
  ];
  assert.equal(matchAccessibleTarget('e2', nodes).name, 'Logout');
  assert.equal(matchAccessibleTarget('@e3', nodes).role, 'textbox');
  assert.equal(matchAccessibleTarget('ref=e1', nodes).ref, 'e1');
  assert.equal(matchAccessibleTarget('Login', nodes).ref, 'e1');
  assert.equal(matchAccessibleTarget('Log', nodes), null);
  assert.equal(matchAccessibleTarget('E-mail', nodes).ref, 'e3');
  assert.equal(matchAccessibleTarget('xyz', nodes), null);
});

test('renderA11ySnapshot lista role, nome e ref', () => {
  const snap = renderA11ySnapshot([
    { ref: 'e1', role: 'heading', name: 'Exemplo' },
    { ref: 'e2', role: 'textbox', name: 'Busca', value: 'gato' },
    { ref: 'e3', role: 'button', name: 'Enviar', disabled: true }
  ]);
  assert.match(snap, /heading "Exemplo" \[ref=e1\]/);
  assert.match(snap, /textbox "Busca" = "gato" \[ref=e2\]/);
  assert.match(snap, /button "Enviar" disabled \[ref=e3\]/);
});

test('formatBrowserReply usa snapshot e ignora innerText longo', () => {
  const s = formatBrowserReply({
    ok: true,
    title: 'Home',
    url: 'https://h.test/',
    nodes: [{ ref: 'e1', role: 'link', name: 'Docs' }],
    text: 'xxxx'.repeat(400),
    controls: ['velho']
  });
  assert.match(s, /Página: Home/);
  assert.match(s, /URL: https:\/\/h\.test\//);
  assert.match(s, /\[ref=e1\]/);
  assert.doesNotMatch(s, /xxxx/);
  assert.doesNotMatch(s, /velho/);
});

test('formatBrowserReply reporta erro e fallback legado', () => {
  assert.match(formatBrowserReply({ ok: false, error: 'Não achei: e9', title: 'X', url: 'u' }), /Erro: Não achei: e9/);
  const legacy = formatBrowserReply({ ok: true, title: 'L', url: 'u', text: 'olá', controls: ['A', 'B'] });
  assert.match(legacy, /Controles visíveis: A \| B/);
  assert.match(legacy, /Texto:\nolá/);
});

test('wantsScreenshot só sob demanda', () => {
  assert.equal(wantsScreenshot({ action: 'go' }), false);
  assert.equal(wantsScreenshot({ action: 'click' }), false);
  assert.equal(wantsScreenshot({ action: 'read' }), false);
  assert.equal(wantsScreenshot({ action: 'screenshot' }), true);
  assert.equal(wantsScreenshot({ action: 'click', screenshot: true }), true);
});

test('actionDelayMs é zero por padrão', () => {
  assert.equal(actionDelayMs({}), 0);
  assert.equal(actionDelayMs({ action: 'click' }, {}), 0);
  assert.equal(actionDelayMs({}, { RIPPER_BROWSER_PACE: '' }), 0);
  assert.equal(actionDelayMs({ pace: 'human' }), 700);
  assert.equal(actionDelayMs({}, { RIPPER_BROWSER_PACE: 'human' }), 700);
});

test('accessibleName junta label, aria e placeholder', () => {
  assert.equal(accessibleName({ ariaLabel: 'Fechar' }), 'Fechar');
  assert.equal(accessibleName({ placeholder: 'Buscar', innerText: '  ' }), 'Buscar');
  assert.equal(accessibleName({ labelText: 'Senha', name: 'pw' }), 'Senha');
});

test('daemonSource: sem pausa/print automáticos; com refs e screenshot sob demanda', () => {
  const src = daemonSource();
  assert.doesNotMatch(src, /\bthink\b/);
  assert.doesNotMatch(src, /delay:\s*45\s*\+/);
  assert.match(src, /data-ripper-ref/);
  assert.match(src, /wantsScreenshot/);
  assert.match(src, /cmd\.json/);
  assert.doesNotMatch(src, /bctl\.mjs/);
});

test('writeJsonAtomic / readJsonIf / heartbeat', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const url = pathToFileURL(dir + '/');
  const file = new URL('x.json', url);
  writeJsonAtomic(file, { a: 1 });
  assert.deepEqual(readJsonIf(file), { a: 1 });
  assert.equal(readJsonIf(new URL('missing.json', url)), null);
  writeFileSync(join(dir, 'alive'), '1');
  assert.equal(daemonHeartbeatFresh(url, Date.now(), 4000), true);
  assert.equal(daemonHeartbeatFresh(url, Date.now() + 10_000, 4000), false);
});

test('API pública de browserFor: open/click/type/scroll/back/read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const b = browserFor({ exec: async () => '' }, pathToFileURL(dir + '/'));
  for (const k of ['open', 'click', 'type', 'scroll', 'back', 'read']) assert.equal(typeof b[k], 'function', k);
});

test('browserFor: uma preparação via exec; ações falam com o daemon por arquivo', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  const cmds = [];
  let execs = 0;
  const stop = fakeDaemon(scripts, cmd => {
    cmds.push(cmd);
    if (cmd.action === 'go') return { title: 'Exemplo', url: 'https://ex.test/', nodes: [{ ref: 'e1', role: 'button', name: 'Entrar' }] };
    if (cmd.action === 'click') return { title: 'Exemplo', url: 'https://ex.test/in', nodes: [{ ref: 'e1', role: 'button', name: 'Entrar' }, { ref: 'e2', role: 'textbox', name: 'E-mail' }] };
    if (cmd.action === 'type') return { title: 'Exemplo', url: 'https://ex.test/in', nodes: [{ ref: 'e2', role: 'textbox', name: 'E-mail', value: cmd.text }] };
    return { title: 'Exemplo', url: 'https://ex.test/', nodes: [{ ref: 'e1', role: 'button', name: 'Entrar' }] };
  });
  const raw = {
    async exec() {
      execs += 1;
      writeFileSync(join(scripts, 'alive'), String(Date.now()));
      return 'RIPPER_BROWSER_READY\nRIPPER_BROWSER_DAEMON';
    }
  };
  try {
    const b = browserFor(raw, pathToFileURL(dir + '/'), { timeoutMs: 3000, pollMs: 10 });
    const opened = await b.open('https://ex.test/');
    const clicked = await b.click('e1');
    const typed = await b.type('e2', 'ana@ex.test', false);
    const read = await b.read();
    assert.equal(execs, 1);
    assert.equal(cmds.map(c => c.action).join(','), 'go,click,type,read');
    assert.equal(cmds[0].url, 'https://ex.test/');
    assert.equal(cmds[1].target, 'e1');
    assert.equal(cmds[2].text, 'ana@ex.test');
    assert.match(opened, /\[ref=e1\]/);
    assert.match(clicked, /textbox "E-mail"/);
    assert.match(typed, /ana@ex\.test/);
    assert.match(read, /Página: Exemplo/);
    assert.ok(existsSync(join(scripts, 'browserd.mjs')));
    assert.ok(existsSync(join(scripts, 'bstart.mjs')));
    assert.ok(!existsSync(join(scripts, 'bctl.mjs')));
  } finally { stop(); }
});

test('browserFor: screenshot só quando pedido', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  const cmds = [];
  const stop = fakeDaemon(scripts, cmd => {
    cmds.push(cmd);
    return { title: 'T', url: 'https://t.test/', nodes: [] };
  });
  const raw = {
    async exec() {
      writeFileSync(join(scripts, 'alive'), String(Date.now()));
      return 'RIPPER_BROWSER_READY';
    }
  };
  try {
    const b = browserFor(raw, pathToFileURL(dir + '/'), { timeoutMs: 3000, pollMs: 10 });
    await b.open('https://t.test/');
    await b.read();
    await b.click('e1', { screenshot: true });
    await b.screenshot();
    assert.equal(cmds[0].action, 'go');
    assert.ok(!cmds[0].screenshot);
    assert.equal(cmds[1].action, 'read');
    assert.ok(!cmds[1].screenshot);
    assert.equal(cmds[2].screenshot, true);
    assert.equal(cmds[3].action, 'screenshot');
  } finally { stop(); }
});

test('browserFor: type(target, text, submit) continua o contrato de 3 args', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  let seen;
  const stop = fakeDaemon(scripts, cmd => { seen = cmd; return { title: 'F', url: 'u', nodes: [] }; });
  const raw = {
    async exec() {
      writeFileSync(join(scripts, 'alive'), String(Date.now()));
      return 'RIPPER_BROWSER_READY';
    }
  };
  try {
    const b = browserFor(raw, pathToFileURL(dir + '/'), { timeoutMs: 3000, pollMs: 10 });
    await b.type('Buscar', 'gato', true);
    assert.equal(seen.action, 'type');
    assert.equal(seen.target, 'Buscar');
    assert.equal(seen.text, 'gato');
    assert.equal(seen.submit, true);
  } finally { stop(); }
});

test('browserRisk permanece o mesmo', () => {
  assert.ok(browserRisk('click', { target: 'Finalizar compra' }));
  assert.equal(browserRisk('click', { target: 'Próxima página' }), null);
  assert.equal(browserRisk('type', { target: 'Buscar' }), null);
  assert.ok(browserRisk('type', { target: 'Buscar', submit: true }));
});
