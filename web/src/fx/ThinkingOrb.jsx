import { lazy, Suspense } from 'react';

const Real = lazy(() => import('thinking-orbs').then(m => ({ default: m.ThinkingOrb })));

/** Orb de pensamento: a biblioteca (canvas) só baixa quando o indicador aparece. */
export function ThinkingOrb(props) {
  const size = props.size || 20;
  return (
    <Suspense fallback={<span className="fx-orb-fallback" style={{ width: size, height: size }} aria-hidden="true" />}>
      <Real {...props} />
    </Suspense>
  );
}
