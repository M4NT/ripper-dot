import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, Dialog } from './ui.jsx';

/*
 * Camada de sobreposição global:
 *  - menu de botão direito próprio (substitui o do navegador nos componentes do Ripper)
 *  - diálogos de confirmação e de texto (renomear etc.), chamados de qualquer lugar
 */
const Ctx = createContext(null);
export const useOverlay = () => useContext(Ctx);

function ContextMenu({ menu, close }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y, opacity: 0 });
  const [active, setActive] = useState(-1);
  const items = menu.items.filter(Boolean);
  const actionable = items.map((it, i) => (it.sep || it.disabled ? -1 : i)).filter(i => i >= 0);
  // Mantém o menu dentro da tela.
  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.min(menu.x, innerWidth - r.width - 8), top: menu.y + r.height > innerHeight - 8 ? Math.max(8, menu.y - r.height) : menu.y, opacity: 1 });
    ref.current.focus();
  }, [menu]);
  useEffect(() => {
    const off = e => { if (!ref.current?.contains(e.target)) close(); };
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const at = actionable.indexOf(active);
        const n = e.key === 'ArrowDown' ? actionable[(at + 1) % actionable.length] : actionable[(at - 1 + actionable.length) % actionable.length];
        setActive(n);
      }
      if (e.key === 'Enter' && active >= 0) { e.preventDefault(); run(items[active]); }
    };
    document.addEventListener('pointerdown', off, true);
    document.addEventListener('keydown', key, true);
    addEventListener('blur', close); addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', key, true);
      removeEventListener('blur', close); removeEventListener('resize', close); document.removeEventListener('scroll', close, true);
    };
  }, [active, menu]);
  const run = it => { close(); it.onSelect?.(); };
  return createPortal(
    <div ref={ref} className="menu floating ctx-menu" role="menu" tabIndex={-1} style={{ position: 'fixed', zIndex: 2000, ...pos }}
      onContextMenu={e => e.preventDefault()}>
      {menu.title && <p className="ctx-title">{menu.title}</p>}
      {items.map((it, i) => it.sep ? <hr key={i} className="menu-sep" /> : (
        <button key={i} type="button" role="menuitem" disabled={it.disabled}
          className={`menu-item ${it.danger ? 'danger' : ''} ${i === active ? 'on-active' : ''}`}
          onMouseEnter={() => setActive(i)} onClick={() => run(it)}>
          {it.icon && <Icon name={it.icon} size={16} />}<span>{it.label}</span>{it.hint && <kbd className="menu-kbd">{it.hint}</kbd>}
        </button>
      ))}
    </div>, document.body);
}

function Ask({ ask, done }) {
  const [v, setV] = useState(ask.value || '');
  return (
    <Dialog open onClose={() => done(null)} className="confirm" label={ask.title}>
      <form onSubmit={e => { e.preventDefault(); if (v.trim()) done(v.trim()); }}>
        <h2>{ask.title}</h2>
        {ask.body && <p>{ask.body}</p>}
        {ask.multiline
          ? <textarea className="input ask-input" rows={ask.rows || 6} autoFocus value={v} onChange={e => setV(e.target.value)} placeholder={ask.placeholder} />
          : <input className="input ask-input" autoFocus value={v} onChange={e => setV(e.target.value)} placeholder={ask.placeholder} onFocus={e => e.target.select()} />}
        <div className="row end"><button type="button" className="btn" onClick={() => done(null)}>Cancelar</button><button className="btn btn-primary" disabled={!v.trim()}>{ask.action || 'Salvar'}</button></div>
      </form>
    </Dialog>
  );
}

function Confirm({ c, done }) {
  return (
    <Dialog open onClose={() => done(false)} className="confirm" label={c.title}>
      <h2>{c.title}</h2>
      {c.body && <p>{c.body}</p>}
      <div className="row end">
        <button className="btn" onClick={() => done(false)}>Cancelar</button>
        <button className={`btn ${c.danger ? 'btn-danger' : 'btn-primary'}`} autoFocus onClick={() => done(true)}>{c.action || 'Confirmar'}</button>
      </div>
    </Dialog>
  );
}

export function OverlayProvider({ children }) {
  const [menu, setMenu] = useState(null);
  const [ask, setAsk] = useState(null);
  const [confirmState, setConfirm] = useState(null);
  const [custom, setCustom] = useState(null);
  const api = useRef(null);
  api.current = {
    /** Abre o menu próprio no ponto do clique. items: [{ label, icon, onSelect, danger, hint, disabled } | { sep: true }] */
    menu: (e, items, title) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, items, title }); },
    ask: opts => new Promise(resolve => setAsk({ ...opts, resolve })),
    confirm: opts => new Promise(resolve => setConfirm({ ...opts, resolve })),
    /** Mostra um nó qualquer por cima (ex.: visualizador de artefato); devolve a função de fechar. */
    show: render => { const close = () => setCustom(null); setCustom({ render, close }); return close; }
  };
  const value = useCallback(() => api.current, []);
  return (
    <Ctx.Provider value={value}>
      {children}
      {menu && <ContextMenu menu={menu} close={() => setMenu(null)} />}
      {ask && <Ask ask={ask} done={v => { ask.resolve(v); setAsk(null); }} />}
      {confirmState && <Confirm c={confirmState} done={v => { confirmState.resolve(v); setConfirm(null); }} />}
      {custom && custom.render(custom.close)}
    </Ctx.Provider>
  );
}

/** Atalho: const ov = useOv(); onContextMenu={e => ov.menu(e, [...])} */
export const useOv = () => useOverlay()();
