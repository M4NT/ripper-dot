import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('docs/conversas-referencia.json: 10 cenários com id único, mensagens, agentes e regex válidas', () => {
  const { cenarios, limites } = JSON.parse(readFileSync(new URL('../docs/conversas-referencia.json', import.meta.url), 'utf8'));
  assert.equal(cenarios.length, 10);
  assert.equal(new Set(cenarios.map(c => c.id)).size, 10);
  assert.ok(limites.primeiroSinalSeg > 0 && limites.primeiroTextoSeg > 0);
  for (const c of cenarios) {
    assert.ok(c.titulo && c.agentes.length && c.mensagens.length && c.mensagens.every(m => m.texto?.trim()), c.id);
    const e = c.espera;
    assert.ok(e.responder?.length, c.id);
    [...e.responder, ...(e.proibido || [])].forEach(rx => new RegExp(rx, 'i'));
    for (const n of [e.delegacaoPara, ...(e.respondem || []), ...(e.calados || [])].filter(Boolean)) assert.ok(c.agentes.includes(n), `${c.id}: ${n}`);
    if (c.grupo) assert.ok(c.agentes.length >= 3, c.id);
  }
  assert.ok(cenarios.some(c => c.espera.caixa) && cenarios.some(c => c.espera.fecho) && cenarios.some(c => c.mensagens.some(m => m.durante)));
});
