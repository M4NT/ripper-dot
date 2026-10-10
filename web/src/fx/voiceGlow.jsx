import { lazy, Suspense, useCallback, useState } from 'react';

const Real = lazy(() => import('voice-glow').then(m => ({ default: m.VoiceBeam })));

/** Feixe de voz (canvas): o campo de mensagem renderiza na hora; o efeito chega depois. */
export function VoiceBeam({ children, className, ...rest }) {
  return (
    <Suspense fallback={<div className={className}>{children}</div>}>
      <Real className={className} {...rest}>{children}</Real>
    </Suspense>
  );
}

/** Microfone nativo — evita puxar voice-glow só para getUserMedia. */
export function useMicrophone() {
  const [stream, setStream] = useState(null);
  const [state, setState] = useState(() => (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia ? 'idle' : 'unsupported'));
  const [error, setError] = useState(null);
  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  const start = useCallback(async () => {
    if (!supported) { setState('unsupported'); return null; }
    setState('requesting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      setStream(s);
      setState('live');
      setError(null);
      return s;
    } catch (e) {
      setError(e);
      setState(e?.name === 'NotAllowedError' ? 'denied' : 'error');
      return null;
    }
  }, [supported]);

  const stop = useCallback(() => {
    setStream(s => { s?.getTracks().forEach(t => t.stop()); return null; });
    setState(supported ? 'idle' : 'unsupported');
  }, [supported]);

  return { stream, state, error, supported, start, stop };
}
