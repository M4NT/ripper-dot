import { lazy, Suspense } from 'react';

const RealFx = lazy(() => import('metal-fx').then(m => ({ default: m.MetalFx })));
const RealBadge = lazy(() => import('metal-fx').then(m => ({ default: m.MetalBadge })));

/** Shader de metal: o filho (botão, texto) aparece na hora; o WebGL chega depois. */
export function MetalFx({ children, ...rest }) {
  return (
    <Suspense fallback={children}>
      <RealFx {...rest}>{children}</RealFx>
    </Suspense>
  );
}

export function MetalBadge({ children, ...rest }) {
  return (
    <Suspense fallback={<span className="tag">{children}</span>}>
      <RealBadge {...rest}>{children}</RealBadge>
    </Suspense>
  );
}
