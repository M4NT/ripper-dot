// Só o necessário para instalar como app (celular/tablet). Sem cache: o Ripper é ao vivo.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

// Notificações (Web Push): aprovações e avisos da Caixa.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(self.registration.showNotification(d.title || 'Ripper', { body: d.body || '', icon: '/favicon.svg', data: { url: d.url || '#/inbox' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '#/inbox', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list.find(w => w.url.startsWith(self.registration.scope));
    if (!c) return self.clients.openWindow(url);
    return c.focus().then(w => (w || c).navigate?.(url)).catch(() => {});
  }));
});
