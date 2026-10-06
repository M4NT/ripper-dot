import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { freePort } from './helpers/free-port.mjs';

const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));


async function withServer(envExtra, fn) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-http-'));
  const port = await freePort();
  const env = {
    ...process.env,
    RIPPER_DATA: dataDir,
    PORT: String(port),
    HOST: '127.0.0.1',
    RIPPER_TOKEN: 'test-http-token',
    // Isola do login real do Claude (~/.claude) da máquina de quem roda os testes.
    HOME: dataDir,
    USERPROFILE: dataDir,
    CLAUDE_CODE_OAUTH_TOKEN: '',
    ...envExtra
  };
  const child = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(base + '/api/health', env.RIPPER_TOKEN, 60_000);
    await fn(base, env.RIPPER_TOKEN, dataDir);
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('exit', r));
  }
}

async function waitFor(url, token, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('servidor não subiu a tempo');
}

/** Aguarda resposta HTTP mesmo se o servidor estiver sob flush concorrente (CI). */
async function fetchWithRetry(url, { attempts = 5, delayMs = 80 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url);
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

test('respostas da API incluem cabeçalhos de segurança', async () => {
  await withServer({}, async (base, token) => {
    const r = await fetch(base + '/api/health', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.ok(r.headers.get('content-security-policy'));
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  });
});

test('CORS: origem na allowlist recebe ACAO; desconhecida nega OPTIONS', async () => {
  const allowed = 'http://127.0.0.1:5173';
  await withServer({ RIPPER_CORS_ORIGIN: allowed }, async (base, token) => {
    const ok = await fetch(base + '/api/health', {
      headers: { authorization: `Bearer ${token}`, origin: allowed }
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('access-control-allow-origin'), allowed);

    const preflight = await fetch(base + '/api/health', {
      method: 'OPTIONS',
      headers: { origin: allowed, 'access-control-request-method': 'GET' }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), allowed);

    const denied = await fetch(base + '/api/health', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' }
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  });
});

test('CORS: POST com origem fora da allowlist retorna 403', async () => {
  await withServer({ RIPPER_CORS_ORIGIN: 'http://127.0.0.1:5173' }, async (base, token) => {
    const r = await fetch(base + '/api/settings', {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        origin: 'https://evil.example'
      },
      body: JSON.stringify({ name: 'x' })
    });
    assert.equal(r.status, 403);
    const body = await r.json();
    assert.match(body.error, /Origem não permitida/);
  });
});

test('GET /metrics exige token ou RIPPER_METRICS_PUBLIC', async () => {
  await withServer({}, async (base, token) => {
    const denied = await fetch(base + '/metrics');
    assert.equal(denied.status, 401);

    const r1 = await fetch(base + '/api/health', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r1.status, 200);

    const m = await fetch(base + '/metrics', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(m.status, 200);
    assert.match(m.headers.get('content-type') || '', /text\/plain; version=0\.0\.4/);
    const body = await m.text();
    assert.match(body, /ripper_http_requests_total/);
    assert.match(body, /ripper_process_uptime_seconds/);
    assert.match(body, /route="\/api\/health",status="200"/);
  });
});

test('GET /metrics com RIPPER_METRICS_PUBLIC=1 sem Bearer', async () => {
  await withServer({ RIPPER_METRICS_PUBLIC: '1' }, async base => {
    const m = await fetch(base + '/metrics');
    assert.equal(m.status, 200);
    assert.match(await m.text(), /ripper_http_in_flight/);
  });
});

test('/api/state exige login; /api/health fica aberto (só versão e uptime)', async () => {
  await withServer({}, async base => {
    const denied = await fetch(base + '/api/state');
    assert.equal(denied.status, 401);
    const body = await denied.json();
    assert.match(body.error, /Entre com a senha/);

    assert.equal((await fetch(base + '/api/health')).status, 200);
    const ok = await fetch(base + '/api/health', { headers: { authorization: 'Bearer test-http-token' } });
    assert.equal(ok.status, 200);
    const health = await ok.json();
    assert.equal(health.ok, true);
    assert.equal(health.version, '0.1.0');
    assert.ok(typeof health.uptimeSeconds === 'number');
  });
});

test('GET /healthz e /readyz respondem sem RIPPER_TOKEN', async () => {
  await withServer({}, async base => {
    const hz = await fetch(base + '/healthz');
    assert.equal(hz.status, 200);
    const hzBody = await hz.json();
    assert.equal(hzBody.ok, true);
    assert.equal(hzBody.version, '0.1.0');
    assert.ok(hzBody.uptimeSeconds >= 0);

    const rz = await fetch(base + '/readyz');
    assert.equal(rz.status, 200);
    const rzBody = await rz.json();
    assert.equal(rzBody.ok, true);
    assert.equal(rzBody.version, '0.1.0');
  });
});

test('GET /readyz retorna 503 quando a pasta de dados fica inacessível', { skip: process.platform === 'win32' && 'chmod não restringe acesso no Windows' }, async () => {
  await withServer({}, async (base, _token, dataDir) => {
    chmodSync(dataDir, 0);
    try {
      const r = await fetchWithRetry(base + '/readyz');
      assert.equal(r.status, 503);
      const body = await r.json();
      assert.equal(body.ok, false);
      assert.ok(body.reason);
    } finally {
      chmodSync(dataDir, 0o700);
    }
  });
});

test('X-Request-Id é ecoado quando enviado pelo cliente', async () => {
  await withServer({}, async base => {
    const r = await fetch(base + '/api/health', {
      headers: { authorization: 'Bearer test-http-token', 'X-Request-Id': 'abc' }
    });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-request-id'), 'abc');
  });
});

test('X-Request-Id é gerado quando o cliente não envia', async () => {
  await withServer({}, async base => {
    const r = await fetch(base + '/api/health', { headers: { authorization: 'Bearer test-http-token' } });
    assert.equal(r.status, 200);
    const id = r.headers.get('x-request-id');
    assert.ok(id);
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

test('corpo JSON de erro inclui requestId', async () => {
  await withServer({}, async base => {
    const r = await fetch(base + '/api/state', { headers: { 'X-Request-Id': 'err-body-id' } });
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('x-request-id'), 'err-body-id');
    const body = await r.json();
    assert.equal(body.requestId, 'err-body-id');
    assert.match(body.error, /Entre com a senha/);
  });
});

test('?token= define cookie e redireciona (sem auth header)', async () => {
  await withServer({}, async (base, token) => {
    const r = await fetch(base + '/?token=' + encodeURIComponent(token), { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.match(r.headers.get('set-cookie') || '', /ripper_token=/);
  });
});

test('GET /api/chats lista e busca conversas reais com paginação', async () => {
  await withServer({ RIPPER_TEST_PROVIDER: 'stream' }, async (base, token) => {
    const auth = { authorization: `Bearer ${token}` };
    const st = await (await fetch(base + '/api/state', { headers: auth })).json();
    const agent = st.agents[0];
    const chatRes = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: agent.id, text: 'marcador-unico-busca', model: 'claude-sonnet-5-5', effort: 'low' })
    });
    await chatRes.text();
    await new Promise(r => setTimeout(r, 250));
    const list = await (await fetch(base + '/api/chats?limit=5', { headers: auth })).json();
    assert.ok(Array.isArray(list.items));
    assert.ok(list.total >= 1);
    const found = await (await fetch(base + '/api/chats?q=marcador-unico-busca', { headers: auth })).json();
    assert.equal(found.total, 1);
    assert.match(found.items[0].preview || '', /marcador-unico-busca/);
  });
});

test('GET /api/settings não vaza segredos', async () => {
  await withServer({}, async (base, token) => {
    const put = await fetch(base + '/api/settings', {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ claude: { mode: 'api', apiKey: 'sk-ant-real-secret', useConnectors: false } })
    });
    assert.equal(put.status, 200);

    const r = await fetch(base + '/api/settings', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.settings.claude.apiKey, '••••');
    assert.ok(body.meta.models.includes('codex'));
    const raw = JSON.stringify(body);
    assert.doesNotMatch(raw, /sk-ant-real-secret/);
  });
});

test('PUT /api/settings com modelo inválido retorna 400', async () => {
  await withServer({}, async (base, token) => {
    const r = await fetch(base + '/api/settings', {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ defaultModel: 'modelo-inexistente' })
    });
    assert.equal(r.status, 400);
    const body = await r.json();
    assert.match(body.error, /inválid/i);
    assert.ok(Array.isArray(body.details));
    assert.ok(body.details.some(d => d.path === 'defaultModel'));
  });
});

test('GET /api/usage/limits retorna agregado', async () => {
  await withServer({}, async (base, token) => {
    const r = await fetch(base + '/api/usage/limits', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(body.contractVersion);
    assert.ok(body.accountUsage);
    assert.ok(body.providerSnapshot);
    assert.equal(body.limits.ripperQuota.rolling5h, null);
    assert.ok(body.limits.localUsage);
  });
});

test('GET /api/usage unifica contrato', async () => {
  await withServer({}, async (base, token) => {
    const r = await fetch(base + '/api/usage', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(body.accountUsage);
    assert.ok(body.providerSnapshot);
    assert.ok(body.contextWindow);
    assert.equal(body.contextWindow.emptyLabel, 'sem dados');
  });
});

test('GET /api/diagnostics retorna fatos sem score inventado', async () => {
  await withServer({}, async (base, token) => {
    const r = await fetch(base + '/api/diagnostics', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.ok(body.data.schemaVersion);
    assert.equal(body.score, undefined);
  });
});

test('GET /api/catalog permite cache público', async () => {
  await withServer({}, async (base, token) => {
    const r = await fetch(base + '/api/catalog', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('cache-control') || '', /max-age=3600/);
    const body = await r.json();
    assert.ok(body.templates?.length);
  });
});

test('POST /api/routines não devolve hookSecret', async () => {
  await withServer({}, async (base, token) => {
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const st = await fetch(base + '/api/state', { headers: auth }).then(r => r.json());
    const agentId = st.agents[0].id;
    const r = await fetch(base + '/api/routines', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ agentId, name: 'wh', prompt: 'ping', trigger: 'webhook', hookSecret: 'topsecret' })
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.hasSecret, true);
    assert.equal(body.hookSecret, undefined);
  });
});

test('POST /api/backup e list', async () => {
  await withServer({}, async (base, token) => {
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    await fetch(base + '/api/backup/list', { headers: auth }).then(r => r.json());
    const created = await fetch(base + '/api/backup', { method: 'POST', headers: auth }).then(r => r.json());
    if (created.error) return;
    assert.ok(created.id);
    const listAfter = await fetch(base + '/api/backup/list', { headers: auth }).then(r => r.json());
    assert.ok(listAfter.snapshots.some(s => s.id === created.id));
  });
});

test('GET /api/admin/overview exige modo enterprise', async () => {
  await withServer({}, async (base, token) => {
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const denied = await fetch(base + '/api/admin/overview', { headers: auth });
    assert.equal(denied.status, 403);

    await fetch(base + '/api/settings', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ ui: { mode: 'enterprise' } })
    });
    const ok = await fetch(base + '/api/admin/overview', { headers: auth });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.enterprise, true);
    assert.equal(body.sections.auditTrail.worm, true);
    assert.ok(body.sections.usage);
  });
});

async function enableEnterprise(base, auth) {
  await fetch(base + '/api/settings', {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ ui: { mode: 'enterprise' } })
  });
}

test('GET /api/metering exige enterprise e não inventa dinheiro', async () => {
  await withServer({}, async (base, token) => {
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const denied = await fetch(base + '/api/metering', { headers: auth });
    assert.equal(denied.status, 403);
    await enableEnterprise(base, auth);
    const r = await fetch(base + '/api/metering', { headers: auth });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(body.contractVersion);
    assert.equal(body.tokens, null);
    assert.ok(Array.isArray(body.byDay));
    const raw = JSON.stringify(body);
    assert.doesNotMatch(raw, /"\$|USD|usd/i);
  });
});

test('GET /api/metering/export retorna CSV em enterprise', async () => {
  await withServer({}, async (base, token) => {
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    await enableEnterprise(base, auth);
    const r = await fetch(base + '/api/metering/export', { headers: auth });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /text\/csv/);
    const text = await r.text();
    assert.match(text, /^at_iso,at_ms,model/);
  });
});

test('GET /api/usage/token-roi exige enterprise', async () => {
  await withServer({}, async (base, token) => {
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    assert.equal((await fetch(base + '/api/usage/token-roi', { headers: auth })).status, 403);
    await enableEnterprise(base, auth);
    const r = await fetch(base + '/api/usage/token-roi', { headers: auth });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok('available' in body);
    assert.equal(body.savingsPct, undefined);
  });
});

test('GET /api/audit-trail e /api/lgpd/status', async () => {
  await withServer({}, async (base, token) => {
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    assert.equal((await fetch(base + '/api/audit-trail', { headers: auth })).status, 403);
    await enableEnterprise(base, auth);
    const trail = await fetch(base + '/api/audit-trail', { headers: auth }).then(r => r.json());
    assert.equal(trail.worm, true);
    assert.ok(Array.isArray(trail.entries));
    const lgpd = await fetch(base + '/api/lgpd/status', { headers: auth }).then(r => r.json());
    assert.equal(lgpd.productTelemetry, false);
  });
});

test('POST /api/x9/scan exige enterprise e retorna findings', async () => {
  await withServer({}, async (base, token) => {
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const denied = await fetch(base + '/api/x9/scan', { method: 'POST', headers: auth, body: '{}' });
    assert.equal(denied.status, 403);
    await enableEnterprise(base, auth);
    const r = await fetch(base + '/api/x9/scan', { method: 'POST', headers: auth, body: '{}' });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(Array.isArray(body.findings));
    assert.ok(body.sources?.ripperSettings?.available);
    assert.equal(body.sources.adminOverview.available, true);
    assert.equal(body.sources.lgpd.available, true);
  });
});

test('GET /api/data/backup e restore', async () => {
  await withServer({}, async (base, token) => {
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const snap = await fetch(base + '/api/data/backup', { headers: auth }).then(r => r.json());
    assert.equal(snap.format, 1);
    snap.db.settings.name = 'restaurado-teste';
    const res = await fetch(base + '/api/data/restore', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ confirm: true, backup: snap })
    });
    assert.equal(res.status, 200);
    const st = await fetch(base + '/api/state', { headers: auth }).then(r => r.json());
    assert.equal(st.settings.name, 'restaurado-teste');
  });
});

test('POST /api/team-proposals parse e apply', async () => {
  await withServer({}, async (base, token) => {
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const created = await fetch(base + '/api/team-proposals', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ brief: 'Time: Demo\n- Analista: olha métricas\n- Redator: escreve resumos' })
    });
    assert.equal(created.status, 200);
    const proposal = await created.json();
    assert.equal(proposal.structure.agents.length, 2);
    const applied = await fetch(base + `/api/team-proposals/${proposal.id}/apply`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({})
    });
    assert.equal(applied.status, 200);
    const body = await applied.json();
    assert.equal(body.agents.length, 2);
    assert.ok(body.project?.id);
  });
});

test('RIPPER_LOG_JSON: requisição API emite linhas JSON sem token', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-http-log-'));
  const port = await freePort();
  const env = {
    ...process.env,
    RIPPER_DATA: dataDir,
    PORT: String(port),
    HOST: '127.0.0.1',
    RIPPER_TOKEN: 'test-http-token',
    RIPPER_LOG_JSON: '1'
  };
  const child = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = [];
  child.stdout.on('data', c => stdout.push(c.toString()));
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(base + '/api/health', env.RIPPER_TOKEN, 60_000);
    const parsed = stdout.join('').split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
    const start = parsed.find(e => e.msg === 'http.request.start' && e.route === '/api/health');
    assert.ok(start, 'esperava http.request.start em JSON');
    assert.equal(start.level, 'info');
    assert.ok(start.ts);
    assert.ok(start.requestId);
    const blob = JSON.stringify(parsed);
    assert.doesNotMatch(blob, /test-http-token/);
    assert.doesNotMatch(blob, /Bearer/);
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('exit', r));
  }
});

test('POST /api/lgpd/erasure exige confirmação e apaga perfil', async () => {
  await withServer({}, async (base, token) => {
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const denied = await fetch(base + '/api/lgpd/erasure', { method: 'POST', headers: auth, body: '{}' });
    assert.equal(denied.status, 400);
    await fetch(base + '/api/settings', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ name: 'Titular LGPD' })
    });
    const st0 = await fetch(base + '/api/state', { headers: auth }).then(r => r.json());
    assert.equal(st0.settings.name, 'Titular LGPD');
    const ok = await fetch(base + '/api/lgpd/erasure', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ confirm: true, scope: 'profile' })
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.ok, true);
    assert.equal(body.report.profileCleared, true);
    const st1 = await fetch(base + '/api/state', { headers: auth }).then(r => r.json());
    assert.equal(st1.settings.name, '');
  });
});

test('GET /api/lgpd/status expõe meta', async () => {
  await withServer({}, async (base, token) => {
    const r = await fetch(base + '/api/lgpd/status', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.productTelemetry, false);
    assert.equal(body.lgpd.enabled, false);
    assert.equal(body.lgpd.placeholder, '[PII]');
  });
});

