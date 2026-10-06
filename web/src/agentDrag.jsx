import { useLayoutEffect, useRef, useState } from 'react';
import { AgentAvatar } from './ui.jsx';

/** Anima a troca de lugar dos filhos [data-flip] (técnica FLIP): eles deslizam até a posição nova. */
export function useFlip(ref) {
  const last = useRef(new Map());
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = new Map();
    for (const node of el.querySelectorAll('[data-flip]')) {
      const r = node.getBoundingClientRect();
      next.set(node.dataset.flip, r);
      const prev = last.current.get(node.dataset.flip);
      if (!prev || node.classList.contains('lifted')) continue;
      const dx = prev.left - r.left, dy = prev.top - r.top;
      if (!dx && !dy) continue;
      node.style.transition = 'none';
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        node.style.transition = 'transform .32s cubic-bezier(.2, .9, .3, 1.15)';
        node.style.transform = '';
      });
    }
    last.current = next;
  });
}

/** Põe "@Nome " na caixa de mensagem aberta, como se tivesse digitado. */
function mentionInComposer(name) {
  const ta = document.querySelector('.composer textarea');
  if (!ta) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  const sep = ta.value && !/\s$/.test(ta.value) ? ' ' : '';
  setter.call(ta, `${ta.value}${sep}@${name} `);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus();
  return true;
}

/**
 * Arrastar agentes com o ponteiro: o card "sai na mão" e segue o cursor; os fixados abrem espaço ao vivo.
 * Solta nos fixados = fixa/reordena; na lista = desafixa; na caixa de mensagem = marca o agente.
 */
export function useAgentDrag({ pins, max = 4, onPins, agentById }) {
  const [drag, setDrag] = useState(null); // { id, from, x, y, dx, dy, over, preview }
  const press = useRef(null);
  const moved = useRef(false);

  const previewFor = (id, from, target) => {
    const ids = pins.filter(p => p !== id);
    if (target?.zone !== 'pins') return from === 'pin' ? ids : pins;
    const at = Math.min(target.at ?? ids.length, ids.length);
    if (from === 'list' && ids.length >= max) { // cheio: troca pelo card sob o cursor
      const t = target.pin && target.pin !== id ? ids.indexOf(target.pin) : -1;
      if (t < 0) return pins;
      ids.splice(t, 1, id); return ids;
    }
    ids.splice(at, 0, id);
    return ids;
  };
  const hit = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    if (el.closest('.composer')) return { zone: 'composer' };
    const zone = el.closest('.pins');
    if (zone) {
      // posição pela coordenada (não pelo card sob o cursor, que se move enquanto abre espaço)
      const cards = [...zone.querySelectorAll('[data-pin]')].filter(n => !n.classList.contains('lifted'));
      const at = cards.filter(n => { const r = n.getBoundingClientRect(); return r.left + r.width / 2 < x; }).length;
      return { zone: 'pins', at, pin: el.closest('[data-pin]')?.dataset.pin };
    }
    if (el.closest('.side-list')) return { zone: 'list' };
    return null;
  };

  const onPointerDown = (e, id, from) => {
    if (e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    press.current = { id, from, sx: e.clientX, sy: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width };
    moved.current = false;
    const move = ev => {
      const p = press.current;
      if (!p) return;
      if (!moved.current && Math.hypot(ev.clientX - p.sx, ev.clientY - p.sy) < 6) return;
      moved.current = true;
      document.body.classList.add('agent-dragging');
      const over = hit(ev.clientX, ev.clientY);
      setDrag({ id: p.id, from: p.from, x: ev.clientX - p.dx, y: ev.clientY - p.dy, w: p.w, over, preview: previewFor(p.id, p.from, over) });
    };
    const up = ev => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      document.body.classList.remove('agent-dragging');
      const p = press.current; press.current = null;
      if (!moved.current || !p) { setDrag(null); return; }
      const over = hit(ev.clientX, ev.clientY);
      if (over?.zone === 'composer') mentionInComposer(agentById(p.id)?.name || '');
      else if (over?.zone === 'pins' || (over?.zone === 'list' && p.from === 'pin')) onPins(previewFor(p.id, p.from, over));
      setDrag(null);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  };
  // Depois de arrastar, o clique não navega
  const onClickCapture = e => { if (moved.current) { e.preventDefault(); e.stopPropagation(); moved.current = false; } };

  const ghost = drag && agentById(drag.id) && (
    <div className={`drag-ghost ${drag.over?.zone === 'composer' ? 'to-chat' : ''}`} style={{ transform: `translate(${drag.x}px, ${drag.y}px)` }} aria-hidden="true">
      <div className="drag-card">
        <AgentAvatar agent={agentById(drag.id)} size={44} animate />
        <b>{agentById(drag.id).name}</b>
        {drag.over?.zone === 'composer' && <small>Soltar para marcar</small>}
        {drag.over?.zone === 'list' && drag.from === 'pin' && <small>Soltar para desafixar</small>}
      </div>
    </div>
  );
  return { drag, onPointerDown, onClickCapture, ghost, shownPins: drag ? drag.preview : pins };
}
