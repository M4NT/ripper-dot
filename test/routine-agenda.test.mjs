import test from 'node:test';
import assert from 'node:assert/strict';
import { proximasExecucoes } from '../lib/routine-agenda.mjs';
import { routineDue } from '../lib/agent-flow.mjs';

const agentes = [{ id: 'a1', name: 'Analista' }];
const diaria = (extra = {}) => ({ id: 'r1', name: 'Resumo', agentId: 'a1', dailyAt: '08:00', lastRun: 0, lastStatus: 'never', ...extra });

test('rotina diária aparece uma vez por dia nos próximos dias, no horário certo', () => {
  const agora = new Date(2026, 9, 9, 6, 0, 0); // 9/10/2026 06:00
  const { itens } = proximasExecucoes([diaria()], agora, { dias: 7, agentes });
  assert.equal(itens.length, 7);
  for (const it of itens) assert.equal(new Date(it.quando).getHours(), 8);
  assert.equal(itens[0].agenteNome, 'Analista');
});

test('horário de hoje que já passou não aparece', () => {
  const agora = new Date(2026, 9, 9, 9, 0, 0); // já passou das 08:00
  const { itens } = proximasExecucoes([diaria()], agora, { dias: 2, agentes });
  assert.equal(itens.length, 1); // só amanhã: hoje já passou e o período são 2 dias
  assert.equal(new Date(itens[0].quando).getDate(), 10);
});

test('dias úteis (weekdays) saem só de segunda a sexta', () => {
  const agora = new Date(2026, 9, 9, 6, 0, 0);
  const { itens } = proximasExecucoes([diaria({ weekdays: true })], agora, { dias: 7, agentes });
  for (const it of itens) assert.ok([1, 2, 3, 4, 5].includes(new Date(it.quando).getDay()));
  assert.equal(itens.length, 5);
});

test('dia da semana fixo (weekday) sai só nesse dia', () => {
  const agora = new Date(2026, 9, 9, 6, 0, 0);
  const { itens } = proximasExecucoes([diaria({ weekday: 1 })], agora, { dias: 14, agentes });
  assert.equal(itens.length, 2);
  for (const it of itens) assert.equal(new Date(it.quando).getDay(), 1);
});

test('intervalo vai para o resumo, e gatilho por evento vai para a seção própria', () => {
  const agora = new Date(2026, 9, 9, 6, 0, 0);
  const rotinas = [
    { id: 'i1', name: 'A cada 15', agentId: 'a1', everyMinutes: 15, lastRun: 0 },
    { id: 'e1', name: 'Quando chegar pedido', agentId: 'a1', trigger: 'webhook', lastRun: 0 },
  ];
  const { itens, intervalos, eventos } = proximasExecucoes(rotinas, agora, { dias: 7, agentes });
  assert.equal(itens.length, 0);
  assert.deepEqual(intervalos.map(i => i.minutos), [15]);
  assert.deepEqual(eventos.map(e => e.gatilho), ['webhook']);
});

test('cada horário da agenda é um minuto em que o agendador dispara a rotina', () => {
  const agora = new Date(2026, 9, 9, 6, 0, 0);
  const rotinas = [diaria({ weekdays: true }), diaria({ id: 'r2', dailyAt: '17:30', weekday: 3 })];
  const { itens } = proximasExecucoes(rotinas, agora, { dias: 10, agentes });
  assert.ok(itens.length > 0);
  for (const it of itens) {
    const r = rotinas.find(x => x.id === it.rotinaId);
    assert.equal(routineDue(r, new Date(it.quando)), true, `${it.nome} em ${it.quando}`);
  }
});
