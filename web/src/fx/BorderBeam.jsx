import { lazy, Suspense } from 'react';
import { FxBoundary } from './FxBoundary.jsx';
import { catchFx } from './loadFx.js';

function Passthrough({ children }) { return children; }

const Real = lazy(() => catchFx(() => import('border-beam').then(m => ({ default: m.BorderBeam })), Passthrough));

/** Feixe na borda do card: o artigo aparece na hora; a animação chega depois. */
export function BorderBeam({ children, ...rest }) {
  return (
    <FxBoundary fallback={children}>
      <Suspense fallback={children}><Real {...rest}>{children}</Real></Suspense>
    </FxBoundary>
  );
}
