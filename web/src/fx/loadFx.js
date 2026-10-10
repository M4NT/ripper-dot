/** Import de efeito opcional: 404/rede vira o fallback, sem rejeitar a promise. */
export function catchFx(load, Fallback) {
  return Promise.resolve().then(load).catch(() => ({ default: Fallback }));
}
