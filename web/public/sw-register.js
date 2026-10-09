// Registra o service worker (instalar como app e notificações). Arquivo próprio: a política de segurança bloqueia script inline.
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
