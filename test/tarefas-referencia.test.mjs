import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('docs/tarefas-referencia.json: 50 tarefas com id único, critérios e regex válidas', () => {
  const { tarefas } = JSON.parse(readFileSync(new URL('../docs/tarefas-referencia.json', import.meta.url), 'utf8'));
  assert.equal(tarefas.length, 50);
  assert.equal(new Set(tarefas.map(t => t.id)).size, 50);
  for (const t of tarefas) {
    assert.ok(t.prompt?.length > 20 && t.titulo && t.categoria, t.id);
    assert.ok(t.criterios.length && t.verificar.length, t.id);
    t.verificar.forEach(rx => new RegExp(rx, 'i'));
    for (const a of t.anexos || []) assert.ok(existsSync(new URL(`fixtures/benchmark/${a}`, import.meta.url)), `${t.id}: anexo ${a} ausente`);
  }
  assert.ok(tarefas.filter(t => t.anexos?.length).length >= 12);
});
