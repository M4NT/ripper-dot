import test from 'node:test';
import assert from 'node:assert/strict';
import { monthForecast, usdBrlRate, _resetRateCache, DEFAULT_USD_BRL } from '../lib/usage-report.mjs';
import { normalizeBilling } from '../lib/paid-usage.mjs';

test('monthForecast: soma só o mês corrente e projeta linear', () => {
  const now = Date.parse('2026-04-11T00:00:00Z'); // 10 dias passados de 30
  const ev = [
    { at: Date.parse('2026-03-31T23:00:00Z'), model: 'x', costUsd: 100 }, // mês anterior
    { at: Date.parse('2026-04-02T00:00:00Z'), model: 'x', costUsd: 3 },
    { at: Date.parse('2026-04-10T00:00:00Z'), model: 'x', costUsd: 7 }
  ];
  const f = monthForecast(ev, now);
  assert.equal(f.month, '2026-04');
  assert.equal(f.costUsd, 10);
  assert.equal(f.daysInMonth, 30);
  assert.equal(f.forecastUsd, 30);
  // primeiras horas do mês: piso de 1 dia
  assert.equal(monthForecast([{ at: Date.parse('2026-04-01T01:00:00Z'), model: 'x', costUsd: 1 }], Date.parse('2026-04-01T02:00:00Z')).forecastUsd, 30);
});

test('usdBrlRate: manual > API (cache diário) > padrão', async () => {
  _resetRateCache();
  assert.deepEqual(await usdBrlRate({ billing: { usdBrl: 5.1 } }), { rate: 5.1, source: 'manual' });
  let calls = 0;
  const ok = async () => { calls++; return { ok: true, json: async () => ({ USDBRL: { bid: '5.42' } }) }; };
  assert.deepEqual(await usdBrlRate({}, { fetchImpl: ok }), { rate: 5.42, source: 'awesomeapi' });
  await usdBrlRate({}, { fetchImpl: ok });
  assert.equal(calls, 1);
  _resetRateCache();
  const r = await usdBrlRate({}, { fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(r, { rate: DEFAULT_USD_BRL, source: 'padrão' });
});

test('normalizeBilling: usdBrl vazio vira automático', () => {
  assert.equal(normalizeBilling({ usdBrl: '5.333' }).usdBrl, 5.33);
  assert.equal(normalizeBilling({ usdBrl: '' }, { usdBrl: 5 }).usdBrl, null);
  assert.equal(normalizeBilling({}, { usdBrl: 5 }).usdBrl, 5);
});
