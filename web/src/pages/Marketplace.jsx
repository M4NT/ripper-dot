import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app.jsx';
import { api, go, useRoute } from '../lib.js';
import { Icon } from '../ui.jsx';
import HubShell from '../marketplace/HubShell.jsx';
import BrandIcon from '../marketplace/BrandIcon.jsx';
import ConnectorDetail from '../marketplace/ConnectorDetail.jsx';
import { CONNECTOR_DISCOVER, PLUGIN_CATALOG, CLAUDE_CONNECTORS_URL, marketplaceDetail } from '../marketplace/catalog.js';
import { installPlugin, installedCount, isPluginInstalled, listInstalledPlugins, uninstallPlugin } from '../marketplace/state.js';
import { runMcpOAuthLogin } from '../marketplace/mcpOAuth.js';
import { useOv } from '../overlay.jsx';
import '../styles/telas/pages/Marketplace.css';

/** Conectores reais da conta claude.ai (Google, Slack…). */
export function useClaudeConnectors() {
  const [list, setList] = useState([]);
  useEffect(() => { api('/api/claude/connectors').then(r => setList(r.connectors || [])).catch(() => setList([])); }, []);
  return list;
}

function MpIcon({ id, size = 40 }) {
  if (id === 'plug') return <span className="mp-icon"><Icon name="plug" size={size * 0.45} /></span>;
  return <BrandIcon id={id} size={size} />;
}

function PluginRow({ item, settings, onChange, onOpen, claudeList }) {
  const installed = isPluginInstalled(item.id, settings, claudeList);
  return (
    <div className="mp-row">
      <MpIcon id={item.icon} />
      <div className="mp-row-text">
        <b>{item.name}</b>
        <small>{item.connectors ? `${item.connectors} conector${item.connectors > 1 ? 'es' : ''}` : ''}{item.skills ? `${item.connectors ? ' e ' : ''}${item.skills} habilidade${item.skills > 1 ? 's' : ''}` : ''}{!item.connectors && !item.skills ? item.desc : ''}</small>
        {(item.connectors || item.skills) && <small className="mp-desc">{item.desc}</small>}
      </div>
      {installed ? (
        <span className="mp-status ok">Conectado</span>
      ) : (
        <button type="button" className="btn btn-sm" onClick={() => onOpen(item.id)}>Adicionar</button>
      )}
    </div>
  );
}

/** Skills de terceiros: o Ripper baixa do GitHub do autor ao adicionar e mostra a licença antes. */
function MarketSkills({ filter }) {
  const ov = useOv();
  const { toast } = useApp();
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => { api('/api/skills/market').then(setList).catch(() => setList([])); }, []);
  async function add(s) {
    const ok = await ov.confirm({ title: `Licença: ${s.license}`, body: `${s.licenseNote} O Ripper baixa a skill do GitHub do autor (${s.author}); o código não vem com o Ripper.`, action: 'Entendi, adicionar' });
    if (!ok) return;
    setBusy(s.id);
    try { setList(await api(`/api/skills/market/${s.id}`, { method: 'POST' })); toast(`${s.name} pronta para os agentes`); }
    catch (e) { toast(e.message, 'error'); }
    setBusy('');
  }
  const shown = (list || []).filter(filter);
  if (!shown.length) return null;
  return (
    <section className="mp-section">
      <div className="mp-section-head"><h2>Skills</h2><span className="muted small">Gratuitas, de autores da comunidade</span></div>
      <div className="mp-grid two">{shown.map(s => (
        <div key={s.id} className="mp-card">
          <span className="mp-icon"><Icon name="image" size={18} /></span>
          <div><b>{s.name}</b><small>{s.desc}</small><em>por {s.author} · <a href={s.home} target="_blank" rel="noopener">{s.license}</a></em></div>
          <button type="button" className="btn btn-sm" disabled={s.installed || busy === s.id} onClick={() => add(s)}>{s.installed ? 'Instalada' : busy === s.id ? 'Baixando…' : 'Adicionar'}</button>
        </div>
      ))}</div>
    </section>
  );
}

function Browse({ settings, refresh, onOpenDetail, claudeList }) {
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const filter = x => !t || (x.name + x.desc + (x.author || '')).toLowerCase().includes(t);
  const forYou = PLUGIN_CATALOG.filter(p => p.forYou).filter(filter);
  const featured = PLUGIN_CATALOG.filter(p => p.featured).filter(filter);
  const count = installedCount(settings, claudeList);

  return (
    <HubShell
      title="Conectar aplicativos"
      search={q}
      onSearch={setQ}
      searchPlaceholder="Buscar aplicativos"
      actions={
        <button type="button" className="mp-installed" onClick={() => go('/marketplace/manage')}>
          <span className="mp-installed-icons">
            {listInstalledPlugins(settings, claudeList).slice(0, 4).map(p => <MpIcon key={p.id} id={p.icon} size={22} />)}
          </span>
          Instalados: {count} <Icon name="arrowR" size={14} />
        </button>
      }
    >
      {forYou.length > 0 && (
        <section className="mp-section">
          <h2>Para você</h2>
          <div className="mp-grid two">{forYou.map(p => (
            <div key={p.id} className="mp-card">
              <MpIcon id={p.icon} />
              <div><b>{p.name}</b><small>{p.desc}</small></div>
              <button type="button" className="btn btn-sm" onClick={() => onOpenDetail(p.id)} disabled={isPluginInstalled(p.id, settings, claudeList)}>{isPluginInstalled(p.id, settings, claudeList) ? 'Instalado' : 'Adicionar'}</button>
            </div>
          ))}</div>
        </section>
      )}
      {featured.length > 0 && (
        <section className="mp-section">
          <div className="mp-section-head"><h2>Em destaque</h2><button type="button" className="link-btn" onClick={() => go('/marketplace/discover')}>Ver tudo</button></div>
          <div className="mp-grid two">{featured.map(p => (
            <div key={p.id} className="mp-card">
              <MpIcon id={p.icon} />
              <div><b>{p.name}</b><small>{p.desc}</small></div>
              <button type="button" className="btn btn-sm" onClick={() => onOpenDetail(p.id)} disabled={isPluginInstalled(p.id, settings, claudeList)}>{isPluginInstalled(p.id, settings, claudeList) ? 'Instalado' : 'Adicionar'}</button>
            </div>
          ))}</div>
        </section>
      )}
      <MarketSkills filter={filter} />
    </HubShell>
  );
}

function Manage({ settings, refresh, onOpenDetail, claudeList }) {
  const installed = listInstalledPlugins(settings, claudeList);
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? installed : installed.slice(0, 6);

  async function toggle(id, remove) {
    const plugins = remove ? uninstallPlugin(id, settings) : installPlugin(id, settings);
    await api('/api/settings', { method: 'PUT', body: { plugins } });
    await refresh();
  }

  return (
    <HubShell
      title="Gerenciar plugins e habilidades"
      actions={<button type="button" className="link-btn muted" onClick={() => go('/marketplace')}><Icon name="arrowL" size={14} /> Conectar aplicativos</button>}
    >
      <section className="mp-section">
        <h2 className="mp-sub">Instalado</h2>
        <div className="mp-grid two manage">{visible.map(p => (
          <PluginRow key={p.id} item={p} settings={settings} claudeList={claudeList} onChange={id => (id ? toggle(id, false) : refresh())} onOpen={onOpenDetail} />
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
      title="Conectar aplicativos"
      search={q}
      onSearch={setQ}
      searchPlaceholder="Buscar aplicativos"
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
              <button type="button" className="mp-plus" aria-label={`Ver ${c.name}`} onClick={() => onOpenDetail(c.id)}><Icon name="plus" size={16} /></button>
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
  const { S, refresh, toast } = useApp();
  const ov = useOv();
  const claudeList = useClaudeConnectors();
  const { parts } = useRoute();
  const view = parts[1] || 'browse';
  const settings = S.settings;
  const [detailId, setDetailId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const detail = detailId ? marketplaceDetail(detailId) : null;

  /**
   * Conectar de verdade, conforme o tipo:
   * oauth  → salva o servidor e abre o login (popup); token → pede o token; claude → leva para claude.ai.
   * Depois oferece liberar conectores para os agentes que ainda não têm a ferramenta "Plugins MCP".
   */
  async function confirmInstall() {
    if (!detail) return;
    const type = detail.connect?.type;
    if (type === 'claude') {
      window.open(CLAUDE_CONNECTORS_URL, '_blank', 'noopener');
      toast(`Conecte o ${detail.name} na sua conta claude.ai. Os agentes passam a usar na hora.`);
      return;
    }
    setConnecting(true);
    try {
      let extra = {};
      if (type === 'token') {
        const token = await ov.ask({ title: `Token do ${detail.name}`, body: detail.connect.tokenHelp, action: 'Conectar', placeholder: 'cole o token aqui', secret: true });
        if (!token) return;
        extra = { auth: { apiKey: token.trim() } };
      }
      if (type === 'local') {
        const env = {};
        for (const f of detail.connect.fields || []) {
          const v = await ov.ask({ title: f.label, body: f.hint, action: 'Continuar', placeholder: f.placeholder });
          if (!v?.trim()) return;
          env[f.key] = v.trim();
        }
        extra = { env };
      }
      await api('/api/settings', { method: 'PUT', body: { plugins: installPlugin(detail.id, settings, extra) } });
      if (type === 'oauth') await runMcpOAuthLogin({ pluginName: detail.id });
      await refresh();
      const off = S.agents.filter(a => !a.tools.includes('plugins'));
      if (off.length && await ov.confirm({ title: `${detail.name} conectado`, body: `${off.map(a => a.name).join(', ')} ainda não pode(m) usar conectores. Ligar "Conectores" para ${off.length === 1 ? 'ele' : 'eles'}?`, action: 'Liberar' })) {
        await Promise.all(off.map(a => api(`/api/agents/${a.id}`, { method: 'PUT', body: { tools: [...a.tools, 'plugins'] } })));
        await refresh();
      }
      toast(`${detail.name} conectado`);
      setDetailId(null);
    } catch (e) {
      toast(`Não conectou: ${e.message}`, 'error');
      await refresh();
    } finally {
      setConnecting(false);
    }
  }

  if (detail) {
    return (
      <div className="mp-page">
        <ConnectorDetail item={detail} onBack={() => setDetailId(null)} onConnect={confirmInstall} connecting={connecting} connected={isPluginInstalled(detail.id, settings, claudeList)} />
      </div>
    );
  }

  if (view === 'manage') return <Manage settings={settings} refresh={refresh} onOpenDetail={setDetailId} claudeList={claudeList} />;
  if (view === 'discover') return <Discover settings={settings} refresh={refresh} onOpenDetail={setDetailId} />;
  return <Browse settings={settings} refresh={refresh} onOpenDetail={setDetailId} claudeList={claudeList} />;
}
