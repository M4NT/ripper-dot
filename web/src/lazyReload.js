import { lazy } from 'react';

/** Lazy com um recarregamento automático se o chunk 404 (deploy com a aba aberta). */
export function lazyReload(load) {
  return lazy(() => load().catch(err => {
    const last = +sessionStorage.getItem('ripper.reloaded') || 0;
    if (Date.now() - last > 30_000) {
      sessionStorage.setItem('ripper.reloaded', String(Date.now()));
      location.reload();
      return new Promise(() => {});
    }
    throw err;
  }));
}
