import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app.jsx';
import { go, useRoute, api } from '../lib.js';
import { Icon, Menu, MenuItem } from '../ui.jsx';
import HubShell from '../marketplace/HubShell.jsx';
import BrandIcon from '../marketplace/BrandIcon.jsx';
import CustomConnectorModal from '../marketplace/CustomConnectorModal.jsx';
import { listMyConnectors, uninstallPlugin } from '../marketplace/state.js';
import { useClaudeConnectors } from './Marketplace.jsx';
import { CLAUDE_CONNECTORS_URL } from '../marketplace/catalog.js';
import { useOv } from '../overlay.jsx';
import { authStatusLabel, refreshMcpOAuth, runMcpOAuthLogin } from '../marketplace/mcpOAuth.js';
import SocialWebhooksPanel from '../marketplace/SocialWebhooksPanel.jsx';
import { isEnterpriseMode } from '../uiMode.js';

function RowIcon({ id }) {
  const stroke = { plug: 'plug', terminal: 'terminal', bulb: 'bulb', cube: 'cube' };
  if (stroke[id]) return <span className="mp-icon line"><Icon name={stroke[id]} size={18} /></span>;
  return <BrandIcon id={id} size={32} />;
}

function Mine({ settings, authByName, onRefresh, busyAuth, refresh, claudeList, q }) {
  const ov = useOv();
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return listMyConnectors(settings, claudeList).filter(r => !t || r.name.toLowerCase().includes(t));
  }, [settings, q, claudeList]);

  async function remove(pluginName, label) {
    if (!(await ov.confirm({ title: `Remover ${label}?`, body: 'Os agentes deixam de usar este conector. O acesso salvo é apagado.', action: 'Remover', danger: true }))) return;
    await api('/api/settings', { method: 'PUT', body: { plugins: uninstallPlugin(pluginName, settings) } });
    await refresh();
  }

  async function reauth(pluginName) {
    const plugin = settings.plugins?.find(p => p.name === pluginName);
    if (!plugin?.url) return;
    await runMcpOAuthLogin({ pluginName, url: plugin.url });
    await refresh();
  }

  if (!rows.length) return (
    <div className="mp-conn-empty">
      <p><b>Nenhum conector ainda.</b> Conecte Notion, Linear, GitHub e outros pelo Marketplace, ou Google Agenda, Gmail e Drive pela sua conta claude.ai.</p>
      <div className="row"><button type="button" className="btn btn-primary btn-sm" onClick={() => go('/marketplace/discover')}>Abrir Marketplace</button><a className="btn btn-sm" href={CLAUDE_CONNECTORS_URL} target="_blank" rel="noopener">Conectores do claude.ai</a></div>
    </div>
  );
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
              {r.status === 'session' ? <span className="muted small">Conectando…</span> : r.status === 'ok' ? <Icon name="check" size={18} /> : null}
              {pluginName && <button type="button" className="icon-btn" title="Remover" aria-label={`Remover ${r.name}`} onClick={() => remove(pluginName, r.name)}><Icon name="trash" size={15} /></button>}
            </div>
          </div>
        );})}
      </div>
    </>
  );
}

export default function Connectors() {
  const { S, refresh, toast } = useApp();
  const { parts } = useRoute();
  const tab = parts[1] === 'discover' ? 'discover' : 'mine';
  const [q, setQ] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [authByName, setAuthByName] = useState({});
  const [busyAuth, setBusyAuth] = useState(null);
  const claudeList = useClaudeConnectors();
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
      toast(e.message, 'error');
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
        <Mine settings={S.settings} authByName={authByName} onRefresh={refreshOAuth} busyAuth={busyAuth} refresh={refresh} claudeList={claudeList} q={q} />
        {isEnterpriseMode(S.settings) && S.settings.flags?.socialWebhooks && <SocialWebhooksPanel />}
      </HubShell>
      <CustomConnectorModal open={customOpen} onClose={() => setCustomOpen(false)} onSaved={refresh} />
    </>
  );
}
