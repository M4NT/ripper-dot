import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGoogleTaskToRecord,
  googlePatchBodyFromRecord,
  googleStatusToInternal,
  internalStatusToGoogle,
  normalizeTaskRecord,
  taskPushFingerprint
} from '../lib/task-delegation.mjs';
import { createGoogleTasksClient, createStubGoogleTasksClient, GoogleTasksApiError } from '../lib/google-tasks-api.mjs';
import {
  googleTasksOAuthStatus,
  mergeGoogleTasksAuth,
  resolveGoogleTasksAccessToken,
  _clearGoogleTasksOAuthFlows
} from '../lib/google-tasks-oauth.mjs';
import {
  pullFromGoogleTasks,
  pushTaskToGoogle,
  syncTaskRecord,
  taskSyncBridgeStatus,
  upsertTaskDelegation
} from '../lib/task-sync-bridge.mjs';
import { _resetStoreForTests, load } from '../lib/store.mjs';

test('mapeamento de status Ripper ↔ Google Tasks', () => {
  assert.equal(internalStatusToGoogle('open'), 'needsAction');
  assert.equal(internalStatusToGoogle('in_progress'), 'needsAction');
  assert.equal(internalStatusToGoogle('done'), 'completed');
  assert.equal(googleStatusToInternal({ status: 'needsAction' }), 'open');
  assert.equal(googleStatusToInternal({ status: 'completed', completed: '2020-01-01T00:00:00.000Z' }), 'done');
});

test('googlePatchBodyFromRecord marca completed com data ISO', () => {
  const body = googlePatchBodyFromRecord(normalizeTaskRecord({ title: 'X', status: 'done' }, { id: () => '1' }));
  assert.equal(body.status, 'completed');
  assert.ok(body.completed);
});

test('pullFromGoogleTasks atualiza registro vinculado', async () => {
  _resetStoreForTests();
  const db = load();
  db.settings.taskSync = {
    google: {
      clientId: 'cid',
      taskListId: '@default',
      oauth: { accessToken: 'at', expiresAt: Date.now() + 3600_000 }
    }
  };
  const stubStore = {
    lists: { '@default': { id: '@default', title: 'My' } },
    tasks: {
      '@default:g1': {
        id: 'g1',
        title: 'Remoto',
        status: 'completed',
        completed: '2026-01-01T00:00:00.000Z',
        etag: '"e1"',
        updated: '2026-01-01T00:00:00.000Z'
      }
    }
  };
  upsertTaskDelegation(db, {
    id: 'local-1',
    title: 'Antigo',
    status: 'open',
    external: { provider: 'google_tasks', taskListId: '@default', taskId: 'g1' }
  });
  const client = createStubGoogleTasksClient(stubStore);
  const out = await pullFromGoogleTasks(db, db.settings, { client });
  assert.equal(out.pulled, 1);
  assert.equal(db.taskDelegations[0].status, 'done');
  assert.equal(db.taskDelegations[0].title, 'Remoto');
});

test('pushTaskToGoogle é idempotente quando remoto já coincide', async () => {
  _resetStoreForTests();
  const db = load();
  db.settings.taskSync = {
    google: {
      clientId: 'cid',
      taskListId: '@default',
      oauth: { accessToken: 'at', expiresAt: Date.now() + 3600_000 }
    }
  };
  const stubStore = {
    lists: {},
    tasks: {
      '@default:g2': {
        id: 'g2',
        title: 'T',
        notes: '',
        status: 'needsAction',
        etag: '"e2"',
        updated: '2026-01-02T00:00:00.000Z'
      }
    }
  };
  upsertTaskDelegation(db, {
    id: 'local-2',
    title: 'T',
    notes: '',
    status: 'open',
    external: { provider: 'google_tasks', taskListId: '@default', taskId: 'g2' }
  });
  const client = createStubGoogleTasksClient(stubStore);
  const first = await pushTaskToGoogle(db, db.settings, 'local-2', { client });
  assert.equal(first.skipped, true);
  assert.equal(first.reason, 'remote_already_matches');
  db.taskDelegations[0].status = 'done';
  const second = await pushTaskToGoogle(db, db.settings, 'local-2', { client });
  assert.equal(second.skipped, false);
  assert.equal(stubStore.tasks['@default:g2'].status, 'completed');
});

test('pushTaskToGoogle skip quando fingerprint local não mudou', async () => {
  _resetStoreForTests();
  const db = load();
  db.settings.taskSync = {
    google: {
      clientId: 'cid',
      taskListId: '@default',
      oauth: { accessToken: 'at', expiresAt: Date.now() + 3600_000 }
    }
  };
  const fp = taskPushFingerprint({ status: 'open', title: 'N', notes: '' });
  upsertTaskDelegation(db, {
    id: 'local-3',
    title: 'N',
    status: 'open',
    external: { provider: 'google_tasks', taskListId: '@default', taskId: 'g3' },
    sync: { pushFingerprint: fp }
  });
  const client = createStubGoogleTasksClient({
    lists: {},
    tasks: { '@default:g3': { id: 'g3', title: 'N', status: 'needsAction', etag: '"e3"', updated: '2026-01-01T00:00:00.000Z' } }
  });
  const out = await pushTaskToGoogle(db, db.settings, 'local-3', { client });
  assert.equal(out.skipped, true);
  assert.equal(out.reason, 'already_pushed');
});

test('syncTaskRecord bidirecional com stub', async () => {
  _resetStoreForTests();
  const db = load();
  db.settings.taskSync = {
    google: { clientId: 'cid', taskListId: '@default', oauth: { accessToken: 'at', expiresAt: Date.now() + 3_600_000 } }
  };
  upsertTaskDelegation(db, {
    id: 'local-4',
    title: 'Sync me',
    status: 'open',
    external: { provider: 'google_tasks', taskListId: '@default', taskId: 'g4' }
  });
  const client = createStubGoogleTasksClient({
    lists: {},
    tasks: {
      '@default:g4': { id: 'g4', title: 'Sync me', status: 'needsAction', notes: '', etag: '"e4"', updated: '2026-01-03T00:00:00.000Z' }
    }
  });
  const out = await syncTaskRecord(db, db.settings, 'local-4', { direction: 'both', client });
  assert.equal(out.pull.changed, false);
  assert.equal(out.push.skipped, true);
});

test('NOT_AUTHENTICATED quando sem token', async () => {
  _resetStoreForTests();
  const db = load();
  db.settings.taskSync = { google: { clientId: 'cid', taskListId: '@default' } };
  await assert.rejects(
    () => pullFromGoogleTasks(db, db.settings, { client: createStubGoogleTasksClient({ lists: {}, tasks: {} }) }),
    err => {
      assert.equal(err.code, 'NOT_AUTHENTICATED');
      assert.match(err.message, /Google|autentic/i);
      return true;
    }
  );
});

test('createGoogleTasksClient propaga NOT_AUTHENTICATED', async () => {
  const client = createGoogleTasksClient({ getAccessToken: async () => null });
  await assert.rejects(() => client.listTasks('@default'), err => err.code === 'NOT_AUTHENTICATED');
});

test('googleTasksOAuthStatus needs_auth e unconfigured', () => {
  _clearGoogleTasksOAuthFlows();
  const needs = googleTasksOAuthStatus({ taskSync: { google: { clientId: 'x' } } });
  assert.equal(needs.state, 'needs_auth');
  const uncfg = googleTasksOAuthStatus({ taskSync: { google: {} } });
  assert.equal(uncfg.state, 'unconfigured');
});

test('mergeGoogleTasksAuth preserva tokens com máscara', () => {
  const merged = mergeGoogleTasksAuth(
    { clientId: 'a', oauth: { accessToken: 'secret', refreshToken: 'r' } },
    { oauth: { accessToken: '••••', refreshToken: '••••' } }
  );
  assert.equal(merged.oauth.accessToken, 'secret');
  assert.equal(merged.oauth.refreshToken, 'r');
});

test('taskSyncBridgeStatus expõe auth', () => {
  const st = taskSyncBridgeStatus({ taskSync: { google: { clientId: 'c' } } });
  assert.equal(st.provider, 'google_tasks');
  assert.equal(st.auth.state, 'needs_auth');
});

test('applyGoogleTaskToRecord não altera se igual', () => {
  const rec = normalizeTaskRecord({ title: 'A', status: 'open' }, { id: () => '1' });
  const { changed } = applyGoogleTaskToRecord(rec, { title: 'A', status: 'needsAction' });
  assert.equal(changed, false);
});

test('resolveGoogleTasksAccessToken refresh mockado', async () => {
  const settings = {
    taskSync: {
      google: {
        clientId: 'cid',
        clientSecret: 'sec',
        oauth: {
          accessToken: 'old',
          refreshToken: 'rt',
          expiresAt: Date.now() - 1000
        }
      }
    }
  };
  const fetch = async (url, init) => {
    assert.match(String(url), /oauth2\.googleapis\.com\/token/);
    assert.match(String(init.body), /refresh_token=rt/);
    return {
      ok: true,
      json: async () => ({ access_token: 'new-at', expires_in: 3600, token_type: 'Bearer' })
    };
  };
  const resolved = await resolveGoogleTasksAccessToken(settings, { fetch, refresh: true });
  assert.equal(resolved.accessToken, 'new-at');
  assert.equal(resolved.refreshed.accessToken, 'new-at');
});
