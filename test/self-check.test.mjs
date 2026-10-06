import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkDue, capabilityGaps } from '../lib/self-check.mjs';

test('checagens noturnas: só com opt-in, uma vez por dia, depois da hora', () => {
  const at3 = new Date(2026, 9, 6, 3, 5), at2 = new Date(2026, 9, 6, 2, 0);
  assert.equal(checkDue({}, 'smoke', null, at3), null, 'desligado por padrão');
  const s = { checks: { smoke: true } };
  assert.equal(checkDue(s, 'smoke', null, at3), '2026-10-06');
  assert.equal(checkDue(s, 'smoke', '2026-10-06', at3), null, 'já rodou hoje');
  assert.equal(checkDue(s, 'smoke', null, at2), null, 'antes das 3h');
  assert.equal(checkDue(s, 'audit', null, at3), null, 'cada checagem tem seu opt-in');
});

test('auditoria barata: catálogo atual sem lacunas; ferramenta sumida ou área falha vira aviso', () => {
  assert.deepEqual(capabilityGaps(JSON.parse(readFileSync(new URL('../docs/capacidades.json', import.meta.url), 'utf8'))), []);
  const gaps = capabilityGaps({ results: [
    { area: 'Memória', pass: true, tools: ['remember', 'WebFetch', 'mcp__x__y'] },
    { area: 'X', pass: true, tools: ['ferramenta_que_sumiu'] },
    { area: 'Y', pass: false, tools: [] }
  ] });
  assert.deepEqual(gaps, ['X: sumiu ferramenta_que_sumiu', 'Y: falhou na última auditoria']);
});
