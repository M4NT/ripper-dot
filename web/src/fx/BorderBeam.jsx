import { lazy, Suspense } from 'react';

const Real = lazy(() => import('border-beam').then(m => ({ default: m.BorderBeam })));

/** Feixe na borda do card: o artigo aparece na hora; a animação chega depois. */
export function BorderBeam({ children, ...rest }) {
  return (
    <Suspense fallback={children}>
      <Real {...rest}>{children}</Real>
    </Suspense>
  );
}
