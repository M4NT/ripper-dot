/**
 * Gancho opcional para sincronizar tarefas arquivadas com Google Tasks (PR #80).
 * Com `runtime` + `enabled`, delega ao task-sync-bridge; senão no-op seguro.
 */

import { reflectTaskItemInGoogleTasks } from './task-sync-bridge.mjs';

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
 * @param {{ enabled?: boolean, sync?: GoogleTasksSyncHook, runtime?: { db: object, onTokensRefreshed?: Function } }} [config]
 * @returns {GoogleTasksSyncHook}
 */
export function createGoogleTasksSync(config = {}) {
  const inner = config.sync || noopGoogleTasksSync();
  if (!config.enabled) return inner;
  const runtime = config.runtime;
  if (!runtime?.db) return inner;
  return {
    async onTaskCompleted(task) {
      await reflectTaskItemInGoogleTasks(runtime, task, 'completed');
      await inner.onTaskCompleted?.(task);
    },
    async onTaskArchived(task) {
      await reflectTaskItemInGoogleTasks(runtime, task, 'archived');
      await inner.onTaskArchived?.(task);
    }
  };
}
