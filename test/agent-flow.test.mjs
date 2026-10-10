import test from 'node:test';
import assert from 'node:assert/strict';
import { canUseFile, selectSpeakers, routineDue, mayFallback, mentionOrder, Floor, isPass, heuristicSpeaker, trimHistory, turnPlanIds, delegationCardState, ownerBlockedReason, oneLineTask, ambiguousMentions, isAck, summarizeTools, toProviderMessages, continueHistoryAfterConnectors, estimateHistoryTokens } from '../lib/agent-flow.mjs';

test('@menção tolerante a nome; ambígua não chama ninguém', () => {
  const eng = { id: 'e', name: 'Engenheiro de Software (Ripper)' };
  const ana = { id: 'a', name: 'Ana Souza', nickname: 'Ana' };
  for (const t of ['@Ripper veja', 'oi @ripper', '@Engenheiro de Software (Ripper), olha', '@Engenheiro ajuda', '@Engenheiro de Software ok?'])
    assert.deepEqual(mentionOrder(t, [eng, ana]).map(a => a.id), ['e'], t);
  assert.deepEqual(mentionOrder('@ana e @Ripper', [eng, ana]).map(a => a.id), ['a', 'e']);
  const eng2 = { id: 'e2', name: 'Engenheiro de Dados' };
  assert.deepEqual(mentionOrder('@Engenheiro faça', [eng, eng2]), []);
  assert.deepEqual(ambiguousMentions('@Engenheiro faça', [eng, eng2])[0].agents.map(a => a.id), ['e', 'e2']);
  assert.deepEqual(mentionOrder('@Engenheiro de Dados faça', [eng, eng2]).map(a => a.id), ['e2']);
});

test('confirmação de colega encerra a troca', () => {
  for (const t of ['ok', 'Recebido!', 'valeu', '👍', '@Ana ok, valeu 👍', 'Beleza, obrigado.']) assert.equal(isAck(t), true, t);
  for (const t of ['ok, mas troque a cor', 'recebido o arquivo? manda de novo', '', 'Feito: salvei em relatorio.xlsx']) assert.equal(isAck(t), false, t);
  const ana = { id: 'a', name: 'Ana' }, bia = { id: 'b', name: 'Bia' };
  assert.deepEqual(new Floor([], [ana, bia]).afterReply(bia, '@Ana valeu!'), []);
});

test('cartão de delegação: aguardando → trabalhando → feito / falhou', () => {
  const d = { to: 'b', task: 'x', messageId: 'm1' };
  assert.equal(delegationCardState(d, [], {}).status, 'aguardando');
  assert.equal(delegationCardState(d, [], { m1: { status: 'queued' } }).status, 'aguardando');
  assert.equal(delegationCardState(d, [], { m1: { status: 'delivering' } }).status, 'trabalhando');
  assert.deepEqual(delegationCardState(d, [], { m1: { status: 'failed', error: 'caiu' } }), { status: 'falhou', result: 'caiu' });
  assert.deepEqual(delegationCardState(d, [], { m1: { status: 'delivered', reply: 'ok' } }), { status: 'feito', result: 'ok' });
  const msgs = [{ role: 'assistant', agentId: 'b', content: 'pronto', via: { type: 'inbox', messageId: 'm1' } }];
  // evento ao vivo (delegationStatus) por cima do inboxStatus salvo, como o Chat.jsx mescla
  assert.equal(delegationCardState(d, [], { ...{ m1: { status: 'queued' } }, ...{ m1: { status: 'delivering' } } }).status, 'trabalhando');
  assert.equal(delegationCardState(d, [], { ...{}, ...{ m1: { status: 'delivered', reply: 'ok' } } }).status, 'feito');
  assert.deepEqual(delegationCardState(d, msgs,{ m1: { status: 'delivering' } }), { status: 'feito', result: 'pronto' });
  // @menção no grupo
  const g = { to: 'b', task: 'y' };
  const thread = [{ role: 'assistant', agentId: 'a', delegations: [g] }];
  assert.equal(delegationCardState(g, thread, {}, 'b').status, 'trabalhando');
  assert.equal(delegationCardState(g, thread, {}).status, 'aguardando');
  assert.equal(delegationCardState(g, [...thread, { role: 'assistant', agentId: 'b', content: 'z' }], {}).status, 'feito');
  assert.equal(oneLineTask('a\n\n**b**  c'), 'a b c');
});

test('bloqueio pelo dono: frases claras viram item, resposta normal não', () => {
  assert.match(ownerBlockedReason('Rodei o build. Preciso que você me passe a senha do servidor. O resto está pronto.'), /^Preciso que você me passe a senha/);
  assert.ok(ownerBlockedReason('BLOQUEADO: a VM caiu.'));
  assert.ok(ownerBlockedReason('Não consigo continuar sem o arquivo da planilha.'));
  assert.ok(ownerBlockedReason('Isso depende de você aprovar o orçamento.'));
  assert.equal(ownerBlockedReason('Pronto, o build passou e subi a correção.'), null);
  assert.equal(ownerBlockedReason('O desbloqueio da conta foi feito.'), null);
  assert.equal(ownerBlockedReason(''), null);
});

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

test('histórico cabe por tokens, mantém mensagens reais e resume ferramentas', () => {
  const small = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `msg ${i}` }));
  const kept = trimHistory(small);
  assert.ok(kept.length > 12, 'mensagens curtas não caem no teto antigo de 12');
  assert.equal(kept.length, 30);
  assert.equal(kept[0].role, 'user');
  assert.equal(kept.at(-1).role, 'assistant');
  assert.equal(kept.at(-1).content, 'msg 29');

  const withTools = trimHistory([{
    role: 'assistant',
    content: 'pronto',
    steps: [{ tool: 'remember', detail: 'gosta de café' }, { tool: 'computer_exec', detail: 'python app.py' }]
  }]);
  assert.match(withTools[0].content, /pronto/);
  assert.match(withTools[0].content, /\[Ferramentas: remember: gosta de café · computer_exec: python app.py\]/);

  const budget = trimHistory(
    Array.from({ length: 40 }, (_, i) => ({ role: 'user', content: `bloco-${i} ${'y'.repeat(80)}` })),
    { maxTokens: 256, keepRecent: 3 }
  );
  assert.ok(budget.length >= 3);
  assert.ok(budget.length < 40);
  assert.match(budget.at(-1).content, /bloco-39/);
  assert.ok(estimateHistoryTokens(budget) <= 256);

  const huge = trimHistory([{ role: 'user', content: 'z'.repeat(20_000) }]);
  assert.ok(huge[0].content.length > 1600);
  assert.match(huge[0].content, /\[…\]/);
});

test('toProviderMessages e continueHistoryAfterConnectors não achatam o turno', () => {
  assert.equal(summarizeTools([{ tool: 'remember', detail: 'x' }]), 'remember: x');
  const msgs = toProviderMessages([
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: 'feito', steps: [{ tool: 'remember', detail: 'café' }] }
  ]);
  assert.deepEqual(msgs.map(m => m.role), ['user', 'assistant']);
  assert.match(msgs[1].content, /\[Ferramentas: remember: café\]/);

  const cont = continueHistoryAfterConnectors(
    [{ role: 'user', content: 'oi' }],
    'vê a agenda',
    { text: 'vou ver', tools: [{ tool: 'use_connectors' }] }
  );
  assert.equal(cont.history[1].role, 'user');
  assert.equal(cont.history[1].content, 'vê a agenda');
  assert.equal(cont.history[2].role, 'assistant');
  assert.match(cont.history[2].content, /vou ver/);
  assert.match(cont.history[2].content, /use_connectors/);
  assert.match(cont.prompt, /Continue de onde parou/);
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

test('rotina só em dias úteis: roda de segunda a sexta, pula fim de semana', () => {
  const r = { dailyAt: '07:00', weekdays: true, lastRun: 0 };
  assert.equal(routineDue(r, new Date('2026-10-05T07:00:10')), true);  // segunda
  assert.equal(routineDue(r, new Date('2026-10-09T07:00:10')), true);  // sexta
  assert.equal(routineDue(r, new Date('2026-10-10T07:00:10')), false); // sábado
  assert.equal(routineDue(r, new Date('2026-10-11T07:00:10')), false); // domingo
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

test('@Apelido chama o agente (ex.: @Ripper → Engenheiro de Software)', async () => {
  const { mentionOrder } = await import('../lib/agent-flow.mjs');
  const ms = [{ id: 1, name: 'Engenheiro de Software', nickname: 'Ripper' }, { id: 2, name: 'Donald' }];
  assert.deepEqual(mentionOrder('@Donald e @Ripper, vejam isso', ms).map(a => a.id), [2, 1]);
  assert.deepEqual(mentionOrder('@Ripperzao', ms), [], 'apelido precisa ser a palavra inteira');
});

test('chamado pelo nome sem @ (vocativo): começo, fim ou entre vírgulas; no meio da frase não', async () => {
  const { addressedByName, selectSpeakers } = await import('../lib/agent-flow.mjs');
  const ms = [{ id: 1, name: 'Engenheiro de Software', nickname: 'Ripper' }, { id: 2, name: 'Donald' }, { id: 3, name: 'Quinn' }];
  const ids = t => addressedByName(t, ms).map(a => a.id);
  assert.deepEqual(ids('consegue resolver isso ripper?'), [1]);
  assert.deepEqual(ids('Ripper consegue bolar algum jeito?'), [1]);
  assert.deepEqual(ids('o Ripper precisa de testes, Quinn, pode ver?'), [3]);
  assert.deepEqual(ids('vamos melhorar a plataforma Ripper hoje'), []);
  const chat = { agentIds: [1, 2, 3] };
  const first = await selectSpeakers(chat, 'consegue resolver isso ripper?', ms, async () => ms[1]);
  assert.deepEqual(first.map(a => a.id), [1], 'nome vence o classificador');
});
