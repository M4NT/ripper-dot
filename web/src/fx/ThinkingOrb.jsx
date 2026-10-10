import { lazy, Suspense } from 'react';
import { FxBoundary } from './FxBoundary.jsx';
import { catchFx } from './loadFx.js';

function OrbFallback({ size = 20 }) {
  return <span className="fx-orb-fallback" style={{ width: size, height: size }} aria-hidden="true" />;
}

const Real = lazy(() => catchFx(() => import('thinking-orbs').then(m => ({ default: m.ThinkingOrb })), OrbFallback));

/** Orb de pensamento: a biblioteca (canvas) só baixa quando o indicador aparece. */
export function ThinkingOrb(props) {
  const fallback = <OrbFallback {...props} />;
  return (
    <FxBoundary fallback={fallback}>
      <Suspense fallback={fallback}><Real {...props} /></Suspense>
    </FxBoundary>
  );
}
