import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { go } from './lib.js';
import { Icon, Switch } from './ui.jsx';
import { useApp } from './app.jsx';
import { api } from './lib.js';
import { listSessionConnectors, setSessionEnabled } from './marketplace/sessionMcp.js';
import { isEnterpriseMode } from './uiMode.js';
import { useT } from './i18n/index.jsx';

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
      const estH = 320;
      const openUp = r.bottom + estH > innerHeight - 12;
      setPos(openUp
        ? { position: 'fixed', left: r.right + 4, bottom: innerHeight - r.top + 4, zIndex: 1001, minWidth: 260, maxHeight: 'min(420px, 60vh)', overflowY: 'auto' }
        : { position: 'fixed', left: r.right + 4, top: r.top, zIndex: 1001, minWidth: 260, maxHeight: 'min(420px, 60vh)', overflowY: 'auto' });
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

export default function ComposerPlusMenu({ open, onClose, anchorRef, onFiles, onFolder, onSlash, onTeach, onCredential }) {
  const { S, refresh } = useApp();
  const t = useT();
  const simple = !isEnterpriseMode(S.settings);
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
      await api('/api/settings', { method: 'PUT', body: { plugins } });
      await refresh();
    }
    setSessionEnabled(row.id, enabled);
    bump(n => n + 1);
  }

  const connectors = listSessionConnectors(S.settings);
  const pluginRows = connectors.filter(r => r.kind === 'plugin');
  const connectorRows = connectors.filter(r => r.kind === 'connector');

  function submenuItems(rows) {
    return <>
      <button type="button" className="menu-item" onClick={() => { onClose(); go('/marketplace'); }}>
        <Icon name="compass" size={16} />Conectar aplicativos
      </button>
      {isEnterpriseMode(S.settings) && S.settings.flags?.socialWebhooks && (
        <button type="button" className="menu-item" onClick={() => { onClose(); go('/marketplace?tab=webhooks'); }}>
          <Icon name="share" size={16} />Webhooks sociais
        </button>
      )}
      <hr className="menu-sep" />
      {rows.length === 0 && <p className="muted small pad">Nenhum ativo. Conecte em Conectar aplicativos.</p>}
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
      {onCredential && (
        <button type="button" className="menu-item" onClick={() => { onClose(); onCredential(); }}>
          <Icon name="plug" size={16} />Credencial segura (cofre)
        </button>
      )}
      {simple && (
        <button type="button" className="menu-item" onClick={() => { onClose(); go('/new?template=architect'); }}>
          <Icon name="agents" size={16} />{t('composer.architect')}
        </button>
      )}
      <hr className="menu-sep" />
      <button type="button" className="menu-item" onMouseEnter={e => setSub({ type: 'apps', el: e.currentTarget })} onClick={e => setSub({ type: 'apps', el: e.currentTarget })}>
        <Icon name="grid" size={16} />Aplicativos<Icon name="arrowR" size={14} className="menu-chevron" />
      </button>
      {sub?.type === 'apps' && <SubMenu anchor={sub.el} onClose={() => setSub(null)} items={submenuItems([...connectorRows, ...pluginRows])} />}
    </div>,
    document.body
  );
}
