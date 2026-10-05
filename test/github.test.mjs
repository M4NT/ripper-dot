import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

test('repositório em qualquer formato', async () => {
  const { normalizeRepo } = await import('../lib/github.mjs');
  assert.equal(normalizeRepo('https://github.com/yan/ripper'), 'yan/ripper');
  assert.equal(normalizeRepo('git@github.com:yan/ripper.git'), 'yan/ripper');
  assert.equal(normalizeRepo('yan/ripper'), 'yan/ripper');
  assert.equal(normalizeRepo('ripper'), null);
});

test('mudanças: PR novo, issue atualizada e CI quebrado; ignora o que é seu e o que é velho', async () => {
  const since = Date.parse('2026-10-05T10:00:00Z');
  const t = h => `2026-10-05T${h}:00:00Z`;
  const routes = {
    '/repos/a/b/issues': [
      { number: 1, title: 'Novo PR', pull_request: {}, created_at: t(11), updated_at: t(11), user: { login: 'ana' }, html_url: 'u1' },
      { number: 2, title: 'Bug antigo', created_at: t('09'), updated_at: t(11), user: { login: 'bia' }, html_url: 'u2' },
      { number: 3, title: 'Meu PR', pull_request: {}, created_at: t(11), updated_at: t(11), user: { login: 'eu' }, html_url: 'u3' },
      { number: 4, title: 'Parado', created_at: t('08'), updated_at: t('09'), user: { login: 'bia' }, html_url: 'u4' }
    ],
    '/repos/a/b': { default_branch: 'main' },
    '/repos/a/b/actions/runs': { workflow_runs: [{ run_number: 9, name: 'CI', updated_at: t(11), actor: { login: 'ana' }, html_url: 'u9', head_commit: { message: 'quebra tudo' } }] }
  };
  const srv = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(routes[req.url.split('?')[0]] ?? {})); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  process.env.GITHUB_API_URL = `http://127.0.0.1:${srv.address().port}`;
  try {
    const { repoChanges, describeChange } = await import('../lib/github.mjs?mock');
    const out = await repoChanges({ token: 'x' }, 'a/b', since, 'eu');
    assert.deepEqual(out.map(c => `${c.kind}#${c.number}`), ['pr.opened#1', 'issue.updated#2', 'ci.failed#9']);
    assert.match(describeChange(out[2]), /CI falhou em a\/b #9: CI falhou em main/);
  } finally { srv.close(); }
});

test('criar o Guardião: confere token e acesso, cria agente + rotina uma vez só; token mascarado e cifrado', async () => {
  const { spawn } = await import('node:child_process');
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const api = http.createServer((req, res) => {
    const ok = req.headers.authorization === 'Bearer bom';
    res.statusCode = ok ? (req.url.startsWith('/repos/a/proibido') ? 404 : 200) : 401;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(ok ? (req.url === '/user' ? { login: 'yan' } : { default_branch: 'main' }) : { message: 'Bad credentials' }));
  });
  await new Promise(r => api.listen(0, '127.0.0.1', r));
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-gh-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TEST_PROVIDER: 'stream', HOME: dataDir, USERPROFILE: dataDir, RIPPER_SECRET_KEY_FILE: join(dataDir, 'k'), JULIA_AUTOSTART: '0', GITHUB_API_URL: `http://127.0.0.1:${api.address().port}` },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  const send = (path, b, method = 'POST') => fetch(base + path, { method, headers: { 'content-type': 'application/json', origin: base }, body: b ? JSON.stringify(b) : undefined });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
    await send('/api/settings', { github: { token: 'ruim', repos: ['https://github.com/a/b'] } }, 'PUT');
    const bad = await send('/api/github/guardian');
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /token não funcionou/);
    await send('/api/settings', { github: { token: 'bom', repos: ['a/b', 'a/proibido'] } }, 'PUT');
    assert.match((await (await send('/api/github/guardian')).json()).error, /Sem acesso a a\/proibido/);
    await send('/api/settings', { github: { token: 'bom', repos: ['a/b'] } }, 'PUT');
    const ok = await (await send('/api/github/guardian')).json();
    assert.equal(ok.login, 'yan');
    await send('/api/github/guardian'); // de novo: não duplica
    const st = await (await fetch(base + '/api/state')).json();
    assert.equal(st.agents.filter(a => a.name === 'Guardião').length, 1);
    assert.equal(st.routines.filter(r => r.trigger === 'github').length, 1);
    assert.equal(st.settings.github.token, '••••');
    assert.deepEqual(st.settings.github.repos, ['a/b']);
    await new Promise(r => setTimeout(r, 400));
    assert.ok(!readFileSync(join(dataDir, 'db.json'), 'utf8').includes('"token":"bom"'), 'token cifrado no disco');
  } finally { child.kill(); api.close(); }
});

test('PR: branch sempre ripper/…, token só no comando e nunca na saída', async () => {
  const { prBranch, gitAuthArg, hideToken } = await import('../lib/github.mjs');
  assert.equal(prBranch('main'), 'ripper/main');
  assert.equal(prBranch('ripper/corrige teste!'), 'ripper/corrige-teste');
  assert.equal(prBranch('../../etc'), 'ripper/etc');
  assert.equal(prBranch(''), 'ripper/correcao');
  const arg = gitAuthArg('ghp_segredo123');
  assert.ok(!arg.includes('ghp_segredo123'), 'token vai em base64 no cabeçalho');
  const leaked = `fatal: x ghp_segredo123 y ${arg}`;
  const shown = hideToken(leaked, 'ghp_segredo123');
  assert.ok(!shown.includes('ghp_segredo123') && !shown.includes(arg.split('basic ')[1].slice(0, 20)));
});
