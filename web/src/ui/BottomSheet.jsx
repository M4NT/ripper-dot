/* Adaptado de ObsidianUI sheet + drawer (MIT): slots e handle.
   Sem Radix/Vaul — arrastar, Esc e foco preso ficam aqui. Ver web/src/ui/obsidian/LICENSE */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { focusables, trapTab } from './focusTrap.js';
import { sheetLock } from './sheetLock.js';
import './styles.js';
import '../styles/telas/ui-shell.css';

const FECHA = 120;

/** Folha de baixo (celular): arrastar, Esc, foco preso, 100dvh e safe-area. */
export function BottomSheet({ open, onClose, title, label, children, className = '' }) {
  const sheet = useRef(null);
  const voltar = useRef(null);
  const drag = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [oy, setOy] = useState(0);

  useEffect(() => {
    if (!open) return;
    voltar.current = document.activeElement;
    const root = sheet.current;
    const first = focusables(root)[0];
    (first || root)?.focus();
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onCloseRef.current?.(); }
      else trapTab(e, root);
    };
    document.addEventListener('keydown', onKey, true);
    const unlock = sheetLock.acquire();
    return () => {
      document.removeEventListener('keydown', onKey, true);
      unlock();
      if (typeof voltar.current?.focus === 'function') voltar.current.focus();
    };
  }, [open]);

  const down = e => {
    drag.current = { y: e.clientY, oy: 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = e => {
    if (!drag.current) return;
    const next = Math.max(0, e.clientY - drag.current.y);
    drag.current.oy = next;
    setOy(next);
  };
  const up = () => {
    if (!drag.current) return;
    const dy = drag.current.oy;
    drag.current = null;
    setOy(0);
    if (dy >= FECHA) onCloseRef.current?.();
  };

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="ui-sheet-root" data-slot="sheet" data-open="1">
      <button type="button" className="ui-sheet-scrim" data-slot="sheet-overlay" aria-label="Fechar" onClick={() => onCloseRef.current?.()} />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={label || title || 'Painel'}
        tabIndex={-1}
        className={'ui-sheet' + (className ? ' ' + className : '')}
        data-slot="sheet-content"
        style={oy ? { transform: `translateY(${oy}px)` } : undefined}
      >
        <div
          className="ui-sheet-handle-wrap"
          data-slot="drawer-handle"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <div className="ui-sheet-handle" />
        </div>
        <div className="ui-sheet-head" data-slot="sheet-header">
          {title ? <h2 data-slot="sheet-title">{title}</h2> : <span />}
          <button type="button" className="ui-sheet-close" data-slot="sheet-close" aria-label="Fechar" onClick={() => onCloseRef.current?.()}>
            <svg className="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="ui-sheet-body" data-slot="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
