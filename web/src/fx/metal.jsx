import { lazy, Suspense } from 'react';
import { FxBoundary } from './FxBoundary.jsx';
import { catchFx } from './loadFx.js';

function Passthrough({ children }) { return children; }
function BadgeFallback({ children }) { return <span className="tag">{children}</span>; }

const RealFx = lazy(() => catchFx(() => import('metal-fx').then(m => ({ default: m.MetalFx })), Passthrough));
const RealBadge = lazy(() => catchFx(() => import('metal-fx').then(m => ({ default: m.MetalBadge })), BadgeFallback));

/** Shader de metal: o filho (botão, texto) aparece na hora; o WebGL chega depois. */
export function MetalFx({ children, ...rest }) {
  return (
    <FxBoundary fallback={children}>
      <Suspense fallback={children}><RealFx {...rest}>{children}</RealFx></Suspense>
    </FxBoundary>
  );
}

export function MetalBadge({ children, ...rest }) {
  const fallback = <BadgeFallback>{children}</BadgeFallback>;
  return (
    <FxBoundary fallback={fallback}>
      <Suspense fallback={fallback}><RealBadge {...rest}>{children}</RealBadge></Suspense>
    </FxBoundary>
  );
}
