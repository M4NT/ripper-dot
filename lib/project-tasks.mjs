/** Quadro de tarefas do projeto (db.projectTasks). Separado de taskItems, que é o registro do inbox entre agentes. */

export const TASK_COLUMNS = Object.freeze([['todo', 'A fazer'], ['doing', 'Fazendo'], ['done', 'Feito']]);
const STATUSES = TASK_COLUMNS.map(([s]) => s);

/** Valida e aplica um patch vindo da API. Lança Error com mensagem em PT para 400. */
export function patchTask(task, b, agents) {
  if (b.title !== undefined) {
    const t = String(b.title || '').trim();
    if (!t) throw new Error('Informe o título da tarefa.');
    task.title = t.slice(0, 200);
  }
  if (b.note !== undefined) task.note = String(b.note || '').slice(0, 2000);
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) throw new Error('Status inválido.');
    task.status = b.status;
    task.error = null;
    task.running = false; // mover à mão destrava card preso (ex.: servidor reiniciou no meio)
  }
  if (b.assigneeId !== undefined) {
    if (b.assigneeId && !agents.some(a => a.id === b.assigneeId)) throw new Error('Agente não encontrado.');
    task.assigneeId = b.assigneeId || null;
  }
  task.updatedAt = Date.now();
  return task;
}

export function taskPrompt(task) {
  return [`Tarefa do quadro do projeto: ${task.title}`, task.note?.trim()].filter(Boolean).join('\n\n');
}
