import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app.jsx';
import { go, useRoute } from '../lib.js';
import { Icon, Menu, MenuItem } from '../ui.jsx';
import HubShell from '../marketplace/HubShell.jsx';
import BrandIcon from '../marketplace/BrandIcon.jsx';
import CustomConnectorModal from '../marketplace/CustomConnectorModal.jsx';
import { listMyConnectors } from '../marketplace/state.js';

function RowIcon({ id }) {
  const stroke = { plug: 'plug', terminal: 'terminal', bulb: 'bulb', cube: 'cube' };
  if (stroke[id]) return <span className="mp-icon line"><Icon name={stroke[id]} size={18} /></span>;
  return <BrandIcon id={id} size={32} />;
}

function Mine({ settings }) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return listMyConnectors(settings).filter(r => !t || r.name.toLowerCase().includes(t));
  }, [settings, q]);

  return (
    <>
      <div className="mp-conn-table">
        <div className="mp-conn-head"><span>Conector</span><span>Tipo</span><span /></div>
        {rows.map(r => (
          <div key={r.id} className="mp-conn-row">
            <div className="mp-conn-name">
              <RowIcon id={r.icon} />
              <span><b>{r.name}</b>{r.hint && <small>{r.hint}</small>}</span>
            </div>
            <div className="mp-conn-type">
              <span>{r.type}</span>
              {r.badge && <span className="tag">{r.badge}</span>}
            </div>
            <div className="mp-conn-status">
              {r.status === 'session' ? <span className="muted small">Conecta em sessões</span> : r.status === 'ok' ? <Icon name="check" size={18} /> : null}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export default function Connectors() {
  const { S, refresh } = useApp();
  const { parts } = useRoute();
  const tab = parts[1] === 'discover' ? 'discover' : 'mine';
  const [q, setQ] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  useEffect(() => { if (tab === 'discover') go('/marketplace/discover'); }, [tab]);
  if (tab === 'discover') return null;

  return (
    <>
      <HubShell
        title="Conectores"
        tabs={[['mine', 'Meus'], ['discover', 'Descobrir']]}
        tab={tab}
        onTab={k => { if (k === 'discover') go('/marketplace/discover'); else go('/connectors'); }}
        search={q}
        onSearch={setQ}
        searchPlaceholder="Pesquisar conectores"
        actions={
          <Menu align="right" trigger={({ toggle }) => (
            <button type="button" className="btn btn-primary btn-sm" onClick={toggle}><Icon name="plus" size={14} /> Adicionar <Icon name="down" size={14} /></button>
          )}>
            <MenuItem icon="plug" onClick={() => setCustomOpen(true)}>Adicionar conector personalizado</MenuItem>
            <MenuItem icon="store" onClick={() => go('/marketplace/discover')}>Descobrir no Marketplace</MenuItem>
          </Menu>
        }
      >
        <Mine settings={S.settings} />
      </HubShell>
      <CustomConnectorModal open={customOpen} onClose={() => setCustomOpen(false)} onSaved={refresh} />
    </>
  );
}
