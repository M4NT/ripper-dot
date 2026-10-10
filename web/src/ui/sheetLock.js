/** Conta inert/overflow do fundo: duas folhas abertas não liberam o scroll na primeira. */

export function createSheetLock({ getBody, getFundo } = {}) {
  let locks = 0;
  let savedOverflow = '';

  const bodyOf = () => getBody?.() ?? (typeof document !== 'undefined' ? document.body : null);
  const fundoOf = () => getFundo?.() ?? (typeof document !== 'undefined' ? document.getElementById('root') : null);

  return {
    get count() { return locks; },
    acquire() {
      const body = bodyOf();
      const fundo = fundoOf();
      if (locks === 0) {
        if (body) {
          savedOverflow = body.style.overflow;
          body.style.overflow = 'hidden';
        }
        if (fundo) fundo.inert = true;
      }
      locks += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        locks = Math.max(0, locks - 1);
        if (locks === 0) {
          if (body) body.style.overflow = savedOverflow;
          if (fundo) fundo.inert = false;
        }
      };
    },
  };
}

export const sheetLock = createSheetLock();
