import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, renameSync, existsSync, symlinkSync, unlinkSync } from 'node:fs';
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
  actionTimeoutMs,
  accessibleName,
  daemonSource,
  daemonHeartbeatFresh,
  writeJsonAtomic,
  writeFileNoFollow,
  ensureDirNoFollow,
  readJsonIf,
  readFileNoFollow,
  browserFor,
  browserRisk,
  resolveRiskTarget,
  sanitizeBrowserCommand,
  sanitizeBrowserUrl,
  shouldAcceptCommand,
  signBrowserCommand,
  verifyBrowserCommand,
  assignSnapshotRefs,
  redactResult,
  isSensitiveField,
  expectedFromTarget,
  sanitizeExpect,
  elementFingerprint,
  fingerprintsMatch,
  bindMismatchError,
  unknownRefError,
  unknownRefRisk,
  pickFingerprintHit,
  isMacReject,
  MAC_REJECT,
  runBrowserGate
} from '../lib/browser.mjs';

function fakeDaemon(scriptsDir, handle, { bootAt = Date.now() } = {}) {
  mkdirSync(scriptsDir, { recursive: true });
  const cmdPath = join(scriptsDir, 'cmd.json');
  const resPath = join(scriptsDir, 'res.json');
  const alivePath = join(scriptsDir, 'alive');
  const lastIds = new Set();
  const beat = () => writeFileSync(alivePath, JSON.stringify({ t: Date.now(), chromium: true }));
  const tick = () => {
    beat();
    let raw;
    try { raw = readFileSync(cmdPath, 'utf8'); } catch { return; }
    let cmd;
    try { cmd = JSON.parse(raw); } catch { return; }
    if (!shouldAcceptCommand(cmd, { bootAt, lastIds })) return;
    lastIds.add(cmd.id);
    try { unlinkSync(cmdPath); } catch {}
    const out = handle(cmd) || {};
    const tmp = resPath + '.' + Date.now() + '.tmp';
    writeFileSync(tmp, JSON.stringify({ id: cmd.id, ok: true, ...out }));
    renameSync(tmp, resPath);
  };
  const t = setInterval(tick, 10);
  beat();
  tick();
  return () => clearInterval(t);
}

function rawReady(scripts) {
  return {
    async exec(cmd) {
      writeFileSync(join(scripts, 'alive'), JSON.stringify({ t: Date.now(), chromium: true }));
      return 'RIPPER_BROWSER_READY\nRIPPER_BROWSER_DAEMON\n' + String(cmd || '').slice(0, 80);
    }
  };
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

test('formatBrowserReply usa snapshot; read inclui texto da página', () => {
  const s = formatBrowserReply({
    ok: true,
    title: 'Home',
    url: 'https://h.test/',
    nodes: [{ ref: 'e1', role: 'link', name: 'Docs' }]
  });
  assert.match(s, /Página: Home/);
  assert.match(s, /URL: https:\/\/h\.test\//);
  assert.match(s, /\[ref=e1\]/);
  const read = formatBrowserReply({
    ok: true, title: 'Artigo', url: 'https://a.test/',
    nodes: [{ ref: 'e1', role: 'heading', name: 'Olá' }],
    text: 'Corpo do artigo aqui'
  });
  assert.match(read, /Snapshot:/);
  assert.match(read, /Texto:\nCorpo do artigo aqui/);
});

test('formatBrowserReply reporta erro e fallback legado', () => {
  assert.match(formatBrowserReply({ ok: false, error: 'Não achei: e9', title: 'X', url: 'u' }), /Erro: Não achei: e9/);
  const legacy = formatBrowserReply({ ok: true, title: 'L', url: 'u', text: 'olá', controls: ['A', 'B'] });
  assert.match(legacy, /Controles visíveis: A \| B/);
  assert.match(legacy, /Texto:\nolá/);
});

test('wantsScreenshot marca pedido explícito; print leve é do daemon', () => {
  assert.equal(wantsScreenshot({ action: 'go' }), false);
  assert.equal(wantsScreenshot({ action: 'click' }), false);
  assert.equal(wantsScreenshot({ action: 'read' }), false);
  assert.equal(wantsScreenshot({ action: 'screenshot' }), true);
  assert.equal(wantsScreenshot({ action: 'click', screenshot: true }), true);
});

test('actionDelayMs é zero por padrão; timeout por ação existe', () => {
  assert.equal(actionDelayMs({}), 0);
  assert.equal(actionDelayMs({ action: 'click' }, {}), 0);
  assert.equal(actionDelayMs({ pace: 'human' }), 700);
  assert.ok(actionTimeoutMs('go') > actionTimeoutMs('click'));
  assert.ok(actionTimeoutMs('type') > 0);
});

test('accessibleName junta label, aria e placeholder', () => {
  assert.equal(accessibleName({ ariaLabel: 'Fechar' }), 'Fechar');
  assert.equal(accessibleName({ placeholder: 'Buscar', innerText: '  ' }), 'Buscar');
  assert.equal(accessibleName({ labelText: 'Senha', name: 'pw' }), 'Senha');
});

test('daemonSource: sem think, sem data-ripper-ref plantável, com fila e shred', () => {
  const src = daemonSource();
  assert.doesNotMatch(src, /\bthink\b/);
  assert.doesNotMatch(src, /delay:\s*45\s*\+/);
  assert.doesNotMatch(src, /data-ripper-ref/);
  assert.match(src, /pageFindByFingerprint/);
  assert.match(src, /shouldAcceptCommand/);
  assert.match(src, /mouse\.wheel/);
  assert.match(src, /includeText/);
  assert.match(src, /process\.stdin/);
  assert.match(src, /Ref sem elemento aprovado/);
  assert.match(src, /if \(!TOKEN\)/);
  assert.match(src, /process\.exit\(1\)/);
  assert.match(src, /assinatura HMAC recusada/);
  assert.doesNotMatch(src, /RIPPER_BROWSER_TOKEN/);
  assert.doesNotMatch(src, /process\.env\.\w*TOKEN/);
  assert.doesNotMatch(src, /if \(hits\.length === 1\)/);
  assert.doesNotMatch(src, /toLowerCase\(\)\.startsWith/);
  assert.doesNotMatch(src, /toLowerCase\(\)\.includes/);
  assert.doesNotMatch(src, /bctl\.mjs/);
});

test('writeJsonAtomic / readJsonIf / heartbeat com liveness do Chromium', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const url = pathToFileURL(dir + '/');
  const file = new URL('x.json', url);
  writeJsonAtomic(file, { a: 1 });
  assert.deepEqual(readJsonIf(file), { a: 1 });
  assert.equal(readJsonIf(new URL('missing.json', url)), null);
  writeJsonAtomic(new URL('alive', url), { t: Date.now(), chromium: true });
  assert.equal(daemonHeartbeatFresh(url, Date.now(), 4000), true);
  writeJsonAtomic(new URL('alive', url), { t: Date.now(), chromium: false });
  assert.equal(daemonHeartbeatFresh(url, Date.now(), 4000), false);
});

test('writeFileNoFollow não segue symlink para arquivo do host', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  mkdirSync(join(dir, '.ripper'), { recursive: true });
  const victim = join(dir, 'segredo-host.txt');
  writeFileSync(victim, 'NAO-MEXER');
  const dest = join(dir, '.ripper', 'cmd.json');
  symlinkSync(victim, dest);
  writeFileNoFollow(pathToFileURL(dest), '{"ok":1}');
  assert.equal(readFileSync(victim, 'utf8'), 'NAO-MEXER');
  assert.equal(readFileSync(dest, 'utf8'), '{"ok":1}');
  const other = join(dir, '.ripper', 'res.json');
  symlinkSync(victim, other);
  assert.throws(() => readFileNoFollow(pathToFileURL(other)), /symlink/i);
});

test('ensureDirNoFollow recusa .ripper symlink mesmo com barra no URL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const real = join(dir, 'real');
  mkdirSync(real, { recursive: true });
  const link = join(dir, '.ripper');
  symlinkSync(real, link);
  assert.throws(() => ensureDirNoFollow(pathToFileURL(link + '/')), /symlink/i);
  assert.throws(() => ensureDirNoFollow(pathToFileURL(link)), /symlink/i);
});

test('sanitizeBrowserCommand: allowlist, url e dy', () => {
  const ts = Date.now();
  assert.equal(sanitizeBrowserCommand({ id: '1', ts, action: 'rm' }), null);
  assert.equal(sanitizeBrowserCommand({ id: '1', ts, action: 'go', url: 'javascript:alert(1)' }), null);
  assert.equal(sanitizeBrowserUrl('javascript:alert(1)'), null);
  const go = sanitizeBrowserCommand({ id: '1', ts, action: 'go', url: 'ex.test/a' });
  assert.equal(go.url, 'https://ex.test/a');
  const sc = sanitizeBrowserCommand({ id: '1', ts, action: 'scroll', dy: 99999 });
  assert.equal(sc.dy, 4000);
  assert.ok(sanitizeBrowserCommand({ id: '1', ts, action: 'read' }));
  const clk = sanitizeBrowserCommand({
    id: '1', ts, action: 'click', target: 'e7',
    expect: { role: 'button', name: 'Próxima página', tag: 'button', nth: 0, extra: 'x' }
  });
  assert.deepEqual(clk.expect, { role: 'button', name: 'Próxima página', nth: 0, tag: 'button' });
  assert.equal(clk.expect.extra, undefined);
});

test('shouldAcceptCommand recusa id repetido e cmd anterior ao boot', () => {
  const lastIds = new Set(['abc']);
  assert.equal(shouldAcceptCommand({ id: 'abc', ts: 10 }, { lastIds, bootAt: 5 }), false);
  assert.equal(shouldAcceptCommand({ id: 'novo', ts: 3 }, { lastIds, bootAt: 5 }), false);
  assert.equal(shouldAcceptCommand({ id: 'novo', ts: 5 }, { lastIds, bootAt: 5 }), true);
  assert.equal(shouldAcceptCommand({ id: 'novo', ts: 9 }, { lastIds, bootAt: 5 }), true);
});

test('HMAC do comando', () => {
  const c = { id: '1', ts: 1, action: 'read' };
  const mac = signBrowserCommand(c, 'tok');
  assert.ok(verifyBrowserCommand({ ...c, mac }, 'tok'));
  assert.equal(verifyBrowserCommand({ ...c, mac }, 'outro'), false);
  assert.equal(verifyBrowserCommand({ ...c, mac: '0'.repeat(32) }, 'tok'), false);
});

test('assignSnapshotRefs e redactResult escondem valor sensível', () => {
  const nodes = assignSnapshotRefs([
    { role: 'textbox', name: 'Senha', type: 'password', value: 'abc' },
    { role: 'button', name: 'Entrar' }
  ]);
  assert.equal(nodes[0].ref, 'e1');
  assert.equal(nodes[0].value, undefined);
  assert.equal(nodes[1].ref, 'e2');
  const red = redactResult({ nodes: [{ ref: 'e1', name: 'Token', value: 'xyz' }] }, { secret: true, target: 'Token' });
  assert.equal(red.nodes[0].value, undefined);
  assert.ok(isSensitiveField('Senha'));
  for (const t of ['OTP', 'PIN', 'código', 'codigo', 'chave', 'Código de verificação']) {
    assert.ok(isSensitiveField(t), t);
    assert.ok(browserRisk('type', { target: t }), t);
  }
  assert.equal(isSensitiveField('tokens'), false);
  assert.equal(isSensitiveField('descartar'), false);
  const otp = assignSnapshotRefs([{ role: 'textbox', name: 'OTP', value: '847291' }]);
  assert.equal(otp[0].value, undefined);
});

test('fingerprint do elemento aprovado: papel, nome e nth', () => {
  const nodes = [
    { ref: 'e7', role: 'button', name: 'Próxima página', tag: 'button', nth: 0 },
    { ref: 'e8', role: 'button', name: 'Finalizar compra', tag: 'button', nth: 0 }
  ];
  assert.deepEqual(expectedFromTarget('e7', nodes), {
    role: 'button', name: 'Próxima página', tag: 'button', nth: 0
  });
  assert.ok(fingerprintsMatch(expectedFromTarget('e7', nodes), { role: 'button', name: 'Próxima página', nth: 0 }));
  assert.equal(fingerprintsMatch(expectedFromTarget('e7', nodes), { role: 'button', name: 'Finalizar compra', nth: 0 }), false);
  assert.equal(sanitizeExpect({ role: '', name: '' }), null);
  assert.match(bindMismatchError({ role: 'button', name: 'Próxima página' }), /Próxima página/);
  assert.match(unknownRefError('e7'), /e7/);
  assert.match(unknownRefRisk('e7'), /ref desconhecida/);
  assert.ok(elementFingerprint(nodes[0]));
  const withHref = elementFingerprint({
    role: 'link', name: 'Docs', tag: 'a', nth: 0, href: '/docs', line: 'Leia Docs aqui'
  });
  assert.equal(withHref.href, '/docs');
  assert.equal(withHref.line, 'Leia Docs aqui');
  assert.equal(pickFingerprintHit(['a'], { nth: 0 }), 'a');
  assert.equal(pickFingerprintHit(['a'], { nth: 1 }), null);
  assert.equal(pickFingerprintHit(['a', 'b'], { nth: 1 }), 'b');
  assert.ok(isMacReject({ ok: false, error: MAC_REJECT }));
  assert.equal(isMacReject({ ok: true }), false);
});

test('browserRisk resolve ref pelo snapshot (não pelo texto e7)', () => {
  const nodes = [{ ref: 'e7', role: 'button', name: 'Finalizar compra' }, { ref: 'e3', role: 'textbox', name: 'Senha' }];
  assert.equal(resolveRiskTarget('e7', nodes), 'Finalizar compra');
  assert.ok(browserRisk('click', { target: 'e7', nodes }));
  assert.match(browserRisk('click', { target: 'e7' }), /ref desconhecida/);
  assert.ok(browserRisk('type', { target: 'e3', nodes }));
  assert.ok(browserRisk('click', { target: 'Excluir conta' }));
});

test('API pública de browserFor: open/click/type/scroll/back/read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const b = browserFor({ exec: async () => '' }, pathToFileURL(dir + '/'));
  for (const k of ['open', 'click', 'type', 'scroll', 'back', 'read']) assert.equal(typeof b[k], 'function', k);
  assert.equal(typeof b.risk, 'function');
  assert.equal(typeof b.labelOf, 'function');
});

test('browserFor: uma preparação via exec; ações falam com o daemon por arquivo', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  const cmds = [];
  let execs = 0;
  let lastExec = '';
  const stop = fakeDaemon(scripts, cmd => {
    cmds.push(cmd);
    if (cmd.action === 'go') return { title: 'Exemplo', url: 'https://ex.test/', nodes: [{ ref: 'e1', role: 'button', name: 'Entrar' }] };
    if (cmd.action === 'click') return { title: 'Exemplo', url: 'https://ex.test/in', nodes: [{ ref: 'e1', role: 'button', name: 'Entrar' }, { ref: 'e2', role: 'textbox', name: 'E-mail' }] };
    if (cmd.action === 'type') return { title: 'Exemplo', url: 'https://ex.test/in', nodes: [{ ref: 'e2', role: 'textbox', name: 'E-mail', value: cmd.text }] };
    if (cmd.action === 'read') return { title: 'Exemplo', url: 'https://ex.test/', nodes: [{ ref: 'e1', role: 'button', name: 'Entrar' }], text: 'Bem-vindo ao exemplo' };
    return { title: 'Exemplo', url: 'https://ex.test/', nodes: [{ ref: 'e1', role: 'button', name: 'Entrar' }] };
  });
  let lastOpts;
  const raw = {
    async exec(cmd, opts) {
      execs += 1;
      lastExec = cmd;
      lastOpts = opts;
      writeFileSync(join(scripts, 'alive'), JSON.stringify({ t: Date.now(), chromium: true }));
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
    assert.match(lastExec, /\/opt\/ripper-browser\/browserd\.mjs/);
    assert.equal(cmds.map(c => c.action).join(','), 'go,click,type,read');
    assert.equal(cmds[0].url, 'https://ex.test/');
    assert.equal(cmds[1].target, 'e1');
    assert.deepEqual(cmds[1].expect, { role: 'button', name: 'Entrar', nth: 0 });
    assert.equal(cmds[2].text, 'ana@ex.test');
    assert.deepEqual(cmds[2].expect, { role: 'textbox', name: 'E-mail', nth: 0 });
    assert.doesNotMatch(lastExec, /RIPPER_BROWSER_TOKEN=/);
    assert.match(lastExec, /cat \| nohup node \/opt\/ripper-browser\/browserd\.mjs/);
    assert.ok(lastOpts && lastOpts.input);
    assert.equal(lastExec.includes(lastOpts.input), false);
    assert.match(opened, /\[ref=e1\]/);
    assert.match(clicked, /textbox "E-mail"/);
    assert.match(typed, /ana@ex\.test/);
    assert.match(read, /Texto:\nBem-vindo ao exemplo/);
    assert.ok(!existsSync(join(scripts, 'cmd.json')));
    assert.ok(!existsSync(join(scripts, 'res.json')));
    assert.ok(!existsSync(join(scripts, 'browserd.mjs')));
    assert.equal(b.labelOf('e1'), 'Entrar');
    assert.ok(!b.risk('click', { target: 'e1' }));
  } finally { stop(); }
});

test('browserFor: screenshot explícito continua opt-in no comando', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  const cmds = [];
  const stop = fakeDaemon(scripts, cmd => {
    cmds.push(cmd);
    return { title: 'T', url: 'https://t.test/', nodes: [{ ref: 'e1', role: 'button', name: 'Ok' }] };
  });
  try {
    const b = browserFor(rawReady(scripts), pathToFileURL(dir + '/'), { timeoutMs: 3000, pollMs: 10 });
    await b.open('https://t.test/');
    await b.read();
    await b.click('e1', { screenshot: true });
    await b.screenshot();
    assert.equal(cmds[0].action, 'go');
    assert.ok(!cmds[0].screenshot);
    assert.equal(cmds[1].action, 'read');
    assert.ok(cmds[1].includeText);
    assert.equal(cmds[2].screenshot, true);
    assert.equal(cmds[3].action, 'screenshot');
  } finally { stop(); }
});

test('browserFor: type(target, text, submit) continua o contrato de 3 args', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  let seen;
  const stop = fakeDaemon(scripts, cmd => { seen = cmd; return { title: 'F', url: 'u', nodes: [] }; });
  try {
    const b = browserFor(rawReady(scripts), pathToFileURL(dir + '/'), { timeoutMs: 3000, pollMs: 10 });
    await b.type('Buscar', 'gato', true);
    assert.equal(seen.action, 'type');
    assert.equal(seen.target, 'Buscar');
    assert.equal(seen.text, 'gato');
    assert.equal(seen.submit, true);
  } finally { stop(); }
});

test('browserFor: comando antigo não reexecuta após “restart” do daemon', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  mkdirSync(scripts, { recursive: true });
  const leftover = { id: 'old-buy', ts: Date.now() - 8000, action: 'click', target: 'Finalizar compra' };
  leftover.mac = signBrowserCommand(leftover, 'ignored');
  writeFileSync(join(scripts, 'cmd.json'), JSON.stringify(leftover));
  const seen = [];
  const stop = fakeDaemon(scripts, cmd => {
    seen.push(cmd.action + ':' + (cmd.target || cmd.url || ''));
    return { title: 'Loja', url: 'https://loja.test/', nodes: [{ ref: 'e1', role: 'button', name: 'Finalizar compra' }] };
  }, { bootAt: Date.now() });
  try {
    const b = browserFor(rawReady(scripts), pathToFileURL(dir + '/'), { timeoutMs: 3000, pollMs: 10 });
    await b.open('https://loja.test/');
    assert.ok(!seen.some(s => s.startsWith('click:Finalizar')));
    assert.ok(seen.some(s => s.startsWith('go:')));
    assert.ok(!existsSync(join(scripts, 'cmd.json')));
  } finally { stop(); }
});

test('browserFor.risk usa o snapshot: e7 perigoso pede aprovação', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  const stop = fakeDaemon(scripts, cmd => {
    if (cmd.action === 'go') return { title: 'Loja', url: 'https://loja.test/', nodes: [{ ref: 'e7', role: 'button', name: 'Finalizar compra' }] };
    return { title: 'Loja', url: 'https://loja.test/', nodes: [{ ref: 'e7', role: 'button', name: 'Finalizar compra' }] };
  });
  try {
    const b = browserFor(rawReady(scripts), pathToFileURL(dir + '/'), { timeoutMs: 3000, pollMs: 10 });
    assert.match(b.risk('click', { target: 'e7' }), /ref desconhecida/);
    await b.open('https://loja.test/');
    assert.equal(b.labelOf('e7'), 'Finalizar compra');
    assert.ok(b.risk('click', { target: 'e7' }));
    assert.match(b.risk('click', { target: 'e7' }), /Finalizar compra/);
  } finally { stop(); }
});

test('browserFor: senha não permanece em cmd/res nem volta no texto', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  const stop = fakeDaemon(scripts, cmd => ({
    title: 'Login',
    url: 'https://l.test/',
    nodes: [{ ref: 'e1', role: 'textbox', name: 'Senha', type: 'password', value: cmd.text }]
  }));
  try {
    const b = browserFor(rawReady(scripts), pathToFileURL(dir + '/'), { timeoutMs: 3000, pollMs: 10 });
    const out = await b.type('Senha', 'segredo123', false);
    assert.match(out, /Página: Login/);
    assert.doesNotMatch(out, /segredo123/);
    assert.ok(!existsSync(join(scripts, 'cmd.json')));
    assert.ok(!existsSync(join(scripts, 'res.json')));
  } finally { stop(); }
});

test('browserFor serializa ações concorrentes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  const order = [];
  const stop = fakeDaemon(scripts, cmd => {
    order.push(cmd.target);
    return { title: 'T', url: 'u', nodes: [] };
  });
  try {
    const b = browserFor(rawReady(scripts), pathToFileURL(dir + '/'), { timeoutMs: 3000, pollMs: 10 });
    await Promise.all([b.click('um'), b.click('dois'), b.click('tres')]);
    assert.deepEqual(order, ['um', 'dois', 'tres']);
  } finally { stop(); }
});

test('browserRisk permanece o mesmo para texto puro', () => {
  assert.ok(browserRisk('click', { target: 'Finalizar compra' }));
  assert.equal(browserRisk('click', { target: 'Próxima página' }), null);
  assert.equal(browserRisk('type', { target: 'Buscar' }), null);
  assert.ok(browserRisk('type', { target: 'Buscar', submit: true }));
});

test('browserFor: clique leva fingerprint; página mudada entre aprovação e clique é recusada', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  const cmds = [];
  let live = [{ ref: 'e7', role: 'button', name: 'Próxima página', tag: 'button', nth: 0 }];
  const stop = fakeDaemon(scripts, cmd => {
    cmds.push(cmd);
    if (cmd.action === 'go') {
      live = [{ ref: 'e7', role: 'button', name: 'Próxima página', tag: 'button', nth: 0 }];
      return { title: 'Checkout', url: 'https://loja.test/passo', nodes: live };
    }
    if (cmd.action === 'click') {
      live = [{ ref: 'e7', role: 'button', name: 'Finalizar compra', tag: 'button', nth: 0 }];
      const exp = cmd.expect;
      const hits = live.filter(n => n.role === exp?.role && n.name === exp?.name);
      if (!hits.length) {
        return { ok: false, error: bindMismatchError(exp), title: 'Checkout', url: 'https://loja.test/fim', nodes: live };
      }
      return { title: 'Checkout', url: 'https://loja.test/fim', nodes: live };
    }
    return { title: 'Checkout', url: 'https://loja.test/', nodes: live };
  });
  try {
    const b = browserFor(rawReady(scripts), pathToFileURL(dir + '/'), { timeoutMs: 3000, pollMs: 10 });
    await b.open('https://loja.test/passo');
    assert.equal(b.labelOf('e7'), 'Próxima página');
    assert.equal(b.risk('click', { target: 'e7' }), null);
    const out = await b.click('e7');
    assert.equal(cmds[1].target, 'e7');
    assert.deepEqual(cmds[1].expect, { role: 'button', name: 'Próxima página', tag: 'button', nth: 0 });
    assert.match(out, /A página mudou/);
    assert.match(out, /Próxima página/);
    assert.doesNotMatch(out, /ok: true/);
  } finally { stop(); }
});

test('browserFor: ref desconhecida recusa o clique e pede aprovação', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  const cmds = [];
  const stop = fakeDaemon(scripts, cmd => {
    cmds.push(cmd);
    return { title: 'Home', url: 'https://h.test/', nodes: [{ ref: 'e1', role: 'button', name: 'Entrar' }] };
  });
  try {
    const b = browserFor(rawReady(scripts), pathToFileURL(dir + '/'), { timeoutMs: 3000, pollMs: 10 });
    const before = await b.click('e7');
    assert.match(before, /Não achei a ref e7/);
    assert.equal(cmds.length, 0);
    assert.match(b.risk('click', { target: 'e7' }), /ref desconhecida/);
    await b.open('https://h.test/');
    const after = await b.click('e9');
    assert.match(after, /Não achei a ref e9/);
    assert.equal(cmds.map(c => c.action).join(','), 'go');
    assert.match(b.risk('click', { target: 'e9' }), /ref desconhecida/);
    assert.equal(b.risk('click', { target: 'e1' }), null);
  } finally { stop(); }
});

test('browserFor: .ripper vira symlink entre operações e a próxima recusa', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  const stop = fakeDaemon(scripts, () => ({
    title: 'T', url: 'https://t.test/', nodes: [{ ref: 'e1', role: 'button', name: 'Entrar' }]
  }));
  try {
    const b = browserFor(rawReady(scripts), pathToFileURL(dir + '/'), { timeoutMs: 3000, pollMs: 10 });
    await b.open('https://t.test/');
    const moved = join(dir, 'ripper-real');
    renameSync(scripts, moved);
    symlinkSync(moved, scripts);
    await assert.rejects(() => b.click('e1'), /symlink/i);
  } finally { stop(); }
});

test('browserFor: primeira implantação da sessão reinicia daemon vivo; token só no stdin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(scripts, 'alive'), JSON.stringify({ t: Date.now(), chromium: true }));
  let execs = 0, lastExec = '', lastOpts;
  const stop = fakeDaemon(scripts, () => ({ title: 'T', url: 'https://t.test/', nodes: [] }));
  const raw = {
    async exec(cmd, opts) {
      execs += 1;
      lastExec = cmd;
      lastOpts = opts;
      writeFileSync(join(scripts, 'alive'), JSON.stringify({ t: Date.now(), chromium: true }));
      return 'RIPPER_BROWSER_READY\nRIPPER_BROWSER_DAEMON';
    }
  };
  try {
    const b = browserFor(raw, pathToFileURL(dir + '/'), { timeoutMs: 3000, pollMs: 10, token: 'tok-sessao-abc' });
    await b.open('https://t.test/');
    assert.equal(execs, 1);
    assert.match(lastExec, /pkill/);
    assert.equal(lastOpts.input, 'tok-sessao-abc');
    assert.doesNotMatch(lastExec, /tok-sessao-abc/);
    assert.match(lastExec, /cat \| nohup node/);
  } finally { stop(); }
});

test('browserFor: clique aprovado não reenvia após HMAC recusada', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  const clicks = [];
  let rejects = 1;
  const stop = fakeDaemon(scripts, cmd => {
    if (cmd.action === 'go') return { title: 'T', url: 'https://t.test/', nodes: [{ ref: 'e1', role: 'button', name: 'Ok' }] };
    if (cmd.action === 'click') {
      clicks.push(cmd.id);
      if (rejects > 0) {
        rejects -= 1;
        return { ok: false, error: MAC_REJECT };
      }
      return { title: 'T', url: 'https://t.test/', nodes: [] };
    }
    return { title: 'T', url: 'https://t.test/', nodes: [] };
  });
  try {
    const b = browserFor(rawReady(scripts), pathToFileURL(dir + '/'), { timeoutMs: 3000, pollMs: 10 });
    await b.open('https://t.test/');
    const out = await b.click('e1');
    assert.equal(clicks.length, 1);
    assert.match(out, /assinatura HMAC recusada/);
  } finally { stop(); }
});

test('browserFor: timeout reenvia com horário novo', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  mkdirSync(scripts, { recursive: true });
  const cmds = [];
  const alivePath = join(scripts, 'alive');
  const cmdPath = join(scripts, 'cmd.json');
  const resPath = join(scripts, 'res.json');
  let phase = 'drop';
  let deploys = 0;
  const beat = () => writeFileSync(alivePath, JSON.stringify({ t: Date.now(), chromium: true }));
  const tick = () => {
    let raw;
    try { raw = readFileSync(cmdPath, 'utf8'); } catch { return; }
    let cmd;
    try { cmd = JSON.parse(raw); } catch { return; }
    cmds.push({ id: cmd.id, ts: cmd.ts, action: cmd.action });
    try { unlinkSync(cmdPath); } catch {}
    if (phase === 'drop') {
      phase = 'dead';
      try { unlinkSync(alivePath); } catch {}
      return;
    }
    beat();
    const tmp = resPath + '.' + Date.now() + '.tmp';
    writeFileSync(tmp, JSON.stringify({ id: cmd.id, ok: true, title: 'T', url: 'https://t.test/', nodes: [] }));
    renameSync(tmp, resPath);
  };
  const iv = setInterval(() => { if (phase !== 'dead') tick(); }, 10);
  beat();
  const raw = {
    async exec() {
      deploys += 1;
      if (deploys > 1) phase = 'answer';
      beat();
      return 'RIPPER_BROWSER_READY\nRIPPER_BROWSER_DAEMON';
    }
  };
  try {
    const b = browserFor(raw, pathToFileURL(dir + '/'), { timeoutMs: 2800, pollMs: 10 });
    const out = await b.read();
    assert.match(out, /Página: T/);
    assert.ok(cmds.length >= 2);
    assert.notEqual(cmds[0].id, cmds[1].id);
    assert.ok(cmds[1].ts > cmds[0].ts);
  } finally { clearInterval(iv); }
});

test('browserFor: HMAC recusada reimplanta em vez de esperar', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  let execs = 0;
  let rejects = 1;
  const stop = fakeDaemon(scripts, () => {
    if (rejects > 0) {
      rejects -= 1;
      return { ok: false, error: MAC_REJECT };
    }
    return { title: 'T', url: 'https://t.test/', nodes: [{ ref: 'e1', role: 'button', name: 'Ok' }] };
  });
  const raw = {
    async exec() {
      execs += 1;
      writeFileSync(join(scripts, 'alive'), JSON.stringify({ t: Date.now(), chromium: true }));
      return 'RIPPER_BROWSER_READY\nRIPPER_BROWSER_DAEMON';
    }
  };
  try {
    const b = browserFor(raw, pathToFileURL(dir + '/'), { timeoutMs: 3000, pollMs: 10 });
    const out = await b.open('https://t.test/');
    assert.match(out, /Página: T/);
    assert.equal(execs, 2);
  } finally { stop(); }
});

test('browserFor: expect fica o da aprovação, não o do snapshot do clique', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  const cmds = [];
  const stop = fakeDaemon(scripts, cmd => {
    cmds.push(cmd);
    if (cmd.action === 'go') {
      return {
        title: 'A', url: 'https://loja.test/passo',
        nodes: [{ ref: 'e7', role: 'button', name: 'Próxima página', tag: 'button', nth: 0 }]
      };
    }
    if (cmd.action === 'read') {
      return {
        title: 'B', url: 'https://loja.test/fim',
        nodes: [{ ref: 'e7', role: 'button', name: 'Finalizar compra', tag: 'button', nth: 0 }]
      };
    }
    return { title: 'C', url: 'https://loja.test/fim', nodes: [] };
  });
  try {
    const b = browserFor(rawReady(scripts), pathToFileURL(dir + '/'), { timeoutMs: 3000, pollMs: 10 });
    await b.open('https://loja.test/passo');
    assert.equal(b.risk('click', { target: 'e7' }), null);
    await b.read();
    assert.equal(b.labelOf('e7'), 'Finalizar compra');
    await b.click('e7');
    const click = cmds.find(c => c.action === 'click');
    assert.deepEqual(click.expect, { role: 'button', name: 'Próxima página', tag: 'button', nth: 0 });
  } finally { stop(); }
});

test('browserFor: nth=1 recusa se só sobrou um elemento igual', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  const stop = fakeDaemon(scripts, cmd => {
    if (cmd.action === 'go') {
      return {
        title: 'Form', url: 'https://f.test/',
        nodes: [
          { ref: 'e1', role: 'button', name: 'Enviar', tag: 'button', nth: 0 },
          { ref: 'e2', role: 'button', name: 'Enviar', tag: 'button', nth: 1 }
        ]
      };
    }
    if (cmd.action === 'click') {
      const live = [{ ref: 'e1', role: 'button', name: 'Enviar', tag: 'button', nth: 0 }];
      const hits = live.filter(n => n.role === cmd.expect?.role && n.name === cmd.expect?.name);
      const hit = pickFingerprintHit(hits, cmd.expect);
      if (!hit) return { ok: false, error: bindMismatchError(cmd.expect), title: 'Form', url: 'https://f.test/', nodes: live };
      return { title: 'Form', url: 'https://f.test/', nodes: live };
    }
    return { title: 'Form', url: 'https://f.test/', nodes: [] };
  });
  try {
    const b = browserFor(rawReady(scripts), pathToFileURL(dir + '/'), { timeoutMs: 3000, pollMs: 10 });
    await b.open('https://f.test/');
    assert.ok(b.risk('click', { target: 'e2' }));
    const out = await b.click('e2');
    assert.match(out, /A página mudou/);
  } finally { stop(); }
});

test('browserFor: busca aproximada por texto leva o fingerprint do snapshot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  const cmds = [];
  const stop = fakeDaemon(scripts, cmd => {
    cmds.push(cmd);
    if (cmd.action === 'go') {
      return {
        title: 'L', url: 'https://l.test/',
        nodes: [{ ref: 'e1', role: 'button', name: 'Entrar agora', tag: 'button', nth: 0, href: '' }]
      };
    }
    return { title: 'L', url: 'https://l.test/', nodes: [] };
  });
  try {
    const b = browserFor(rawReady(scripts), pathToFileURL(dir + '/'), { timeoutMs: 3000, pollMs: 10 });
    await b.open('https://l.test/');
    b.risk('click', { target: 'Entrar' });
    await b.click('Entrar');
    assert.equal(cmds[1].action, 'click');
    assert.equal(cmds[1].expect.name, 'Entrar agora');
    assert.equal(cmds[1].expect.role, 'button');
  } finally { stop(); }
});

test('trava ativa bloqueia o clique sem consumir o alvo aprovado', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  const cmds = [];
  const stop = fakeDaemon(scripts, cmd => {
    cmds.push(cmd);
    return { title: 'T', url: 'https://t.test/', nodes: [{ ref: 'e1', role: 'button', name: 'Entrar' }] };
  });
  try {
    const b = browserFor(rawReady(scripts), pathToFileURL(dir + '/'), { timeoutMs: 3000, pollMs: 10 });
    await b.open('https://t.test/');
    assert.equal(b.risk('click', { target: 'e1' }), null);
    assert.equal(b.hasApprovedExpect('click', 'e1'), true);
    let locked = false;
    const afterAsk = await runBrowserGate({
      locked: () => locked,
      ask: async () => { locked = true; return true; },
      run: () => b.click('e1'),
      denied: 'negado'
    });
    assert.match(afterAsk, /assumiu o controle/);
    assert.equal(b.hasApprovedExpect('click', 'e1'), true);
    assert.equal(cmds.filter(c => c.action === 'click').length, 0);
    locked = false;
    const ok = await runBrowserGate({
      locked: () => locked,
      ask: async () => true,
      run: () => b.click('e1'),
      denied: 'negado'
    });
    assert.match(ok, /Página: T/);
    assert.equal(b.hasApprovedExpect('click', 'e1'), false);
    assert.equal(cmds.filter(c => c.action === 'click').length, 1);
  } finally { stop(); }
});

test('mudança de página após aprovação é recusada (gate)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-br-'));
  const scripts = join(dir, '.ripper');
  const stop = fakeDaemon(scripts, cmd => {
    if (cmd.action === 'go') {
      return {
        title: 'A', url: 'https://loja.test/passo',
        nodes: [{ ref: 'e7', role: 'button', name: 'Próxima página', tag: 'button', nth: 0 }]
      };
    }
    if (cmd.action === 'click') {
      const live = [{ ref: 'e7', role: 'button', name: 'Finalizar compra', tag: 'button', nth: 0 }];
      const hits = live.filter(n => n.role === cmd.expect?.role && n.name === cmd.expect?.name);
      if (!hits.length) return { ok: false, error: bindMismatchError(cmd.expect), title: 'B', url: 'https://loja.test/fim', nodes: live };
      return { title: 'B', url: 'https://loja.test/fim', nodes: live };
    }
    return { title: 'A', url: 'https://loja.test/passo', nodes: [] };
  });
  try {
    const b = browserFor(rawReady(scripts), pathToFileURL(dir + '/'), { timeoutMs: 3000, pollMs: 10 });
    await b.open('https://loja.test/passo');
    const out = await runBrowserGate({
      locked: () => false,
      ask: async () => {
        assert.equal(b.risk('click', { target: 'e7' }), null);
        return true;
      },
      run: () => b.click('e7'),
      denied: 'negado'
    });
    assert.match(out, /A página mudou/);
    assert.match(out, /Próxima página/);
  } finally { stop(); }
});
