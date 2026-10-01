import { useMemo, useState } from 'react';
import { useApp } from '../app.jsx';
import { api, go, useRoute } from '../lib.js';
import { Icon } from '../ui.jsx';
import HubShell from '../marketplace/HubShell.jsx';
import BrandIcon from '../marketplace/BrandIcon.jsx';
import ConnectorDetail from '../marketplace/ConnectorDetail.jsx';
import { AGENT_PRESETS, BOT_CATALOG, CONNECTOR_DISCOVER, PLUGIN_CATALOG, marketplaceDetail } from '../marketplace/catalog.js';
import { installPlugin, installedCount, isAuthed, isPluginInstalled, listInstalledPlugins, setAuthed, uninstallPlugin } from '../marketplace/state.js';
import { isEnterpriseMode } from '../uiMode.js';

function MpIcon({ id, size = 40 }) {
  if (id === 'plug') return <span className="mp-icon"><Icon name="plug" size={size * 0.45} /></span>;
  return <BrandIcon id={id} size={size} />;
}

function PluginRow({ item, settings, onChange, onOpen }) {
  const installed = isPluginInstalled(item.id, settings);
  const needsAuth = item.needsAuth && installed && !isAuthed(item.id);
  return (
    <div className="mp-row">
      <MpIcon id={item.icon} />
      <div className="mp-row-text">
        <b>{item.name}</b>
        <small>{item.connectors ? `${item.connectors} conector${item.connectors > 1 ? 'es' : ''}` : ''}{item.skills ? `${item.connectors ? ' e ' : ''}${item.skills} habilidade${item.skills > 1 ? 's' : ''}` : ''}{!item.connectors && !item.skills ? item.desc : ''}</small>
        {(item.connectors || item.skills) && <small className="mp-desc">{item.desc}</small>}
      </div>
      {needsAuth ? (
        <button type="button" className="btn btn-sm" onClick={() => { setAuthed(item.id, true); onChange(); }}>Autenticar</button>
      ) : installed ? (
        <span className="mp-status ok">Conectado</span>
      ) : (
        <button type="button" className="btn btn-sm" onClick={() => onOpen(item.id)}>Adicionar</button>
      )}
    </div>
  );
}

function Browse({ settings, refresh, onOpenDetail }) {
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const filter = x => !t || (x.name + x.desc + (x.author || '')).toLowerCase().includes(t);
  const forYou = PLUGIN_CATALOG.filter(p => p.forYou).filter(filter);
  const featured = PLUGIN_CATALOG.filter(p => p.featured).filter(filter);
  const bots = BOT_CATALOG.filter(filter);
  const presets = AGENT_PRESETS.filter(filter);
  const count = installedCount(settings);
  const enterprise = isEnterpriseMode(settings);

  return (
    <HubShell
      title="Marketplace"
      search={q}
      onSearch={setQ}
      searchPlaceholder="Buscar plugins e Bots"
      actions={
        <button type="button" className="mp-installed" onClick={() => go('/marketplace/manage')}>
          <span className="mp-installed-icons">
            {listInstalledPlugins(settings).slice(0, 4).map(p => <MpIcon key={p.id} id={p.icon} size={22} />)}
          </span>
          Instalados: {count} <Icon name="arrowR" size={14} />
        </button>
      }
    >
      {enterprise && presets.length > 0 && (
        <section className="mp-section">
          <div className="mp-section-head"><h2>Enterprise hub</h2><span className="muted small">Templates advisory · Hub Architect</span></div>
          <div className="mp-grid two">{presets.map(p => (
            <div key={p.id} className="mp-card bot">
              <span className="mp-bot" style={{ background: p.color }} aria-hidden="true" />
              <div><b>{p.name}</b><small>{p.desc}</small><em>por {p.author}</em></div>
              <button type="button" className="btn btn-sm" onClick={() => go(`/new?template=${p.templateId}`)}>Usar template</button>
            </div>
          ))}</div>
        </section>
      )}
      {forYou.length > 0 && (
        <section className="mp-section">
          <h2>Para você</h2>
          <div className="mp-grid two">{forYou.map(p => (
            <div key={p.id} className="mp-card">
              <MpIcon id={p.icon} />
              <div><b>{p.name}</b><small>{p.desc}</small></div>
              <button type="button" className="btn btn-sm" onClick={() => onOpenDetail(p.id)} disabled={isPluginInstalled(p.id, settings)}>{isPluginInstalled(p.id, settings) ? 'Instalado' : 'Adicionar'}</button>
            </div>
          ))}</div>
        </section>
      )}
      {featured.length > 0 && (
        <section className="mp-section">
          <div className="mp-section-head"><h2>Plugins em destaque</h2><button type="button" className="link-btn" onClick={() => go('/marketplace/discover')}>Ver tudo</button></div>
          <div className="mp-grid two">{featured.map(p => (
            <div key={p.id} className="mp-card">
              <MpIcon id={p.icon} />
              <div><b>{p.name}</b><small>{p.desc}</small></div>
              <button type="button" className="btn btn-sm" onClick={() => onOpenDetail(p.id)} disabled={isPluginInstalled(p.id, settings)}>{isPluginInstalled(p.id, settings) ? 'Instalado' : 'Adicionar'}</button>
            </div>
          ))}</div>
        </section>
      )}
      {bots.length > 0 && (
        <section className="mp-section">
          <h2>Bots em destaque</h2>
          <div className="mp-grid two">{bots.map(b => (
            <div key={b.id} className="mp-card bot">
              <span className="mp-bot" style={{ background: b.color }} aria-hidden="true" />
              <div><b>{b.name}</b><small>{b.desc}</small><em>por {b.author}</em></div>
              <button type="button" className="btn btn-sm">Adicionar</button>
            </div>
          ))}</div>
        </section>
      )}
    </HubShell>
  );
}

function Manage({ settings, refresh, onOpenDetail }) {
  const installed = listInstalledPlugins(settings);
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? installed : installed.slice(0, 6);

  async function toggle(id, remove) {
    const plugins = remove ? uninstallPlugin(id, settings) : installPlugin(id, settings);
    await api('/api/settings', { method: 'PUT', body: { ...settings, plugins } });
    await refresh();
  }

  return (
    <HubShell
      title="Gerenciar plugins e habilidades"
      actions={<button type="button" className="link-btn muted" onClick={() => go('/marketplace')}><Icon name="arrowL" size={14} /> Marketplace</button>}
    >
      <section className="mp-section">
        <h2 className="mp-sub">Instalado</h2>
        <div className="mp-grid two manage">{visible.map(p => (
          <PluginRow key={p.id} item={p} settings={settings} onChange={id => (id ? toggle(id, false) : refresh())} onOpen={onOpenDetail} />
        ))}</div>
        {installed.length > 6 && !showAll && (
          <button type="button" className="link-btn mp-show-all" onClick={() => setShowAll(true)}>Mostrar todos os {installed.length} plugins</button>
        )}
      </section>
      <section className="mp-section">
        <h2>Habilidades privadas</h2>
        <p className="muted">Nenhuma habilidade privada ainda. Peça ao seu Bot para criar uma para você.</p>
      </section>
    </HubShell>
  );
}

function Discover({ settings, refresh, onOpenDetail }) {
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const list = useMemo(() => CONNECTOR_DISCOVER.filter(c => !t || (c.name + c.desc + c.author).toLowerCase().includes(t)), [t]);
  const trending = list.slice(0, 4);

  return (
    <HubShell
      title="Marketplace"
      search={q}
      onSearch={setQ}
      searchPlaceholder="Buscar plugins e Bots"
      actions={<button type="button" className="link-btn" onClick={() => go('/marketplace')}><Icon name="arrowL" size={14} /> Voltar</button>}
    >
      <section className="mp-section">
        <div className="mp-section-head">
          <h2>Conectores mais usados <span className="tag">{list.length}</span></h2>
        </div>
        <div className="mp-discover-grid">{list.map(c => (
          <article key={c.id} className="mp-discover-card">
            <button type="button" className="mp-plus" aria-label={`Ver ${c.name}`} onClick={() => onOpenDetail(c.id)}><Icon name="plus" size={16} /></button>
            <button type="button" className="mp-discover-hit" onClick={() => onOpenDetail(c.id)}>
              <MpIcon id={c.icon} size={36} />
              <h3>{c.name}{c.verified && <Icon name="check" size={12} className="mp-verified" />}</h3>
              <p>{c.desc}</p>
              <small>por {c.author}</small>
            </button>
          </article>
        ))}</div>
      </section>
      {trending.length > 0 && (
        <section className="mp-section">
          <div className="mp-section-head"><h2>Conectores em alta <span className="tag">{trending.length}</span></h2></div>
          <div className="mp-discover-grid">{trending.map(c => (
            <article key={`t-${c.id}`} className="mp-discover-card">
              <button type="button" className="mp-plus" onClick={() => onOpenDetail(c.id)}><Icon name="plus" size={16} /></button>
              <MpIcon id={c.icon} size={36} />
              <h3>{c.name}</h3>
              <p>{c.desc}</p>
              <small>por {c.author}</small>
            </article>
          ))}</div>
        </section>
      )}
    </HubShell>
  );
}

export default function Marketplace() {
  const { S, refresh } = useApp();
  const { parts } = useRoute();
  const view = parts[1] || 'browse';
  const settings = S.settings;
  const [detailId, setDetailId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const detail = detailId ? marketplaceDetail(detailId) : null;

  async function confirmInstall() {
    if (!detail) return;
    setConnecting(true);
    try {
      const installId = detail.installId || detail.id;
      let plugins = installPlugin(installId, settings);
      if (detail.mcp && !plugins.some(p => p.name === detail.mcp.name)) {
        plugins = [...plugins, { ...detail.mcp, enabled: true }];
      }
      await api('/api/settings', { method: 'PUT', body: { ...settings, plugins } });
      await refresh();
      setDetailId(null);
    } finally {
      setConnecting(false);
    }
  }

  if (detail) {
    return (
      <div className="mp-page">
        <ConnectorDetail item={detail} onBack={() => setDetailId(null)} onConnect={confirmInstall} connecting={connecting} />
      </div>
    );
  }

  if (view === 'manage') return <Manage settings={settings} refresh={refresh} onOpenDetail={setDetailId} />;
  if (view === 'discover') return <Discover settings={settings} refresh={refresh} onOpenDetail={setDetailId} />;
  return <Browse settings={settings} refresh={refresh} onOpenDetail={setDetailId} />;
}
