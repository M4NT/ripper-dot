import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app.jsx';
import { go, useRoute, api } from '../lib.js';
import { Icon, Menu, MenuItem } from '../ui.jsx';
import HubShell from '../marketplace/HubShell.jsx';
import BrandIcon from '../marketplace/BrandIcon.jsx';
import CustomConnectorModal from '../marketplace/CustomConnectorModal.jsx';
import { listMyConnectors } from '../marketplace/state.js';
import { authStatusLabel, refreshMcpOAuth, runMcpOAuthLogin } from '../marketplace/mcpOAuth.js';

function RowIcon({ id }) {
  const stroke = { plug: 'plug', terminal: 'terminal', bulb: 'bulb', cube: 'cube' };
  if (stroke[id]) return <span className="mp-icon line"><Icon name={stroke[id]} size={18} /></span>;
  return <BrandIcon id={id} size={32} />;
}

function Mine({ settings, authByName, onRefresh, busyAuth, refresh }) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return listMyConnectors(settings).filter(r => !t || r.name.toLowerCase().includes(t));
  }, [settings, q]);

  async function reauth(pluginName) {
    const plugin = settings.plugins?.find(p => p.name === pluginName);
    if (!plugin?.url) return;
    await runMcpOAuthLogin({ pluginName, url: plugin.url });
    await refresh();
  }

  return (
    <>
      <div className="mp-conn-table">
        <div className="mp-conn-head"><span>Conector</span><span>Tipo</span><span /></div>
        {rows.map(r => {
          const pluginName = r.id?.startsWith('plugin-') ? r.id.slice('plugin-'.length) : null;
          const auth = pluginName ? authByName[pluginName] : null;
          const label = authStatusLabel(auth);
          return (
          <div key={r.id} className="mp-conn-row">
            <div className="mp-conn-name">
              <RowIcon id={r.icon} />
              <span><b>{r.name}</b>{r.hint && <small>{r.hint}</small>}{label && <small className="form-error">{label}{auth?.reason ? ` — ${auth.reason}` : ''}</small>}</span>
            </div>
            <div className="mp-conn-type">
              <span>{r.type}</span>
              {r.badge && <span className="tag">{r.badge}</span>}
            </div>
            <div className="mp-conn-status">
              {pluginName && auth && ['needs_auth', 'expired', 'expired_refreshable'].includes(auth.state) && (
                <button type="button" className="btn btn-sm" disabled={busyAuth === pluginName} onClick={() => (auth.state === 'expired_refreshable' ? onRefresh(pluginName) : reauth(pluginName))}>
                  {auth.state === 'expired_refreshable' ? 'Atualizar token' : 'Entrar'}
                </button>
              )}
              {r.status === 'session' ? <span className="muted small">Conecta em sessões</span> : r.status === 'ok' ? <Icon name="check" size={18} /> : null}
            </div>
          </div>
        );})}
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
  const [authByName, setAuthByName] = useState({});
  const [busyAuth, setBusyAuth] = useState(null);
  useEffect(() => { if (tab === 'discover') go('/marketplace/discover'); }, [tab]);
  useEffect(() => {
    api('/api/mcp/connectors').then(r => {
      const map = {};
      for (const c of r.connectors || []) map[c.name] = c.authStatus;
      setAuthByName(map);
    }).catch(() => {});
  }, [S.settings.plugins]);

  async function refreshOAuth(name) {
    setBusyAuth(name);
    try {
      await refreshMcpOAuth(name);
      await refresh();
      const r = await api('/api/mcp/connectors');
      const map = {};
      for (const c of r.connectors || []) map[c.name] = c.authStatus;
      setAuthByName(map);
    } catch (e) {
      alert(e.message);
    }
    setBusyAuth(null);
  }
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
        <Mine settings={S.settings} authByName={authByName} onRefresh={refreshOAuth} busyAuth={busyAuth} refresh={refresh} />
      </HubShell>
      <CustomConnectorModal open={customOpen} onClose={() => setCustomOpen(false)} onSaved={refresh} />
    </>
  );
}
