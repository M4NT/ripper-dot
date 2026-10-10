/**
 * Ferramentas do quadro do time: task_create / task_list / task_update / team_message.
 * Catálogo no formato RIPPER_TOOL_CATALOG; a execução recebe ctx.teamBoard.run.
 */

import { z } from 'zod';
import { findAgentByName } from './inbox.mjs';
import {
  TEAM_TASK_STATUS,
  createTeamTask,
  listTeamTasks,
  updateTeamTask,
  findTeamTask,
  enqueuePeerMessage,
  linkOrCreateTeamTaskFromInbox,
  publicTeamTask,
  formatTeamTaskList,
  taskTitleFromText
} from './team-tasks.mjs';

export const TEAM_TASK_TOOL_NAMES = ['task_create', 'task_list', 'task_update', 'team_message'];

export const TEAM_TASK_TOOL_CATALOG = {
  task_create: {
    description: 'Cria uma tarefa no quadro do time e, se houver responsável, delega em segundo plano. Use para dividir um pedido: cada pedaço vira uma tarefa com dono. isolated=true abre um subagente com conversa própria (sem o histórico desta). deps = ids de tarefas que precisam terminar antes.',
    inputSchema: {
      title: z.string().min(1).max(200).describe('Nome curto que o usuário vê'),
      note: z.string().max(4000).optional().describe('Pedido completo e autossuficiente para quem for executar'),
      assignee: z.string().max(80).optional().describe('Nome exato do colega responsável'),
      deps: z.array(z.string().max(80)).max(20).optional().describe('Ids de tarefas que precisam estar feitas antes'),
      priority: z.enum(['now', 'normal', 'low']).optional().describe('now acorda o colega na hora; normal/low ele lê no próximo turno'),
      isolated: z.boolean().optional().describe('true = subtarefa com contexto próprio (histórico vazio)')
    }
  },
  task_list: {
    description: 'Lista as tarefas do quadro do time nesta conversa (status, responsável, dependências, progresso).',
    inputSchema: {
      status: z.enum(['todo', 'doing', 'blocked', 'done', 'cancelled']).optional(),
      assignee: z.string().max(80).optional().describe('Filtrar pelo nome do responsável'),
      mine: z.boolean().optional().describe('true = só as que você criou ou está fazendo')
    }
  },
  task_update: {
    description: 'Atualiza uma tarefa do time: status, progresso (0–100), resultado ou nota. Use doing quando começar, done quando entregar, blocked se estiver esperando outra.',
    inputSchema: {
      id: z.string().min(1).max(80).describe('Id da tarefa (task_list)'),
      status: z.enum(['todo', 'doing', 'blocked', 'done', 'cancelled']).optional(),
      progress: z.number().min(0).max(100).optional().describe('Porcentagem concluída'),
      progress_note: z.string().max(500).optional().describe('O que está acontecendo agora'),
      result: z.string().max(4000).optional().describe('Entrega final (quando status=done)'),
      note: z.string().max(4000).optional()
    }
  },
  team_message: {
    description: 'Manda um recado assíncrono a um colega, com prioridade, e liga à tarefa do quadro. now = acordar agora; normal/low = aviso lido no próximo turno. Não espere a resposta.',
    inputSchema: {
      to: z.string().describe('Nome exato do colega'),
      message: z.string().max(4000).describe('Pedido completo: o colega não vê esta conversa'),
      priority: z.enum(['now', 'normal', 'low']).optional(),
      task_id: z.string().max(80).optional().describe('Id da tarefa do quadro a vincular')
    }
  }
};

const text = t => String(t);

function resolveAssignee(name, agents) {
  if (!name) return { agent: null };
  const agent = findAgentByName(name, agents);
  if (!agent) return { error: `Destinatário desconhecido: "${name}". Use o nome exato de um colega.` };
  return { agent };
}

/**
 * Executa uma ferramenta do quadro. deps injetados pelo servidor.
 * @param {string} name
 * @param {object} args
 * @param {object} ctx
 */
export async function executeTeamTaskTool(name, args, ctx) {
  const {
    db,
    id,
    agent,
    chat,
    emit,
    hops = 0,
    limits,
    save,
    dispatchInbox,
    spawnIsolated
  } = ctx;
  const now = Date.now();

  if (name === 'task_list') {
    const filters = { chatId: chat.id };
    if (args.status) filters.status = args.status;
    if (args.mine) {
      const mine = listTeamTasks(db, { chatId: chat.id }).filter(t => t.ownerId === agent.id || t.assigneeId === agent.id);
      const byStatus = args.status ? mine.filter(t => t.status === args.status) : mine;
      return text(formatTeamTaskList(byStatus, db));
    }
    if (args.assignee) {
      const who = resolveAssignee(args.assignee, db.agents);
      if (who.error) return text(who.error);
      filters.assigneeId = who.agent.id;
    }
    return text(formatTeamTaskList(listTeamTasks(db, filters), db));
  }

  if (name === 'task_update') {
    const task = findTeamTask(db, args.id);
    if (!task) return text('Tarefa não encontrada. Use task_list para ver os ids.');
    const patch = {};
    if (args.status) patch.status = args.status;
    if (args.note !== undefined) patch.note = args.note;
    if (args.result !== undefined) patch.result = args.result;
    if (args.progress != null || args.progress_note) {
      patch.progress = {
        percent: args.progress,
        note: args.progress_note || task.progress?.note || ''
      };
    }
    const out = updateTeamTask(db, args.id, patch, { now });
    if (out.error) return text(out.error);
    save?.();
    emit?.({ teamTask: publicTeamTask(out.task, db) });
    const pub = publicTeamTask(out.task, db);
    return text(`Tarefa "${pub.title}" → ${pub.status}${pub.progress?.percent != null ? ` (${pub.progress.percent}%)` : ''}.`);
  }

  if (name === 'team_message') {
    const who = resolveAssignee(args.to, db.agents);
    if (who.error) return text(who.error);
    const queued = enqueuePeerMessage({
      db,
      id,
      from: agent,
      to: who.agent,
      body: args.message,
      priority: args.priority || 'normal',
      originChatId: chat.id,
      hops,
      limits,
      now
    });
    if (queued.error) return text(queued.error);

    let task;
    if (args.task_id) {
      const linked = updateTeamTask(db, args.task_id, {
        assigneeId: who.agent.id,
        inboxMessageId: queued.message.id,
        status: TEAM_TASK_STATUS.doing,
        priority: args.priority || 'normal'
      }, { now });
      if (linked.error) return text(linked.error);
      task = linked.task;
    } else {
      const created = linkOrCreateTeamTaskFromInbox(db, queued.message, { id, ownerId: agent.id, now });
      if (created.error) return text(created.error);
      task = created.task;
    }
    save?.();
    emit?.({
      sent: { to: who.agent.name, priority: queued.message.priority },
      delegation: { from: agent.id, to: who.agent.id, task: task.title, messageId: queued.message.id },
      teamTask: publicTeamTask(task, db)
    });
    dispatchInbox?.();
    return text(`Mensagem enviada para ${who.agent.name}${queued.message.priority === 'now' ? ' (urgente)' : ''}. Tarefa "${task.title}" no quadro. A resposta volta nesta conversa; não espere por ela.`);
  }

  if (name === 'task_create') {
    let assignee = null;
    if (args.assignee) {
      const who = resolveAssignee(args.assignee, db.agents);
      if (who.error) return text(who.error);
      if (who.agent.id === agent.id && !args.isolated) {
        return text('Para uma subtarefa sua com contexto próprio, use isolated=true. Para pedir a um colega, informe o nome dele.');
      }
      assignee = who.agent;
    }

    const created = createTeamTask(db, {
      ownerId: agent.id,
      assigneeId: assignee?.id || (args.isolated ? agent.id : null),
      title: args.title,
      note: args.note || '',
      deps: args.deps,
      priority: args.priority || 'normal',
      isolated: !!args.isolated,
      chatId: chat.id,
      originChatId: chat.id,
      status: TEAM_TASK_STATUS.todo
    }, { id, now });
    if (created.error) return text(created.error);
    const task = created.task;

    if (task.status === TEAM_TASK_STATUS.blocked) {
      save?.();
      emit?.({ teamTask: publicTeamTask(task, db) });
      return text(`Tarefa "${task.title}" criada e bloqueada até as dependências terminarem (${task.id.slice(0, 8)}).`);
    }

    if (args.isolated) {
      if (typeof spawnIsolated !== 'function') {
        save?.();
        emit?.({ teamTask: publicTeamTask(task, db) });
        return text(`Tarefa "${task.title}" criada, mas este turno não pode abrir subagente isolado.`);
      }
      const worker = assignee || agent;
      const spawned = spawnIsolated({
        task,
        worker,
        prompt: args.note || args.title
      });
      if (spawned?.error) return text(spawned.error);
      if (spawned?.childChatId) {
        updateTeamTask(db, task.id, { childChatId: spawned.childChatId, status: TEAM_TASK_STATUS.doing, assigneeId: worker.id }, { now });
      } else {
        updateTeamTask(db, task.id, { status: TEAM_TASK_STATUS.doing, assigneeId: worker.id }, { now });
      }
      save?.();
      emit?.({
        teamTask: publicTeamTask(findTeamTask(db, task.id), db),
        subtask: { key: `team:${task.id}`, title: task.title, status: 'running', chars: 0 }
      });
      return text(`Subagente isolado de ${worker.name} começou "${task.title}" em segundo plano (${task.id.slice(0, 8)}). Acompanhe com task_list; não invente o resultado.`);
    }

    if (assignee) {
      const body = args.note?.trim() || args.title;
      const queued = enqueuePeerMessage({
        db,
        id,
        from: agent,
        to: assignee,
        body,
        priority: args.priority || 'normal',
        originChatId: chat.id,
        hops,
        limits,
        now
      });
      if (queued.error) return text(queued.error);
      updateTeamTask(db, task.id, {
        inboxMessageId: queued.message.id,
        status: TEAM_TASK_STATUS.doing
      }, { now });
      save?.();
      emit?.({
        sent: { to: assignee.name, priority: queued.message.priority },
        delegation: { from: agent.id, to: assignee.id, task: task.title, messageId: queued.message.id },
        teamTask: publicTeamTask(findTeamTask(db, task.id), db)
      });
      dispatchInbox?.();
      return text(`Tarefa "${task.title}" delegada a ${assignee.name}${queued.message.priority === 'now' ? ' (urgente)' : ''}. Id ${task.id.slice(0, 8)}. A resposta aparece nesta conversa quando chegar.`);
    }

    save?.();
    emit?.({ teamTask: publicTeamTask(task, db) });
    return text(`Tarefa "${task.title}" criada no quadro (${task.id.slice(0, 8)}), sem responsável ainda.`);
  }

  return text(`ferramenta desconhecida: ${name}`);
}

export function teamTaskToolLabels() {
  return {
    task_create: 'Criando tarefa do time',
    task_list: 'Listando tarefas do time',
    task_update: 'Atualizando tarefa do time',
    team_message: 'Mandando recado do time'
  };
}

/** Título curto para a linha do tempo (describeRipperTool). */
export function describeTeamTaskTool(name, input = {}) {
  if (name === 'task_create') return input.title || input.assignee;
  if (name === 'task_update') return input.status || input.id;
  if (name === 'task_list') return input.status || (input.mine ? 'minhas' : 'listar');
  if (name === 'team_message') return input.to && `→ ${input.to}${input.priority === 'now' ? ' (urgente)' : ''}`;
  return undefined;
}

export { taskTitleFromText };
