import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BotAvatar } from 'bot-avatars';
import { Liquid } from 'liquid-gooey';

/* ---------- ícones: um só traço, 1.6px, desenhados à mão ---------- */
const P = {
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  group: 'M8 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM16.5 11a3 3 0 1 0 0-6M2 20a6 6 0 0 1 12 0M16 14.2a5 5 0 0 1 6 4.8',
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  agents: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M16 3.2a4 4 0 0 1 0 7.6M22 21v-1a6 6 0 0 0-4-5.6',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21a2 2 0 0 1 2-2h13v2H6a2 2 0 0 1-2-2M8 7h7',
  cube: 'M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z',
  plus: 'M12 5v14M5 12h14',
  arrowR: 'M5 12h14M13 6l6 6-6 6',
  arrowL: 'M19 12H5M11 6l-6 6 6 6',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  down: 'm6 9 6 6 6-6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  x: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  terminal: 'M4 17l6-5-6-5M12 19h8',
  brain: 'M9.5 3A2.5 2.5 0 0 0 7 5.5v.3A3 3 0 0 0 4.5 9a3 3 0 0 0 .6 1.8A3 3 0 0 0 4 13.5a3 3 0 0 0 2.4 3A2.5 2.5 0 0 0 9 19.5a2.5 2.5 0 0 0 3-.1V4.2A2.5 2.5 0 0 0 9.5 3zM14.5 3A2.5 2.5 0 0 1 17 5.5v.3A3 3 0 0 1 19.5 9a3 3 0 0 1-.6 1.8 3 3 0 0 1 1.1 2.7 3 3 0 0 1-2.4 3A2.5 2.5 0 0 1 15 19.5a2.5 2.5 0 0 1-3-.1',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5',
  plug: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4',
  paperclip: 'M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L10.2 17.7a1.7 1.7 0 0 1-2.4-2.4L15.5 7.6',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zM19 11a7 7 0 0 1-14 0M12 18v3',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z',
  stop: 'M8 8h8v8H8z',
  share: 'M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  copy: 'M9 9h12v12H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  retry: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4v16l13-8z',
  sidebar: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM9 4v16',
  menu: 'M4 7h16M4 12h16M4 17h16',
  image: 'M4 4h16v16H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  data: 'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  key: 'M15 7a4 4 0 1 1-3.9 4.9L3 20v1h3v-2h2v-2h2l1.1-1.1A4 4 0 0 1 15 7zM16 8h.01',
  store: 'M6 3h12v4H6zM5 8h14v13H5zM9 12h6',
  filter: 'M4 6h16M7 12h10M10 18h4',
  sort: 'M8 9l4-4 4 4M16 15l-4 4-4-4',
  upload: 'M12 16V8M8 12l4-4 4 4M4 20h16',
  video: 'M15 10l5-3v10l-5-3zM4 6h8v12H4z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  sparkles: 'M12 3l1.2 4.2L17 8l-3.8 1.2L12 14l-1.2-4.8L7 8l3.8-.8L12 3zM5 16l.8 2.8L8 20l-2.2.7L5 23l-.8-2.3L2 20l2.2-.5L5 16z',
  slash: 'M14.5 4 9 20M6 8h12'
};
export function Icon({ name, size = 18, className = '', ...rest }) {
  return <svg className={'icon ' + className} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" {...rest}><path d={P[name]} /></svg>;
}

/* ---------- avatar do agente (bot-avatars) ---------- */
// Sombreamento "plastic" é por pixel: só vale a pena em avatares grandes. Os pequenos usam "smooth".
export function AgentAvatar({ agent, size = 40, state, interactive = false, animate = false, paused, ...rest }) {
  if (!agent) return null;
  const st = state || (agent.status === 'paused' ? 'sleeping' : 'default');
  const still = paused ?? !(st === 'working' || animate);
  return (
    <span className="av-box" style={{ width: size, height: size }}>
      <BotAvatar type={agent.avatar?.type || 'circle'} color={agent.avatar?.color || undefined} face={agent.avatar?.face || 'eyes'}
        size={size} state={st} interactive={interactive && !still} paused={still} shading={size >= 56 ? 'plastic' : 'smooth'}
        aria-label={`${agent.name}${st === 'working' ? ', trabalhando' : st === 'sleeping' ? ', pausado' : ''}`} {...rest} />
    </span>
  );
}

/* ---------- abas com indicador líquido (liquid-gooey, efeito move) ---------- */
export function Segmented({ items, value, onChange, className = '', size = 'md', label }) {
  const ref = useRef(null);
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current?.querySelector(`[data-value="${CSS.escape(String(value))}"]`);
      if (el) setBox({ x: el.offsetLeft, w: el.offsetWidth, h: el.offsetHeight, y: el.offsetTop });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ref.current && ro.observe(ref.current);
    return () => ro.disconnect();
  }, [value, items.length]);
  const onKey = e => {
    const i = items.findIndex(([v]) => v === value);
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (n == null) return;
    e.preventDefault();
    const next = items[(n + items.length) % items.length][0];
    onChange(next);
    ref.current.querySelector(`[data-value="${CSS.escape(String(next))}"]`)?.focus();
  };
  return (
    <div className={`seg seg-${size} ${className}`} ref={ref} role="tablist" aria-label={label} onKeyDown={onKey}>
      {box && (
        <Liquid className="seg-liquid" fill="var(--seg-thumb)" shadow="0 1px 2px rgba(20,18,15,.10), 0 2px 8px rgba(20,18,15,.06)" blur={5} contrast={16}>
          <Liquid.Item effect="move" move={{ springiness: 0.55, trail: 0.45, wobble: 0.4 }}>
            <div className="seg-thumb" style={{ width: box.w, height: box.h, transform: `translate(${box.x}px, ${box.y}px)` }} />
          </Liquid.Item>
        </Liquid>
      )}
      {items.map(([v, l, count]) => (
        <button key={v} type="button" role="tab" data-value={v} aria-selected={v === value} tabIndex={v === value ? 0 : -1}
          className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {l}{count != null && <span className="seg-count">{count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- toasts ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setItems(xs => [...xs.slice(-2), { id, text, kind }]);
    setTimeout(() => setItems(xs => xs.filter(x => x.id !== id)), kind === 'error' ? 5200 : 2600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map(t => <div key={t.id} className={`toast toast-${t.kind}`}>{t.kind === 'error' && <Icon name="x" size={15} />}{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- diálogo nativo ---------- */
export function Dialog({ open, onClose, children, className = '', label }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={'dialog ' + className} aria-label={label} onClose={onClose}
      onClick={e => { if (e.target === ref.current) onClose(); }}>
      {open && children}
    </dialog>
  );
}

export function useConfirm() {
  const [state, setState] = useState(null);
  const confirm = (opts) => new Promise(resolve => setState({ ...opts, resolve }));
  const close = v => { state?.resolve(v); setState(null); };
  const node = (
    <Dialog open={!!state} onClose={() => close(false)} className="confirm" label={state?.title}>
      {state && <>
        <h2>{state.title}</h2>
        {state.body && <p>{state.body}</p>}
        <div className="row end">
          <button className="btn" onClick={() => close(false)}>Cancelar</button>
          <button className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)} autoFocus>{state.action || 'Confirmar'}</button>
        </div>
      </>}
    </Dialog>
  );
  return [confirm, node];
}

/* ---------- camada flutuante: menus e seleções saem da árvore (portal) e nunca ficam por baixo ---------- */
function useFloating(open, anchorRef, align) {
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      if (!a) return;
      const vw = innerWidth, vh = innerHeight, gap = 6;
      const below = vh - a.bottom, above = a.top;
      // Abre para cima quando pedido ou quando falta espaço embaixo.
      const up = align === 'up' ? above > 220 || above > below : below < 260 && above > below;
      const style = { position: 'fixed', zIndex: 1000, minWidth: Math.max(a.width, 200) };
      if (up) { style.bottom = vh - a.top + gap; style.maxHeight = above - gap - 12; }
      else { style.top = a.bottom + gap; style.maxHeight = below - gap - 12; }
      if (align === 'right') style.right = Math.max(8, vw - a.right);
      else style.left = Math.min(Math.max(8, a.left), vw - 8 - 220);
      setPos(style);
    };
    place();
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
    return () => { removeEventListener('resize', place); removeEventListener('scroll', place, true); };
  }, [open, align]);
  return pos;
}

function useDismiss(open, close, refs) {
  useEffect(() => {
    if (!open) return;
    const off = e => { if (!refs.some(r => r.current?.contains(e.target))) close(); };
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('pointerdown', off, true); document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', esc, true); };
  }, [open]);
}

export function Menu({ trigger, children, align = 'left', className = '' }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null), pop = useRef(null);
  const pos = useFloating(open, anchor, align);
  useDismiss(open, () => setOpen(false), [anchor, pop]);
  return (
    <div className={'menu-wrap ' + className} ref={anchor}>
      {trigger({ open, toggle: () => setOpen(o => !o) })}
      {open && pos && createPortal(
        <div ref={pop} className={`menu floating ${className}-pop`} style={pos} role="menu"
          onClick={e => e.target.closest('[role=menuitem]') && setOpen(false)}>{children}</div>,
        document.body)}
    </div>
  );
}
export const MenuItem = ({ icon, children, danger, ...rest }) => (
  <button type="button" role="menuitem" className={'menu-item' + (danger ? ' danger' : '')} {...rest}>{icon && <Icon name={icon} size={16} />}{children}</button>
);

/**
 * Seleção no padrão do Ripper (substitui o <select> do navegador).
 * options: [{ value, label, hint?, icon?, node? }]
 */
export function Select({ value, onChange, options, label, placeholder = 'Selecione', className = '', size = 'md' }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const anchor = useRef(null), pop = useRef(null);
  const pos = useFloating(open, anchor, 'left');
  useDismiss(open, () => setOpen(false), [anchor, pop]);
  const current = options.find(o => o.value === value);
  useEffect(() => { if (open) setActive(Math.max(0, options.findIndex(o => o.value === value))); }, [open]);
  useEffect(() => { pop.current?.querySelector('.on-active')?.scrollIntoView({ block: 'nearest' }); }, [active, open]);
  const choose = o => { onChange(o.value); setOpen(false); anchor.current?.querySelector('button')?.focus(); };
  const onKey = e => {
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); setOpen(true); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, options.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(options[active]); }
    if (e.key === 'Tab') setOpen(false);
  };
  return (
    <div className={`select-wrap ${className}`} ref={anchor}>
      <button type="button" className={`select-btn select-${size}`} aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        onClick={() => setOpen(o => !o)} onKeyDown={onKey}>
        {current?.icon}{current?.node || <span className={current ? '' : 'muted'}>{current?.label || placeholder}</span>}
        <Icon name="down" size={15} className={`select-caret ${open ? 'up' : ''}`} />
      </button>
      {open && pos && createPortal(
        <div ref={pop} className="menu floating select-pop" style={pos} role="listbox" aria-label={label}>
          {options.map((o, i) => (
            <button key={String(o.value)} type="button" role="option" aria-selected={o.value === value}
              className={`menu-item select-item ${o.value === value ? 'on' : ''} ${i === active ? 'on-active' : ''}`}
              onMouseEnter={() => setActive(i)} onClick={() => choose(o)}>
              {o.icon}<span className="select-text"><b>{o.node || o.label}</b>{o.hint && <small>{o.hint}</small>}</span>
              {o.value === value && <Icon name="check" size={15} />}
            </button>
          ))}
        </div>,
        document.body)}
    </div>
  );
}

export const Switch = ({ checked, onChange, label, ...rest }) => (
  <input type="checkbox" role="switch" className="switch" checked={!!checked} aria-label={label} onChange={e => onChange(e.target.checked)} {...rest} />
);

export const StatusDot = ({ status }) => (
  <span className={`status status-${status}`}><i />{status === 'paused' ? 'Pausado' : 'Online'}</span>
);

export function EmptyState({ title, body, action }) {
  return <div className="empty"><p className="empty-title">{title}</p>{body && <p className="empty-body">{body}</p>}{action}</div>;
}
