import { lazy, Suspense } from 'react';

const Real = lazy(() => import('bot-avatars').then(m => ({ default: m.BotAvatar })));

/** Mascote 3D: fallback de cor sólida até o canvas do bot-avatars chegar. */
export function BotAvatar(props) {
  const size = props.size || 40;
  return (
    <Suspense fallback={<span className="fx-avatar-fallback" style={{ width: size, height: size, background: props.color || 'var(--ink-2)' }} aria-hidden="true" />}>
      <Real {...props} />
    </Suspense>
  );
}
