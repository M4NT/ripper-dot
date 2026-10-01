import { useApp } from './app.jsx';

/** Lê uma feature flag local a partir do estado global (settings.flags). */
export function useFlag(key) {
  const { S } = useApp();
  const flags = S?.settings?.flags;
  return flags?.[key] === true;
}
