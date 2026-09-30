import test from 'node:test';
import assert from 'node:assert/strict';
import { canUseFile, selectSpeakers, routineDue, mayFallback } from '../lib/agent-flow.mjs';

test('grupo responde na ordem e uma menção restringe a rodada', () => {
  const agents = [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bruno' }];
  const chat = { agentIds: ['a', 'b'] };
  assert.deepEqual(selectSpeakers(chat, 'O que acham?', agents).map(a => a.id), ['a', 'b']);
  assert.deepEqual(selectSpeakers(chat, 'Pergunta para @Bruno', agents).map(a => a.id), ['b']);
});

test('anexo de outro agente não atravessa projeto', () => {
  assert.equal(canUseFile({ agentId: 'a' }, { id: 'b' }, {}), false);
  assert.equal(canUseFile({ agentId: null, projectId: 'p' }, { id: 'b' }, { projectId: 'p' }), true);
  assert.equal(canUseFile({ agentId: null, projectId: 'p' }, { id: 'b' }, { projectId: 'q' }), false);
});

test('rotina não dispara duas vezes no mesmo minuto', () => {
  const now = new Date('2026-09-30T08:00:20');
  const routine = { dailyAt: '08:00', lastRun: 0 };
  assert.equal(routineDue(routine, now), true);
  routine.lastRun = now.getTime();
  assert.equal(routineDue(routine, now), false);
  assert.equal(routineDue({ everyMinutes: 5, lastRun: now.getTime() - 4 * 60_000 }, now), false);
});

test('falha depois do início da resposta preserva o texto sem chamar outro modelo', () => {
  assert.equal(mayFallback('', false), true);
  assert.equal(mayFallback('resposta parcial', false), false);
  assert.equal(mayFallback('', true), false);
});
