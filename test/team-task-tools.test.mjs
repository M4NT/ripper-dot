import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRipperBuiltinTools } from '../lib/ripper-builtin-tools.mjs';
import { executeTeamTaskTool, TEAM_TASK_TOOL_NAMES, TEAM_TASK_TOOL_CATALOG } from '../lib/team-task-tools.mjs';
import { TEAM_TASK_STATUS, findTeamTask } from '../lib/team-tasks.mjs';

const C = { id: 'coord', name: 'Coordenador', status: 'online', tools: ['web'] };
const W = { id: 'wrk', name: 'Pesquisador', status: 'online', tools: ['web'] };

function ctxBase() {
  const db = {
    agents: [C, W],
    messages: [],
    teamTasks: [],
    chats: [{ id: 'chat-1', agentId: C.id, agentIds: [C.id, W.id], title: 'Time' }],
    taskItems: []
  };
  const events = [];
  let dispatched = 0;
  const ctx = {
    db,
    id: () => crypto.randomUUID(),
    agent: C,
    chat: db.chats[0],
    hops: 0,
    limits: { maxPerHour: 20, maxHops: 5 },
    emit: e => events.push(e),
    save: () => {},
    dispatchInbox: () => { dispatched += 1; }
  };
  return { db, events, dispatched: () => dispatched, ctx };
}

test('task_* só aparecem com ctx.teamBoard e executam via run', async () => {
  const agent = { tools: ['web'] };
  assert.ok(!buildRipperBuiltinTools(agent, {}).some(t => t.name === 'task_create'));
  const calls = [];
  const tools = buildRipperBuiltinTools(agent, { teamBoard: { run: async (n, a) => (calls.push([n, a.title || a.to]), `ok-${n}`) } });
  const names = tools.map(t => t.name);
  for (const n of TEAM_TASK_TOOL_NAMES) assert.ok(names.includes(n), n);
  assert.equal(await tools.find(t => t.name === 'task_create').execute({ title: 'X' }).then(r => r.content[0].text), 'ok-task_create');
  assert.equal(await tools.find(t => t.name === 'team_message').execute({ to: 'Pesquisador', message: 'oi' }).then(r => r.content[0].text), 'ok-team_message');
  assert.deepEqual(calls, [['task_create', 'X'], ['team_message', 'Pesquisador']]);
});

test('task_create delega ao colega e enfileira inbox com prioridade', async () => {
  const { db, events, dispatched, ctx } = ctxBase();
  const out = await executeTeamTaskTool('task_create', {
    title: 'Buscar preços',
    note: 'Liste 3 fornecedores',
    assignee: 'Pesquisador',
    priority: 'now'
  }, ctx);
  assert.match(out, /delegada a Pesquisador.*urgente/);
  assert.equal(db.teamTasks.length, 1);
  assert.equal(db.teamTasks[0].status, TEAM_TASK_STATUS.doing);
  assert.equal(db.messages[0].priority, 'now');
  assert.equal(db.messages[0].to, W.id);
  assert.ok(events.some(e => e.teamTask?.title === 'Buscar preços'));
  assert.ok(events.some(e => e.delegation?.to === W.id));
  assert.equal(dispatched(), 1);
});

test('task_create isolated chama spawnIsolated e marca doing', async () => {
  const { db, ctx } = ctxBase();
  const spawned = [];
  ctx.spawnIsolated = ({ task, worker }) => {
    spawned.push([task.title, worker.name]);
    return { childChatId: 'child-1' };
  };
  const out = await executeTeamTaskTool('task_create', {
    title: 'Resumir PDF',
    note: 'Só as conclusões',
    assignee: 'Pesquisador',
    isolated: true
  }, ctx);
  assert.match(out, /Subagente isolado/);
  assert.deepEqual(spawned, [['Resumir PDF', 'Pesquisador']]);
  assert.equal(db.teamTasks[0].childChatId, 'child-1');
  assert.equal(db.teamTasks[0].status, TEAM_TASK_STATUS.doing);
});

test('task_create isolated recusa auto-delegação', async () => {
  const { ctx } = ctxBase();
  const out = await executeTeamTaskTool('task_create', { title: 'X', isolated: true }, ctx);
  assert.match(out, /si mesmo|colega responsável/);
  const self = await executeTeamTaskTool('task_create', { title: 'Y', assignee: 'Coordenador', isolated: true }, ctx);
  assert.match(self, /si mesmo/);
});

test('task_update aceita prefixo único do id', async () => {
  const { db, ctx } = ctxBase();
  await executeTeamTaskTool('task_create', { title: 'A', assignee: 'Pesquisador' }, ctx);
  const short = db.teamTasks[0].id.slice(0, 8);
  const upd = await executeTeamTaskTool('task_update', { id: short, status: 'done', result: 'ok' }, ctx);
  assert.match(upd, /done/);
  assert.equal(db.teamTasks[0].status, 'done');
});

test('task_list e task_update acompanham o quadro', async () => {
  const { db, ctx } = ctxBase();
  await executeTeamTaskTool('task_create', { title: 'A', assignee: 'Pesquisador' }, ctx);
  const list = await executeTeamTaskTool('task_list', {}, ctx);
  assert.match(list, /Buscar|A ·/);
  assert.match(list, /Pesquisador/);
  const tid = db.teamTasks[0].id;
  const upd = await executeTeamTaskTool('task_update', { id: tid, status: 'done', result: 'pronto', progress: 100 }, ctx);
  assert.match(upd, /done/);
  assert.equal(findTeamTask(db, tid).result, 'pronto');
});

test('team_message liga recado à tarefa', async () => {
  const { db, ctx } = ctxBase();
  await executeTeamTaskTool('task_create', { title: 'Revisar texto' }, ctx);
  const tid = db.teamTasks[0].id;
  const out = await executeTeamTaskTool('team_message', {
    to: 'Pesquisador',
    message: 'Revise o tom do 2º parágrafo',
    priority: 'low',
    task_id: tid
  }, ctx);
  assert.match(out, /Pesquisador/);
  assert.equal(db.messages[0].priority, 'low');
  assert.equal(db.teamTasks[0].inboxMessageId, db.messages[0].id);
  assert.equal(db.teamTasks[0].assigneeId, W.id);
});

test('catálogo tem as quatro ferramentas', () => {
  assert.deepEqual(Object.keys(TEAM_TASK_TOOL_CATALOG), TEAM_TASK_TOOL_NAMES);
});
