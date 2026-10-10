import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { JULIA_FAST_TIMEOUT_MS, resetJuliaProbe } from '../lib/julia.mjs';
import { chooseEffort, heuristicEffort, route } from '../lib/router.mjs';

const down = { julia: { url: 'http://127.0.0.1:1', cascade: { enabled: false } }, models: {} };

function mockJulia(handler) {
  return http.createServer((req, res) => {
    const path = req.url?.split('?')[0];
    if (req.method === 'GET' && path === '/health') {
      res.end(JSON.stringify({ ok: true, model: 'mock' }));
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

test('cumprimento e afirmação curta ficam em low; pergunta curta não', () => {
  assert.equal(heuristicEffort('oi', 'claude-sonnet-5-5'), 'low');
  assert.equal(heuristicEffort('obrigado!', 'claude-haiku-5-5'), 'low');
  assert.equal(heuristicEffort('beleza', 'claude-sonnet-5-5'), 'low');
  assert.notEqual(heuristicEffort('Por que o céu é azul?', 'claude-sonnet-5-5'), 'low');
  assert.notEqual(heuristicEffort('Prove que √2 é irracional', 'claude-sonnet-5-5'), 'low');
  assert.notEqual(heuristicEffort('Qual a complexidade de Kruskal?', 'claude-sonnet-5-5'), 'low');
  assert.notEqual(heuristicEffort('Why does this deadlock?', 'claude-sonnet-5-5'), 'low');
  assert.notEqual(heuristicEffort('Resolva a integral de e^x / x', 'claude-sonnet-5-5'), 'low');
  assert.notEqual(heuristicEffort('P=NP?', 'claude-sonnet-5-5'), 'low');
  assert.notEqual(heuristicEffort('resuma isto', 'claude-sonnet-5-5'), 'low');
});

test('modelo já classificado informa o piso do esforço', () => {
  assert.equal(heuristicEffort('qualquer', 'claude-haiku-5-5'), 'low');
  assert.equal(heuristicEffort('qualquer', 'claude-opus-5-5'), 'high');
  assert.equal(heuristicEffort('corrija o script', 'codex'), 'medium');
  assert.equal(heuristicEffort('depure o deadlock no parser', 'codex'), 'high');
});

test('chooseEffort respeita o teto do modelo sem ir à Julia', () => {
  const settings = { models: { maxEffort: { 'claude-opus-5-5': 'medium' } } };
  assert.deepEqual(chooseEffort('planeje a arquitetura', settings, 'claude-opus-5-5'), {
    effort: 'medium',
    effortBy: 'heuristic'
  });
  assert.deepEqual(chooseEffort('oi', { models: { maxEffort: { 'claude-sonnet-5-5': 'low' } } }, 'claude-sonnet-5-5'), {
    effort: 'low',
    effortBy: 'cap'
  });
});

test('Auto: pedido curto difícil não vai para low; cumprimento vai', async () => {
  resetJuliaProbe();
  const hard = await route('Prove que √2 é irracional', [], down);
  assert.notEqual(hard.effort, 'low');
  assert.equal(hard.effortBy, 'heuristic');
  const q = await route('Por que o céu é azul?', [], down);
  assert.notEqual(q.effort, 'low');
  const hi = await route('oi', [], down);
  assert.equal(hi.model, 'claude-haiku-5-5');
  assert.equal(hi.effort, 'low');
  assert.equal(hi.by, 'heuristic');
});

test('route faz uma decisão e respeita o timeout curto quando a Julia trava', async () => {
  resetJuliaProbe();
  let chooses = 0;
  const srv = mockJulia(() => { chooses++; }).listen(0);
  const settings = { julia: { url: `http://127.0.0.1:${srv.address().port}`, cascade: { enabled: false } } };
  const t0 = Date.now();
  const pick = await route('qualquer pedido', [], settings);
  const ms = Date.now() - t0;
  srv.close();
  assert.equal(chooses, 1, 'uma ida à Julia, não rota+esforço em série');
  assert.ok(pick.fallbackReason, 'timeout vira reserva');
  assert.ok(ms < JULIA_FAST_TIMEOUT_MS + 350, `latência ${ms}ms (teto ${JULIA_FAST_TIMEOUT_MS}ms + folga)`);
  assert.ok(ms >= JULIA_FAST_TIMEOUT_MS - 50, `esperava esperar o timeout (~${JULIA_FAST_TIMEOUT_MS}ms), veio ${ms}ms`);
  assert.ok(pick.effort, 'esforço sai da heurística mesmo com Julia travada');
});

test('Julia fora: segunda rota é fallback imediato (cache de offline)', async () => {
  resetJuliaProbe();
  await route('primeira', [], down);
  const t0 = Date.now();
  const pick = await route('segunda', [], down);
  const ms = Date.now() - t0;
  assert.ok(pick.fallbackReason);
  assert.ok(ms < 80, `fallback imediato levou ${ms}ms`);
});

test('cumprimento não espera a Julia (1ª palavra imediata)', async () => {
  resetJuliaProbe();
  let chooses = 0;
  const srv = mockJulia(() => { chooses++; }).listen(0);
  const settings = { julia: { url: `http://127.0.0.1:${srv.address().port}`, cascade: { enabled: false } } };
  const t0 = Date.now();
  const pick = await route('oi', [], settings);
  const ms = Date.now() - t0;
  srv.close();
  assert.equal(chooses, 0);
  assert.equal(pick.model, 'claude-haiku-5-5');
  assert.equal(pick.effort, 'low');
  assert.ok(ms < 50, `cumprimento levou ${ms}ms`);
});

test('Julia no ar: um /choose e esforço local', async () => {
  resetJuliaProbe();
  let chooses = 0;
  const srv = mockJulia((_req, res) => {
    chooses++;
    res.end(JSON.stringify({ best: 2, scores: [0.1, 0.1, 0.8] }));
  }).listen(0);
  const settings = { julia: { url: `http://127.0.0.1:${srv.address().port}`, cascade: { enabled: false } } };
  const t0 = Date.now();
  const pick = await route('qualquer', [], settings);
  const ms = Date.now() - t0;
  srv.close();
  assert.equal(chooses, 1);
  assert.equal(pick.model, 'codex');
  assert.equal(pick.by, 'julia-1');
  assert.equal(pick.effort, 'medium');
  assert.equal(pick.effortBy, 'heuristic');
  assert.ok(ms < JULIA_FAST_TIMEOUT_MS, `Julia rápida não deve chegar perto do teto: ${ms}ms`);
});
