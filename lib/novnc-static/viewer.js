/* RFB de @novnc/novnc 1.5.0. A senha do VNC fica no servidor; o proxy autentica o RFB. */
(() => {
  const lib = globalThis.NovncLib;
  const RFB = lib && (lib.default || lib);
  if (typeof RFB !== 'function') return;
  const q = new URLSearchParams(location.search);
  const path = q.get('path') || 'websockify';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const rfb = new RFB(document.getElementById('screen'), `${proto}://${location.host}/${path}`);
  rfb.viewOnly = q.get('view_only') !== '0';
  rfb.scaleViewport = q.get('resize') !== 'off';
  rfb.showDotCursor = q.get('show_dot') !== '0';
})();
