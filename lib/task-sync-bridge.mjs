/**
 * Ponte bidirecional: registros internos (taskDelegations) ↔ Google Tasks.
 */

import { createGoogleTasksClient, GoogleTasksApiError } from './google-tasks-api.mjs';
import {
  applyGoogleTaskToRecord,
  googlePatchBodyFromRecord,
  googleStatusToInternal,
  normalizeTaskRecord,
  patchRecordForGooglePush,
  taskPushFingerprint
} from './task-delegation.mjs';
import {
  googleTasksOAuthStatus,
  resolveGoogleTasksAccessToken,
  resolveGoogleTasksClientConfig
} from './google-tasks-oauth.mjs';

export { GoogleTasksApiError };

export function taskSyncBridgeStatus(settings) {
  return {
    provider: 'google_tasks',
    auth: googleTasksOAuthStatus(settings),
    taskListId: resolveGoogleTasksClientConfig(settings).taskListId
  };
}

export function listTaskDelegations(db) {
  return (db.taskDelegations || []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function findTaskDelegation(db, id) {
  return (db.taskDelegations || []).find(t => t.id === id) || null;
}

export function upsertTaskDelegation(db, input, { id: idFn } = {}) {
  const now = Date.now();
  const prev = input.id ? findTaskDelegation(db, input.id) : null;
  const row = normalizeTaskRecord(prev ? { ...prev, ...input, sync: { ...prev.sync, ...input.sync } } : input, { id: idFn, now });
  if (!db.taskDelegations) db.taskDelegations = [];
  const idx = db.taskDelegations.findIndex(t => t.id === row.id);
  if (idx >= 0) db.taskDelegations[idx] = row;
  else db.taskDelegations.unshift(row);
  return row;
}

function makeClient(settings, { fetch, onTokensRefreshed }) {
  return createGoogleTasksClient({
    fetch,
    getAccessToken: async () => {
      const resolved = await resolveGoogleTasksAccessToken(settings, { fetch, refresh: true });
      if (resolved?.refreshed && onTokensRefreshed) onTokensRefreshed(resolved.refreshed);
      return resolved?.accessToken || null;
    }
  });
}

function assertBridgeReady(settings) {
  const st = googleTasksOAuthStatus(settings);
  if (st.state === 'unconfigured') {
    throw new GoogleTasksApiError(st.reason || 'Google Tasks não configurado.', { code: 'NOT_CONFIGURED', status: 503 });
  }
  if (st.state === 'needs_auth' || st.state === 'expired') {
    throw new GoogleTasksApiError(st.reason || 'Google Tasks não autenticado.', { code: 'NOT_AUTHENTICATED', status: 401 });
  }
}

/**
 * Puxa estado remoto para registros já vinculados (e opcionalmente importa novas tarefas da lista).
 */
export async function pullFromGoogleTasks(db, settings, opts = {}) {
  assertBridgeReady(settings);
  const cfg = resolveGoogleTasksClientConfig(settings);
  const client = opts.client || makeClient(settings, opts);
  const listId = opts.taskListId || cfg.taskListId;
  const results = { pulled: 0, skipped: 0, imported: 0, errors: [] };

  const linked = (db.taskDelegations || []).filter(t => t.external?.provider === 'google_tasks' && t.external.taskListId === listId);
  for (const rec of linked) {
    try {
      const remote = await client.getTask(listId, rec.external.taskId);
      const { record, changed } = applyGoogleTaskToRecord(rec, remote);
      if (changed) {
        upsertTaskDelegation(db, record);
        results.pulled++;
      } else results.skipped++;
    } catch (e) {
      results.errors.push({ taskId: rec.external.taskId, error: e.message });
    }
  }

  if (opts.importNew) {
    const remoteList = await client.listTasks(listId, { showCompleted: true });
    const known = new Set(linked.map(r => r.external.taskId));
    for (const remote of remoteList.items || []) {
      if (!remote.id || known.has(remote.id)) continue;
      const row = normalizeTaskRecord({
        title: remote.title || '(sem título)',
        notes: remote.notes || '',
        status: remote.status === 'completed' || remote.completed ? 'done' : 'open',
        external: {
          provider: 'google_tasks',
          taskListId: listId,
          taskId: remote.id,
          etag: remote.etag,
          updated: remote.updated
        },
        sync: { lastPullAt: Date.now(), lastRemoteStatus: remote.status }
      }, { id: opts.id });
      db.taskDelegations.unshift(row);
      results.imported++;
    }
  }

  return results;
}

function remoteMatchesRecord(remote, record) {
  return (
    googleStatusToInternal(remote) === record.status &&
    (remote.title || '') === (record.title || '') &&
    (remote.notes || '') === (record.notes || '')
  );
}

/** Envia atualização local para Google Tasks (idempotente). */
export async function pushTaskToGoogle(db, settings, recordId, opts = {}) {
  assertBridgeReady(settings);
  const rec = findTaskDelegation(db, recordId);
  if (!rec) throw new GoogleTasksApiError('Tarefa interna não encontrada.', { code: 'NOT_FOUND', status: 404 });
  const cfg = resolveGoogleTasksClientConfig(settings);
  const client = opts.client || makeClient(settings, opts);
  const listId = rec.external?.taskListId || cfg.taskListId;

  const { record: staged, skip, reason } = patchRecordForGooglePush(rec);
  if (skip) return { ok: true, skipped: true, reason, record: rec };

  const patch = googlePatchBodyFromRecord(staged);
  let remote;
  if (staged.external?.taskId) {
    const current = await client.getTask(listId, staged.external.taskId);
    if (remoteMatchesRecord(current, staged)) {
      return { ok: true, skipped: true, reason: 'remote_already_matches', record: staged };
    }
    remote = await client.patchTask(listId, staged.external.taskId, patch);
  } else {
    remote = await client.insertTask(listId, patch);
    staged.external = {
      provider: 'google_tasks',
      taskListId: listId,
      taskId: remote.id,
      etag: remote.etag,
      updated: remote.updated
    };
  }

  const updated = upsertTaskDelegation(db, {
    ...staged,
    external: {
      ...staged.external,
      etag: remote.etag,
      updated: remote.updated
    },
    sync: {
      ...staged.sync,
      lastPushAt: Date.now(),
      pushFingerprint: taskPushFingerprint(staged),
      lastRemoteStatus: remote.status
    }
  });
  return { ok: true, skipped: false, record: updated, remote };
}

export async function syncTaskRecord(db, settings, recordId, { direction = 'both', ...opts } = {}) {
  const out = { pull: null, push: null };
  if (direction === 'pull' || direction === 'both') {
    const rec = findTaskDelegation(db, recordId);
    if (rec?.external?.taskId) {
      assertBridgeReady(settings);
      const client = opts.client || makeClient(settings, opts);
      const listId = rec.external.taskListId || resolveGoogleTasksClientConfig(settings).taskListId;
      const remote = await client.getTask(listId, rec.external.taskId);
      const { record, changed } = applyGoogleTaskToRecord(rec, remote);
      upsertTaskDelegation(db, record);
      out.pull = { changed };
    } else out.pull = { skipped: true, reason: 'not_linked' };
  }
  if (direction === 'push' || direction === 'both') {
    out.push = await pushTaskToGoogle(db, settings, recordId, opts);
  }
  return out;
}

export async function pushAllLinkedTasks(db, settings, opts = {}) {
  const rows = (db.taskDelegations || []).filter(
    t => opts.allRecords || t.external?.provider === 'google_tasks' || !t.external
  );
  const results = [];
  for (const t of rows) {
    results.push({ id: t.id, ...(await pushTaskToGoogle(db, settings, t.id, opts)) });
  }
  return results;
}

function findDelegationByTaskItemId(db, taskItemId) {
  return (db.taskDelegations || []).find(t => t.sync?.closureTaskItemId === taskItemId) || null;
}

/** Espelha taskItems (closure loop #32) em Google Tasks quando autenticado; falha silenciosa se não. */
export async function reflectTaskItemInGoogleTasks(runtime, taskItem, phase) {
  const db = runtime?.db;
  if (!db || !taskItem?.id) return;
  const settings = db.settings;
  const st = googleTasksOAuthStatus(settings);
  if (st.state !== 'ok' && st.state !== 'expiring_soon' && st.state !== 'expired_refreshable') return;
  const prev = findDelegationByTaskItemId(db, taskItem.id);
  const status = phase === 'archived' || taskItem.status === 'archived' ? 'done' : 'open';
  const row = upsertTaskDelegation(db, {
    ...(prev || {}),
    id: prev?.id || `closure-${taskItem.id}`,
    title: taskItem.title || prev?.title || 'Tarefa',
    notes: taskItem.result || prev?.notes || '',
    status,
    sync: { ...(prev?.sync || {}), closureTaskItemId: taskItem.id, closurePhase: phase }
  });
  try {
    await pushTaskToGoogle(db, settings, row.id, runtime);
  } catch (e) {
    if (e.code === 'NOT_AUTHENTICATED' || e.code === 'NOT_CONFIGURED') return;
    throw e;
  }
}
