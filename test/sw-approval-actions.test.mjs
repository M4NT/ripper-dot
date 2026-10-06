import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Roda o service worker num "self" falso e simula a notificação de aprovação
function loadSw(fetchImpl) {
  const handlers = {}, shown = [];
  const self = {
    addEventListener: (t, f) => { handlers[t] = f; },
    skipWaiting() {}, clients: { claim() {}, matchAll: async () => [] },
    registration: { scope: 'http://ripper.test/', showNotification: async (title, opts) => { shown.push({ title, ...opts }); } }
  };
  vm.runInNewContext(readFileSync(new URL('../web/public/sw.js', import.meta.url), 'utf8'), { self, fetch: fetchImpl, URL, JSON });
  const fire = async (type, ev) => { let p; handlers[type]({ ...ev, waitUntil: x => { p = x; } }); await p; };
  return { fire, shown };
}

test('notificação de aprovação: botões Aprovar/Recusar decidem sem abrir o app', async () => {
  const calls = [];
  const { fire, shown } = loadSw(async (url, opts) => { calls.push({ url: String(url), body: JSON.parse(opts.body) }); return { ok: true, status: 200 }; });
  await fire('push', { data: { json: () => ({ title: 'Donald precisa de você', body: 'npm test', approvalId: 'ap1', url: '#/c/x' }) } });
  assert.equal(JSON.stringify(shown[0].actions.map(a => a.action)), '["approve","deny"]');
  const n = { close() {}, data: shown[0].data, body: 'npm test' };
  await fire('notificationclick', { action: 'approve', notification: n });
  assert.deepEqual(calls, [{ url: 'http://ripper.test/api/approvals/ap1', body: { approve: true } }]);
  assert.equal(shown.at(-1).title, 'Aprovado');
});

test('aviso comum (sem aprovação) não ganha botões', async () => {
  const { fire, shown } = loadSw(async () => ({ ok: true }));
  await fire('push', { data: { json: () => ({ title: 'Resumo', body: 'oi' }) } });
  assert.equal(shown[0].actions, undefined);
});
