import { useCallback, useEffect, useRef, useState } from 'react';
import { FxBoundary } from './FxBoundary.jsx';
import { MIC_CONSTRAINTS, micAvailable, micHint, stopTracks } from './mic.js';

/** Feixe de voz como camada por cima: o formulário nunca remonta quando o chunk chega. */
export function VoiceBeam({ children, className, ...rest }) {
  const [Beam, setBeam] = useState(null);
  useEffect(() => {
    import('voice-glow').then(m => setBeam(() => m.VoiceBeam)).catch(() => {});
  }, []);
  return (
    <div className={className}>
      {children}
      {Beam && (
        <FxBoundary fallback={null}>
          <Beam {...rest} className="fx-voice-layer" aria-hidden="true">
            <span className="fx-voice-slot" />
          </Beam>
        </FxBoundary>
      )}
    </div>
  );
}

/** Microfone nativo — evita puxar voice-glow só para getUserMedia. */
export function useMicrophone() {
  const [stream, setStream] = useState(null);
  const [state, setState] = useState(() => (micAvailable() ? 'idle' : 'unsupported'));
  const [error, setError] = useState(null);
  const streamRef = useRef(null);
  const supported = micAvailable();
  const hint = micHint({ supported, state });

  const stop = useCallback(() => {
    const cur = streamRef.current;
    streamRef.current = null;
    stopTracks(cur);
    setStream(null);
    setState(micAvailable() ? 'idle' : 'unsupported');
  }, []);

  const start = useCallback(async () => {
    if (!micAvailable()) { setState('unsupported'); return null; }
    const prev = streamRef.current;
    streamRef.current = null;
    stopTracks(prev);
    setStream(null);
    setState('requesting');
    try {
      const s = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      streamRef.current = s;
      setStream(s);
      setState('live');
      setError(null);
      return s;
    } catch (e) {
      setError(e);
      setState(e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'denied' : 'error');
      return null;
    }
  }, []);

  return { stream, state, error, supported, start, stop, hint };
}
