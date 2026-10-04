// Só o necessário para instalar como app (celular/tablet). Sem cache: o Ripper é ao vivo.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
