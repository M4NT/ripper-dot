export const MIC_CONSTRAINTS = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
};

export function micAvailable(nav = globalThis.navigator) {
  return typeof nav?.mediaDevices?.getUserMedia === 'function';
}

/** Por que o microfone não liga: HTTP sem TLS na LAN, navegador sem API, ou permissão. */
export function micHint({ supported, state, secure = globalThis.isSecureContext } = {}) {
  if (supported === false || state === 'unsupported') {
    return secure === false
      ? 'O microfone precisa de HTTPS (ou localhost).'
      : 'Este navegador não tem microfone.';
  }
  if (state === 'denied') return 'Sem acesso ao microfone. Libere nas permissões do navegador.';
  return 'Sem acesso ao microfone. Libere nas permissões do navegador.';
}

export function stopTracks(stream) {
  stream?.getTracks().forEach(t => t.stop());
}
