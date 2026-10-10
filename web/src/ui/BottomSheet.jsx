import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { focusables, trapTab } from './focusTrap.js';
import '../tokens.css';
import '../styles/telas/ui-state.css';

const FECHA = 120;

/** Folha de baixo (celular): arrastar, Esc, foco preso, 100dvh e safe-area. */
export function BottomSheet({ open, onClose, title, label, children, className = '' }) {
  const sheet = useRef(null);
  const voltar = useRef(null);
  const drag = useRef(null);
  const [oy, setOy] = useState(0);

  useEffect(() => {
    if (!open) return;
    voltar.current = document.activeElement;
    const root = sheet.current;
    const first = focusables(root)[0];
    (first || root)?.focus();
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose?.(); }
      else trapTab(e, root);
    };
    document.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
      if (typeof voltar.current?.focus === 'function') voltar.current.focus();
    };
  }, [open, onClose]);

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
    if (dy >= FECHA) onClose?.();
  };

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="ui-sheet-root" data-open="1">
      <button type="button" className="ui-sheet-scrim" aria-label="Fechar" onClick={() => onClose?.()} />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={label || title || 'Painel'}
        tabIndex={-1}
        className={'ui-sheet' + (className ? ' ' + className : '')}
        style={oy ? { transform: `translateY(${oy}px)` } : undefined}
      >
        <div
          className="ui-sheet-handle-wrap"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <div className="ui-sheet-handle" />
        </div>
        <div className="ui-sheet-head">
          {title ? <h2>{title}</h2> : <span />}
          <button type="button" className="ui-sheet-close" aria-label="Fechar" onClick={() => onClose?.()}>
            <svg className="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="ui-sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
