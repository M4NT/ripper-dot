import { lazy, Suspense } from 'react';
import { FxBoundary } from './FxBoundary.jsx';
import { catchFx } from './loadFx.js';
import { botAvatarPalette } from './botAvatarPalette.js';

function AvatarFallback({ size = 40, color, type }) {
  const bg = color || botAvatarPalette[type] || 'var(--ink-2)';
  return <span className="fx-avatar-fallback" style={{ width: size, height: size, background: bg }} aria-hidden="true" />;
}

const Real = lazy(() => catchFx(() => import('bot-avatars').then(m => ({ default: m.BotAvatar })), AvatarFallback));

/** Mascote 3D: fallback de cor sólida até o canvas do bot-avatars chegar. */
export function BotAvatar(props) {
  const fallback = <AvatarFallback {...props} />;
  return (
    <FxBoundary fallback={fallback}>
      <Suspense fallback={fallback}><Real {...props} /></Suspense>
    </FxBoundary>
  );
}
