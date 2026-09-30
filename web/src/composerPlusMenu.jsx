import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { go } from './lib.js';
import { Icon, Switch } from './ui.jsx';
import { useApp } from './app.jsx';
import { api } from './lib.js';
import { listSessionConnectors, setSessionEnabled } from './marketplace/sessionMcp.js';

function useFloating(anchorRef, open) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      if (!a) return;
      setPos({ position: 'fixed', left: a.left, bottom: innerHeight - a.top + 8, zIndex: 1000, minWidth: 280 });
    };
    place();
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
    return () => { removeEventListener('resize', place); removeEventListener('scroll', place, true); };
  }, [open]);
  return pos;
}

function SubMenu({ items, anchor, onClose }) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const place = () => {
      const r = anchor?.getBoundingClientRect();
      if (!r) return;
      setPos({ position: 'fixed', left: r.right + 4, top: r.top, zIndex: 1001, minWidth: 260 });
    };
    place();
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, [anchor]);
  if (!pos) return null;
  return createPortal(
    <div className="menu floating composer-sub" style={pos} onMouseLeave={onClose}>{items}</div>,
    document.body
  );
}

export default function ComposerPlusMenu({ open, onClose, anchorRef, onFiles, onFolder, onSlash, onTeach }) {
  const { S, refresh } = useApp();
  const pos = useFloating(anchorRef, open);
  const [sub, setSub] = useState(null);
  const [, bump] = useState(0);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return;
    const off = e => { if (!wrap.current?.contains(e.target) && !e.target.closest('.composer-sub')) onClose(); };
    const esc = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', off, true);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', esc, true); };
  }, [open, onClose]);

  async function toggleRow(row, enabled) {
    if (row.kind === 'plugin' && enabled) {
      const plugins = S.settings.plugins.map(p => p.name === row.id ? { ...p, enabled: true } : p);
      await api('/api/settings', { method: 'PUT', body: { ...S.settings, plugins } });
      await refresh();
    }
    setSessionEnabled(row.id, enabled);
    bump(n => n + 1);
  }

  const connectors = listSessionConnectors(S.settings);
  const pluginRows = connectors.filter(r => r.kind === 'plugin');
  const connectorRows = connectors.filter(r => r.kind === 'connector');

  function submenuItems(rows, type) {
    return <>
      <button type="button" className="menu-item" onClick={() => { onClose(); go('/marketplace/discover'); }}>
        <Icon name="compass" size={16} />Explorar {type === 'plugin' ? 'plugins' : 'conectores'}
      </button>
      <button type="button" className="menu-item" onClick={() => { onClose(); go(type === 'plugin' ? '/marketplace/manage' : '/connectors'); }}>
        <Icon name="folder" size={16} />Gerenciar {type === 'plugin' ? 'plugins' : 'conectores'}
      </button>
      <hr className="menu-sep" />
      {rows.length === 0 && <p className="muted small pad">Nenhum ativo. Instale no Marketplace.</p>}
      {rows.map(r => (
        <div key={r.id} className="menu-item composer-toggle-row" role="menuitem">
          <Icon name="grid" size={16} /><span className="grow">{r.label}</span>
          <Switch checked={r.enabled} onChange={v => toggleRow(r, v)} label={r.label} />
        </div>
      ))}
    </>;
  }

  if (!open || !pos) return null;

  return createPortal(
    <div ref={wrap} className="menu floating composer-plus" style={pos}>
      <button type="button" className="menu-item" onClick={() => { onClose(); onFiles(); }}>
        <Icon name="paperclip" size={16} />Adicionar arquivos ou fotos<kbd className="menu-kbd">Ctrl U</kbd>
      </button>
      <button type="button" className="menu-item" onClick={() => { onClose(); onFolder(); }}>
        <Icon name="folder" size={16} />Adicionar pasta
      </button>
      <button type="button" className="menu-item" onClick={() => { onClose(); onSlash(); }}>
        <Icon name="slash" size={16} />Comandos de barra
      </button>
      <button type="button" className="menu-item" onClick={() => { onClose(); onTeach(); }}>
        <Icon name="bolt" size={16} />Ensinar uma tarefa
      </button>
      <hr className="menu-sep" />
      <button type="button" className="menu-item" onMouseEnter={e => setSub({ type: 'connectors', el: e.currentTarget })} onClick={e => setSub({ type: 'connectors', el: e.currentTarget })}>
        <Icon name="grid" size={16} />Conectores<Icon name="arrowR" size={14} className="menu-chevron" />
      </button>
      <button type="button" className="menu-item" onMouseEnter={e => setSub({ type: 'plugins', el: e.currentTarget })} onClick={e => setSub({ type: 'plugins', el: e.currentTarget })}>
        <Icon name="sparkles" size={16} />Plugins<Icon name="arrowR" size={14} className="menu-chevron" />
      </button>
      {sub?.type === 'connectors' && <SubMenu anchor={sub.el} onClose={() => setSub(null)} items={submenuItems(connectorRows, 'connector')} />}
      {sub?.type === 'plugins' && <SubMenu anchor={sub.el} onClose={() => setSub(null)} items={submenuItems(pluginRows, 'plugin')} />}
    </div>,
    document.body
  );
}
