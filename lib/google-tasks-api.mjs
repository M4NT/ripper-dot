/** Cliente Google Tasks API v1 — interface injetável para testes e CI sem credenciais. */

export const GOOGLE_TASKS_API = 'https://tasks.googleapis.com/tasks/v1';

export class GoogleTasksApiError extends Error {
  constructor(message, { code, status, body } = {}) {
    super(message);
    this.name = 'GoogleTasksApiError';
    this.code = code || 'GOOGLE_TASKS_ERROR';
    this.status = status;
    this.body = body;
  }
}

/**
 * @param {{ getAccessToken: () => Promise<string|null>, fetch?: typeof fetch }} deps
 */
export function createGoogleTasksClient({ getAccessToken, fetch: f = fetch }) {
  async function authHeaders() {
    const token = await getAccessToken();
    if (!token) {
      throw new GoogleTasksApiError('Google Tasks não autenticado. Conecte a conta em Configurações → Sincronização de tarefas.', {
        code: 'NOT_AUTHENTICATED',
        status: 401
      });
    }
    return { authorization: `Bearer ${token}`, accept: 'application/json' };
  }

  async function request(path, { method = 'GET', query, body } = {}) {
    const u = new URL(path.startsWith('http') ? path : `${GOOGLE_TASKS_API}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v != null && v !== '') u.searchParams.set(k, String(v));
      }
    }
    const headers = await authHeaders();
    if (body != null) headers['content-type'] = 'application/json';
    const r = await f(u.toString(), {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined
    });
    const text = await r.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!r.ok) {
      const msg = json?.error?.message || text || `Google Tasks HTTP ${r.status}`;
      throw new GoogleTasksApiError(msg, { code: json?.error?.errors?.[0]?.reason || 'GOOGLE_TASKS_HTTP', status: r.status, body: json });
    }
    return json;
  }

  return {
    listTaskLists: ({ maxResults = 100 } = {}) =>
      request('/users/@me/lists', { query: { maxResults } }),
    getTask: (taskListId, taskId) =>
      request(`/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`),
    listTasks: (taskListId, { maxResults = 100, showCompleted = true, updatedMin } = {}) =>
      request(`/lists/${encodeURIComponent(taskListId)}/tasks`, {
        query: { maxResults, showCompleted, ...(updatedMin ? { updatedMin } : {}) }
      }),
    insertTask: (taskListId, task) =>
      request(`/lists/${encodeURIComponent(taskListId)}/tasks`, { method: 'POST', body: task }),
    patchTask: (taskListId, taskId, patch) =>
      request(`/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        body: patch
      })
  };
}

/** Implementação vazia para testes de bridge sem rede. */
export function createStubGoogleTasksClient(store = { lists: {}, tasks: {} }) {
  const tasks = store.tasks;
  const lists = store.lists;
  return {
    listTaskLists: async () => ({ items: Object.values(lists) }),
    getTask: async (listId, taskId) => {
      const t = tasks[`${listId}:${taskId}`];
      if (!t) throw new GoogleTasksApiError('Not Found', { status: 404 });
      return t;
    },
    listTasks: async (listId) => ({
      items: Object.entries(tasks)
        .filter(([k]) => k.startsWith(`${listId}:`))
        .map(([, v]) => v)
    }),
    insertTask: async (listId, task) => {
      const id = task.id || `t-${Object.keys(tasks).length + 1}`;
      const row = { id, etag: `"e${id}"`, updated: new Date().toISOString(), ...task };
      tasks[`${listId}:${id}`] = row;
      return row;
    },
    patchTask: async (listId, taskId, patch) => {
      const key = `${listId}:${taskId}`;
      const prev = tasks[key];
      if (!prev) throw new GoogleTasksApiError('Not Found', { status: 404 });
      const next = { ...prev, ...patch, updated: new Date().toISOString() };
      tasks[key] = next;
      return next;
    }
  };
}
