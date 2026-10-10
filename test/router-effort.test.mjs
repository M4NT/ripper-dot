import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JULIA_COLD_TIMEOUT_MS,
  JULIA_FAST_TIMEOUT_MS,
  RISK_OPTIONS,
  _setJuliaFetchForTests,
  juliaPostChoose,
  juliaTimeoutCount,
  resetJuliaProbe,
  resolveRouteTimeout
} from '../lib/julia.mjs';
import { chooseEffort, heuristicEffort, route } from '../lib/router.mjs';

const down = { julia: { url: 'http://127.0.0.1:1', cascade: { enabled: false } }, models: {} };

function timeoutErr() {
  const e = new Error('timeout');
  e.name = 'TimeoutError';
  return e;
}

function jsonRes(body, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

async function withFetchMock(fn, body) {
  resetJuliaProbe();
  _setJuliaFetchForTests(fn);
  try {
    await body();
  } finally {
    _setJuliaFetchForTests(null);
    resetJuliaProbe();
  }
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

test('porque (conjunção) não sobe o esforço; por que (pergunta) sim', () => {
  assert.equal(heuristicEffort('faz isso porque o prazo é amanhã', 'claude-sonnet-5-5'), 'low');
  assert.notEqual(heuristicEffort('Por que o checkout falha no PIX?', 'claude-sonnet-5-5'), 'low');
});

test('modelo já classificado informa o piso do esforço', () => {
  assert.equal(heuristicEffort('qualquer', 'claude-haiku-5-5'), 'low');
  assert.equal(heuristicEffort('qualquer', 'claude-opus-5-5'), 'high');
  assert.equal(heuristicEffort('corrija o script', 'codex'), 'medium');
  assert.equal(heuristicEffort('depure o deadlock no parser', 'codex'), 'high');
  assert.equal(heuristicEffort('ok', 'claude-opus-5-5', { continueTask: true }), 'high');
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

test('Auto: pedido curto difícil não vai para low; cumprimento na abertura vai', async () => {
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

test('sim/pode/ok no meio da tarefa mantém o modelo e não cai em low', async () => {
  resetJuliaProbe();
  const history = [
    { role: 'user', content: 'planeje a arquitetura do checkout' },
    { role: 'assistant', content: 'Sigo com o plano em três etapas?', model: 'claude-opus-5-5' }
  ];
  for (const text of ['sim', 'pode', 'ok']) {
    const pick = await route(text, history, down);
    assert.equal(pick.model, 'claude-opus-5-5', text);
    assert.equal(pick.by, 'sticky', text);
    assert.notEqual(pick.effort, 'low', text);
  }
});

test('resolveRouteTimeout: configurável, frio no 1º uso, curto depois', async () => {
  resetJuliaProbe();
  assert.equal(resolveRouteTimeout({}), JULIA_COLD_TIMEOUT_MS);
  assert.equal(resolveRouteTimeout({ julia: { routeTimeoutMs: 800 } }), 800);
  const prev = process.env.JULIA_ROUTE_TIMEOUT_MS;
  process.env.JULIA_ROUTE_TIMEOUT_MS = '600';
  try {
    assert.equal(resolveRouteTimeout({}), 600);
  } finally {
    if (prev == null) delete process.env.JULIA_ROUTE_TIMEOUT_MS;
    else process.env.JULIA_ROUTE_TIMEOUT_MS = prev;
  }
  await withFetchMock(async () => jsonRes({ best: 0, scores: [0.9, 0.1] }), async () => {
    await juliaPostChoose({ julia: { url: 'http://127.0.0.1:8765' } }, { question: 'x', options: ['a', 'b'] });
    assert.equal(resolveRouteTimeout({}), JULIA_FAST_TIMEOUT_MS);
  });
});

test('timeout de rota: uma decisão, métrica, e risco ainda tenta a Julia', async () => {
  let chooses = 0;
  await withFetchMock(async url => {
    if (String(url).endsWith('/choose')) {
      chooses++;
      throw timeoutErr();
    }
    throw new Error('unexpected ' + url);
  }, async () => {
    const settings = { julia: { url: 'http://127.0.0.1:8765', cascade: { enabled: false } } };
    const pick = await route('qualquer pedido', [], settings);
    assert.equal(chooses, 1);
    assert.equal(pick.fallbackReason, 'choose_timeout');
    assert.equal(juliaTimeoutCount, 1);
    assert.ok(pick.effort);

    const again = await route('segunda pergunta', [], settings);
    assert.equal(chooses, 1, '2ª rota do mesmo uso não chama de novo');
    assert.equal(again.fallbackReason, 'choose_timeout');

    chooses = 0;
    _setJuliaFetchForTests(async url => {
      if (String(url).endsWith('/choose')) {
        chooses++;
        return jsonRes({ best: 0, scores: [0.9, 0.1, 0.1, 0.1] });
      }
      throw new Error('unexpected');
    });
    const risk = await juliaPostChoose(settings, { question: 'rm -rf /', options: RISK_OPTIONS }, { purpose: 'risk' });
    assert.equal(risk.ok, true);
    assert.equal(chooses, 1, 'risco não herda o timeout da rota');
  });
});

test('Julia fora de verdade: todos os usos caem na reserva sem nova ida', async () => {
  let chooses = 0;
  await withFetchMock(async () => {
    chooses++;
    throw new TypeError('fetch failed');
  }, async () => {
    const settings = { julia: { url: 'http://127.0.0.1:8765', cascade: { enabled: false } } };
    await route('primeira', [], settings);
    assert.equal(chooses, 1);
    const pick = await route('segunda', [], settings);
    assert.ok(pick.fallbackReason);
    assert.equal(chooses, 1);
    await juliaPostChoose(settings, { question: 'rm', options: RISK_OPTIONS }, { purpose: 'risk' });
    assert.equal(chooses, 1, 'offline global vale para risco');
  });
});

test('cumprimento na abertura não chama a Julia', async () => {
  let chooses = 0;
  await withFetchMock(async () => {
    chooses++;
    throw timeoutErr();
  }, async () => {
    const pick = await route('oi', [], { julia: { url: 'http://127.0.0.1:8765', cascade: { enabled: false } } });
    assert.equal(chooses, 0);
    assert.equal(pick.model, 'claude-haiku-5-5');
    assert.equal(pick.effort, 'low');
  });
});

test('Julia no ar: um /choose e esforço local', async () => {
  let chooses = 0;
  await withFetchMock(async url => {
    if (String(url).endsWith('/choose')) {
      chooses++;
      return jsonRes({ best: 2, scores: [0.1, 0.1, 0.8] });
    }
    throw new Error('unexpected');
  }, async () => {
    const pick = await route('qualquer', [], { julia: { url: 'http://127.0.0.1:8765', cascade: { enabled: false } } });
    assert.equal(chooses, 1);
    assert.equal(pick.model, 'codex');
    assert.equal(pick.by, 'julia-1');
    assert.equal(pick.effort, 'medium');
    assert.equal(pick.effortBy, 'heuristic');
  });
});
