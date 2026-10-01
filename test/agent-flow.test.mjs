import test from 'node:test';
import assert from 'node:assert/strict';
import { canUseFile, selectSpeakers, routineDue, mayFallback, mentionOrder, Floor, isPass, heuristicSpeaker, trimHistory, turnPlanIds } from '../lib/agent-flow.mjs';

const agents = [
  { id: 'e', name: 'Estrategista', description: 'Define posicionamento e mensagem.' },
  { id: 'r', name: 'Redatora', description: 'Escreve textos curtos, poemas e slogans.' }
];
const chat = { agentIds: ['e', 'r'] };

test('menções definem a ordem de quem fala, na ordem do texto', async () => {
  const text = '@Redatora escreve um poema para o @Estrategista. @Estrategista, opine sobre o poema.';
  assert.deepEqual((await selectSpeakers(chat, text, agents)).map(a => a.id), ['r', 'e']);
});

test('sem menção, fala só um agente (o escolhido pelo classificador)', async () => {
  assert.deepEqual((await selectSpeakers(chat, 'Escreve um slogan', agents, async () => agents[1])).map(a => a.id), ['r']);
  assert.equal((await selectSpeakers(chat, 'Oi', agents)).length, 1);
});

test('conversa individual continua com o próprio agente', async () => {
  assert.deepEqual((await selectSpeakers({ agentId: 'e' }, 'oi', agents)).map(a => a.id), ['e']);
});

test('turnPlanIds deduplica fila inicial e inclui delegados', () => {
  const floor = new Floor([agents[0]], agents);
  assert.deepEqual(turnPlanIds([agents[0]], floor), ['e']);
  floor.afterReply(agents[0], '@Redatora preciso de opções');
  assert.deepEqual(turnPlanIds([], floor), ['e', 'r']);
});

test('delegação com @Nome coloca o colega na fila; PASSO não delega', () => {
  const floor = new Floor([agents[0]], agents);
  const first = floor.next();
  assert.equal(first.id, 'e');
  floor.afterReply(first, 'Isso é com a @Redatora: preciso de 3 opções.');
  assert.equal(floor.next().id, 'r');
  assert.equal(floor.next(), null);
  assert.equal(isPass('PASSO'), true);
  assert.equal(isPass('[passo].'), true);
});

test('afterReply respeita allowPeer antes de enfileirar', () => {
  const floor = new Floor([agents[0]], agents);
  const first = floor.next();
  const added = floor.afterReply(first, '@Redatora ajuda', { allowPeer: () => false });
  assert.deepEqual(added, []);
  assert.equal(floor.next(), null);
  assert.equal(isPass('Passo 1: faça isso'), false);
});

test('rodada tem limite de falas', () => {
  const floor = new Floor([agents[0]], agents, 2);
  const a = floor.next(); floor.afterReply(a, '@Redatora');
  const b = floor.next(); floor.afterReply(b, '@Estrategista');
  assert.equal(floor.next(), null);
});

test('menção sem @ ou dentro de outra palavra não conta', () => {
  assert.deepEqual(mentionOrder('Estrategista, sua vez', agents), []);
  assert.deepEqual(mentionOrder('email@Redatoras.com', agents), []);
});

test('heurística escolhe pela função quando não há Julia', () => {
  assert.equal(heuristicSpeaker('escreva um poema curto', agents).id, 'r');
  assert.equal(heuristicSpeaker('qual posicionamento usar?', agents).id, 'e');
  // Função descrita sem a palavra do pedido: a intenção resolve (slogan é trabalho de quem escreve).
  const team = [{ id: 'e', name: 'Estrategista', description: 'Define posicionamento e mensagem.' }, { id: 'r', name: 'Redatora', description: 'Escreve textos curtos e diretos.' }];
  assert.equal(heuristicSpeaker('Agora preciso de um slogan de 5 palavras para o app.', team).id, 'r');
  assert.equal(heuristicSpeaker('Qual público a campanha deve priorizar?', team).id, 'e');
});

test('histórico é cortado para economizar tokens', () => {
  const msgs = Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: 'x'.repeat(i === 29 ? 5000 : 10) }));
  const h = trimHistory(msgs);
  assert.equal(h.length, 12);
  assert.ok(h.at(-1).content.length < 1600);
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

import { memoryContext } from '../lib/agent-flow.mjs';
test('memória em níveis: perfil inteiro, registro só o mais recente e datado', () => {
  const mem = [
    { text: 'Prefere TypeScript', createdAt: 1 },                                   // antiga, sem nível = perfil
    { text: 'Mora em SP', tier: 'profile', createdAt: 2 },
    ...Array.from({ length: 15 }, (_, i) => ({ text: 'evento ' + i, tier: 'log', createdAt: Date.UTC(2026, 8, 1 + i) }))
  ];
  const ctx = memoryContext(mem, 3);
  assert.match(ctx, /Prefere TypeScript/); assert.match(ctx, /Mora em SP/);
  assert.match(ctx, /evento 14/); assert.doesNotMatch(ctx, /evento 11\b/);
  assert.match(ctx, /\[\d\d\/\d\d\/2026\] evento 12/);
  assert.equal(memoryContext([], 5), '');
});
