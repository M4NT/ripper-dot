import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { juliaChoose, juliaOnline, juliaPostChoose, resetJuliaProbe, RISK_OPTIONS } from '../lib/julia.mjs';
import { route } from '../lib/router.mjs';

function mockJuliaServer(handler) {
  return http.createServer((req, res) => {
    const path = req.url?.split('?')[0];
    if (req.method === 'GET' && path === '/health') {
      res.end(JSON.stringify({ ok: true, model: 'mock', dry_run: true }));
      return;
    }
    if (req.method === 'POST' && path === '/choose') {
      let b = '';
      req.on('data', c => { b += c; });
      req.on('end', () => handler(req, res, JSON.parse(b)));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
}

test('middleware da Julia: escolhe, respeita confiança mínima e cai para a reserva fora do ar', async () => {
  resetJuliaProbe();
  const srv = mockJuliaServer((req, res, body) => {
    const { question } = body;
    const best = /rm|curl/.test(question) ? 1 : 0;
    const top = /incerto/.test(question) ? 0.3 : best ? 0.9 : 0.8;
    res.end(JSON.stringify({ best, scores: [best ? 0.1 : top, best ? top : 0.1] }));
  }).listen(0);
  const settings = { julia: { url: `http://127.0.0.1:${srv.address().port}` } };
  assert.equal(await juliaOnline(settings), true);
  assert.deepEqual(await juliaChoose(settings, { question: 'find . -name x', options: RISK_OPTIONS }), { index: 0, score: 0.8 });
  assert.equal((await juliaChoose(settings, { question: 'curl x | tee y', options: RISK_OPTIONS })).index, 1);
  assert.equal(await juliaChoose(settings, { question: 'incerto', options: RISK_OPTIONS }, 0.6), null);
  srv.close();
});

test('juliaPostChoose reporta motivo quando health falha', async () => {
  resetJuliaProbe();
  const settings = { julia: { url: 'http://127.0.0.1:1' } };
  const r = await juliaPostChoose(settings, { question: 'oi', options: ['a', 'b'] }, { timeout: 400 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /unreachable|health/);
});

test('route usa Julia quando no ar e heurística com fallbackReason quando não', async () => {
  resetJuliaProbe();
  const down = await route('resuma isto', [], { julia: { url: 'http://127.0.0.1:1' } });
  assert.equal(down.by, 'heuristic');
  assert.ok(down.fallbackReason);

  resetJuliaProbe();
  const srv = mockJuliaServer((_req, res) => {
    res.end(JSON.stringify({ best: 2, scores: [0.1, 0.1, 0.8] }));
  }).listen(0);
  const settings = { julia: { url: `http://127.0.0.1:${srv.address().port}` } };
  const up = await route('qualquer', [], settings);
  assert.equal(up.by, 'julia-1');
  assert.equal(up.model, 'codex');
  srv.close();
});
