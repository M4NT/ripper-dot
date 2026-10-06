// Só o necessário para instalar como app (celular/tablet). Sem cache: o Ripper é ao vivo.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

// Notificações (Web Push): aprovações e avisos da Caixa.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  const opts = { body: d.body || '', icon: '/favicon.svg', data: { url: d.url || '#/inbox', approvalId: d.approvalId } };
  // Pedido de sim/não: dá para decidir sem abrir o app
  if (d.approvalId) { opts.actions = [{ action: 'approve', title: 'Aprovar' }, { action: 'deny', title: 'Recusar' }]; opts.tag = `approval-${d.approvalId}`; opts.requireInteraction = true; }
  e.waitUntil(self.registration.showNotification(d.title || 'Ripper', opts));
});

async function decide(id, approve) {
  try {
    const r = await fetch(new URL(`api/approvals/${id}`, self.registration.scope), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approve }) });
    return r.ok ? (approve ? 'Aprovado' : 'Recusado') : r.status === 401 ? 'Entre no Ripper para decidir' : 'Não deu: abra o Ripper';
  } catch { return 'Sem conexão com o Ripper'; }
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const { url: path, approvalId } = e.notification.data || {};
  if (approvalId && (e.action === 'approve' || e.action === 'deny')) {
    e.waitUntil(decide(approvalId, e.action === 'approve').then(msg => self.registration.showNotification(msg, { body: e.notification.body, icon: '/favicon.svg', tag: `approval-${approvalId}`, data: { url: path } })));
    return;
  }
  const url = new URL(path || '#/inbox', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list.find(w => w.url.startsWith(self.registration.scope));
    if (!c) return self.clients.openWindow(url);
    return c.focus().then(w => (w || c).navigate?.(url)).catch(() => {});
  }));
});
