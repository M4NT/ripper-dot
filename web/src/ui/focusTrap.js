/** Foco preso numa folha/modal: Tab cicla, Esc fica a cargo do chamador. */

export const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function focusables(root) {
  if (!root?.querySelectorAll) return [];
  return [...root.querySelectorAll(FOCUSABLE)].filter(el => {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    if (style && (style.visibility === 'hidden' || style.display === 'none')) return false;
    return true;
  });
}

export function trapTab(event, root) {
  if (event.key !== 'Tab') return false;
  const list = focusables(root);
  if (!list.length) {
    event.preventDefault();
    root?.focus?.();
    return true;
  }
  const first = list[0];
  const last = list[list.length - 1];
  const ativo = event.target;
  if (event.shiftKey && (ativo === first || !root.contains(ativo))) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && (ativo === last || !root.contains(ativo))) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
