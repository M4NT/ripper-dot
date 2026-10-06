import { useLayoutEffect, useRef, useState } from 'react';

/** Anima a troca de lugar dos filhos [data-flip] (técnica FLIP): eles deslizam até a posição nova. */
export function useFlip(ref) {
  const last = useRef(new Map());
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = new Map();
    for (const node of el.querySelectorAll('[data-flip]')) {
      const pos = { x: node.offsetLeft, y: node.offsetTop }; // posição de layout, ignora transform
      next.set(node.dataset.flip, pos);
      const prev = last.current.get(node.dataset.flip);
      if (!prev) continue;
      const dx = prev.x - pos.x, dy = prev.y - pos.y;
      if (!dx && !dy) continue;
      const anim = node.getAnimations?.().find(a => a.id === 'flip');
      anim?.cancel();
      node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2, .8, .2, 1)', id: 'flip' });
    }
    last.current = next;
  });
}

/** Marca agentes na conversa aberta (viram botões acima do campo de mensagem). */
const tagAgents = ids => ids.length && dispatchEvent(new CustomEvent('ripper:tag-agents', { detail: { ids } }));

// Índice de inserção pela coordenada do ponteiro (o card sob o cursor se move enquanto abre espaço)
function indexIn(zone, sel, x, y, axis) {
  const items = [...zone.querySelectorAll(sel)].filter(n => !n.classList.contains('lifted'));
  return items.filter(n => { const r = n.getBoundingClientRect(); return axis === 'x' ? r.left + r.width / 2 < x : r.top + r.height / 2 < y; }).length;
}

/**
 * Arrastar na mão: o item "sai" e segue o cursor; fixados (linha) e lista (coluna) abrem espaço ao vivo.
 * pins/list são arrays de chaves; onCommit recebe a ordem nova. Soltar na caixa de mensagem marca o agente.
 */
export function useSidebarDrag({ pins, list, maxPins = 4, canPin, onCommit, renderGhost, idsOf }) {
  const [drag, setDrag] = useState(null);
  const press = useRef(null);
  const moved = useRef(false);

  const hit = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    if (el.closest('.composer')) return { zone: 'composer' };
    const p = el.closest('.pins');
    if (p) return { zone: 'pins', at: indexIn(p, '[data-pin]', x, y, 'x') };
    const l = el.closest('.side-list');
    if (l) return { zone: 'list', at: indexIn(l, '[data-item]', x, y, 'y') };
    return null;
  };
  const preview = (key, over) => {
    let P = pins.filter(k => k !== key), L = list.filter(k => k !== key);
    if (over?.zone === 'pins' && canPin(key)) {
      P.splice(Math.min(over.at, P.length), 0, key);
      if (P.length > maxPins) L = [P.pop(), ...L]; // cheio: o último volta para a lista
    } else if (over?.zone === 'list') L.splice(Math.min(over.at, L.length), 0, key);
    else return { pins, list };
    return { pins: P, list: L };
  };

  const onPointerDown = (e, key) => {
    if (e.button !== 0) return;
    e.preventDefault(); // sem seleção de texto nem arrasto nativo do link
    const r = e.currentTarget.getBoundingClientRect();
    press.current = { key, sx: e.clientX, sy: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height, kind: e.currentTarget.dataset.pin ? 'pin' : 'row' };
    moved.current = false;
    let raf = 0, last = null;
    const move = ev => {
      const p = press.current;
      if (!p) return;
      if (!moved.current && Math.hypot(ev.clientX - p.sx, ev.clientY - p.sy) < 6) return;
      if (!moved.current) { moved.current = true; document.body.classList.add('agent-dragging'); }
      last = ev;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const over = hit(last.clientX, last.clientY);
        setDrag({ key: p.key, kind: p.kind, x: last.clientX - p.dx, y: last.clientY - p.dy, w: p.w, h: p.h, over, ...preview(p.key, over) });
      });
    };
    const up = ev => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      cancelAnimationFrame(raf);
      document.body.classList.remove('agent-dragging');
      const p = press.current; press.current = null;
      if (moved.current && p && ev.type === 'pointerup') {
        const over = hit(ev.clientX, ev.clientY);
        if (over?.zone === 'composer') tagAgents(idsOf(p.key));
        else if (over) onCommit(preview(p.key, over));
      }
      setDrag(null);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  };
  // Depois de arrastar, o clique não navega
  const onClickCapture = e => { if (moved.current) { e.preventDefault(); e.stopPropagation(); moved.current = false; } };

  const ghost = drag && (
    <div className={`drag-ghost ${drag.over?.zone === 'composer' ? 'to-chat' : ''}`} style={{ width: drag.w, height: drag.h, transform: `translate(${drag.x}px, ${drag.y}px)` }} aria-hidden="true">
      <div className={`drag-card ${drag.kind}`}>{renderGhost(drag.key, drag.kind)}</div>
      {drag.over?.zone === 'composer' && <span className="drag-hint">Soltar para marcar</span>}
    </div>
  );
  return { drag, onPointerDown, onClickCapture, ghost, pins: drag ? drag.pins : pins, list: drag ? drag.list : list };
}
