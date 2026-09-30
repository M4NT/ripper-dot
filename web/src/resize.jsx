import { useEffect, useRef } from 'react';
import { local } from './lib.js';

/** Aplica as larguras salvas antes da primeira pintura. */
export function restoreWidths() {
  for (const k of ['side-w', 'panel-w']) {
    const v = local.get(k, null);
    if (v) document.documentElement.style.setProperty('--' + k, v + 'px');
  }
}

/**
 * Alça de redimensionar na borda de uma barra lateral.
 * side="left": a barra fica à esquerda da alça (arrastar para a direita aumenta).
 * side="right": a barra fica à direita da alça (arrastar para a esquerda aumenta).
 * Clique duplo recolhe/expande; arrastar abaixo do mínimo recolhe; recolhida, clicar expande.
 */
export function ResizeHandle({ side, cssVar, min, max, collapsed, onCollapse, onExpand, label }) {
  const drag = useRef(null);
  useEffect(() => () => document.body.classList.remove('resizing'), []);
  function down(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const bar = e.currentTarget.parentElement;
    const start = bar.getBoundingClientRect().width;
    drag.current = { x: e.clientX, start, moved: false };
    document.body.classList.add('resizing');
    const move = ev => {
      const d = drag.current; if (!d) return;
      const dx = side === 'left' ? ev.clientX - d.x : d.x - ev.clientX;
      if (Math.abs(dx) > 3) d.moved = true;
      if (collapsed) { if (dx > 24) { onExpand?.(); d.expanded = true; } return; }
      const w = Math.round(d.start + dx);
      if (w < min - 60) { d.collapse = true; return; }
      d.collapse = false;
      const clamped = Math.max(min, Math.min(max, w));
      document.documentElement.style.setProperty('--' + cssVar, clamped + 'px');
      d.width = clamped;
    };
    const up = () => {
      const d = drag.current; drag.current = null;
      document.body.classList.remove('resizing');
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (!d) return;
      if (d.collapse) onCollapse?.();
      else if (d.width) local.set(cssVar, d.width);
      if (!d.moved && collapsed && !d.expanded) onExpand?.();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }
  function key(e) {
    const step = e.shiftKey ? 40 : 12;
    const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--' + cssVar)) || (side === 'left' ? 264 : 340);
    const grow = side === 'left' ? e.key === 'ArrowRight' : e.key === 'ArrowLeft';
    const shrink = side === 'left' ? e.key === 'ArrowLeft' : e.key === 'ArrowRight';
    if (!grow && !shrink) return;
    e.preventDefault();
    const w = Math.max(min, Math.min(max, cur + (grow ? step : -step)));
    document.documentElement.style.setProperty('--' + cssVar, w + 'px');
    local.set(cssVar, w);
  }
  return (
    <div className={`resize-handle ${side} ${collapsed ? 'collapsed' : ''}`} role="separator" aria-orientation="vertical" tabIndex={0}
      aria-label={label} title={collapsed ? 'Clique ou arraste para abrir' : 'Arraste para ajustar · clique duplo para recolher'}
      onPointerDown={down} onKeyDown={key} onDoubleClick={() => (collapsed ? onExpand?.() : onCollapse?.())}>
      <span className="grip" />
    </div>
  );
}
