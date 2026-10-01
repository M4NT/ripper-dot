/**
 * Gancho opcional para sincronizar tarefas arquivadas com Google Tasks (PR #80).
 * Implementação real ficará em outro PR; aqui só o contrato e um no-op seguro.
 */

/** @typedef {{ id: string, title?: string, status?: string, result?: string, archivedAt?: number }} TaskItemSnapshot */

/**
 * @typedef {Object} GoogleTasksSyncHook
 * @property {(task: TaskItemSnapshot) => void | Promise<void>} [onTaskArchived]
 * @property {(task: TaskItemSnapshot) => void | Promise<void>} [onTaskCompleted]
 */

/** Gancho que não faz nada — padrão até o sync com Google Tasks existir. */
export function noopGoogleTasksSync() {
  return {};
}

/**
 * Factory reservada para PR #80. Hoje só repassa callbacks explícitos ou no-op.
 * @param {{ enabled?: boolean, sync?: GoogleTasksSyncHook }} [config]
 * @returns {GoogleTasksSyncHook}
 */
export function createGoogleTasksSync(config = {}) {
  const inner = config.sync || noopGoogleTasksSync();
  if (!config.enabled) return inner;
  return {
    async onTaskCompleted(task) {
      await inner.onTaskCompleted?.(task);
    },
    async onTaskArchived(task) {
      await inner.onTaskArchived?.(task);
    }
  };
}
