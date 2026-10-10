import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app.jsx';
import { api, go, useRoute } from '../lib.js';
import { Icon } from '../ui.jsx';
import HubShell from '../marketplace/HubShell.jsx';
import ConnectorCard, { MpIcon } from '../marketplace/ConnectorCard.jsx';
import ConnectorDetail from '../marketplace/ConnectorDetail.jsx';
import CustomConnectorModal from '../marketplace/CustomConnectorModal.jsx';
import SocialWebhooksPanel from '../marketplace/SocialWebhooksPanel.jsx';
import {
  AUTH_KINDS, CATEGORIES, CLAUDE_CONNECTORS_URL, CONNECTORS,
  filterCatalog, marketplaceDetail
} from '../marketplace/catalog.js';
import {
  STATUS, filterByStatus, installedCount, installPlugin, isAttention, isPresent,
  listInstalledPlugins, resolveConnectorStatus, setPluginEnabled, uninstallPlugin
} from '../marketplace/state.js';
import { refreshMcpOAuth, runMcpOAuthLogin } from '../marketplace/mcpOAuth.js';
import { useOv } from '../overlay.jsx';
import { isEnterpriseMode } from '../uiMode.js';
import '../styles/telas/pages/Marketplace.css';

/** Conectores reais da conta claude.ai (Google, Slack…). */
export function useClaudeConnectors() {
  const [list, setList] = useState([]);
  const reload = () => api('/api/claude/connectors').then(r => setList(r.connectors || [])).catch(() => setList([]));
  useEffect(() => {
    reload();
    addEventListener('focus', reload);
    return () => removeEventListener('focus', reload);
  }, []);
  return [list, reload];
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
      <div className="mp-section-head"><h2>Habilidades</h2><span className="muted small">Gratuitas, de autores da comunidade</span></div>
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

function chipOn(cur, id) {
  return cur === id ? '' : id;
}

export default function Marketplace() {
  const { S, refresh, toast } = useApp();
  const ov = useOv();
  const [claudeList] = useClaudeConnectors();
  const { parts, query } = useRoute();
  const settings = S.settings;
  const deepId = query.get('app') || (CONNECTORS.some(c => c.id === parts[1]) ? parts[1] : null);
  const wantInstalled = parts[1] === 'manage' || query.get('tab') === 'installed' || parts[0] === 'connectors' && parts[1] === 'mine';
  const wantWebhooks = query.get('tab') === 'webhooks';

  const [q, setQ] = useState(query.get('q') || '');
  const [category, setCategory] = useState('');
  const [auth, setAuth] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [installedOnly, setInstalledOnly] = useState(!!wantInstalled);
  const [detailId, setDetailId] = useState(deepId);
  const [connecting, setConnecting] = useState('');
  const [errors, setErrors] = useState({});
  const [logs, setLogs] = useState({});
  const [authByName, setAuthByName] = useState({});
  const [stdioByName, setStdioByName] = useState({});
  const [omieCompanies, setOmieCompanies] = useState(null);
  const [customOpen, setCustomOpen] = useState(false);
  const detail = detailId ? marketplaceDetail(detailId) : null;

  function loadLive() {
    api('/api/mcp/connectors').then(r => {
      const authMap = {}, stdioMap = {};
      for (const c of r.connectors || []) {
        authMap[c.name] = c.authStatus;
        if (c.stdioSupervisor) stdioMap[c.name] = c.stdioSupervisor;
      }
      setAuthByName(authMap);
      setStdioByName(stdioMap);
    }).catch(() => {});
    api('/api/omie').then(r => setOmieCompanies(r.companies || [])).catch(() => setOmieCompanies([]));
  }
  useEffect(() => { loadLive(); }, [S.settings.plugins]);
  useEffect(() => { if (deepId) setDetailId(deepId); }, [deepId]);
  useEffect(() => {
    if (wantWebhooks) document.getElementById('mp-webhooks')?.scrollIntoView({ block: 'start' });
  }, [wantWebhooks]);

  const extras = useMemo(() => {
    return (settings.plugins || [])
      .filter(p => !CONNECTORS.some(c => c.id === p.name))
      .map(p => ({
        id: p.name, name: p.name, icon: 'plug', author: 'Você', desc: p.type === 'http' ? 'Endereço personalizado' : 'Programa nesta máquina',
        connect: { type: p.type === 'stdio' ? 'local' : 'oauth', url: p.url }, custom: true, verified: false
      }));
  }, [settings.plugins]);

  const statusOf = (item, installing) => resolveConnectorStatus({
    cat: item,
    settings,
    claudeList,
    authByName,
    liveError: errors[item.id],
    installing: installing || connecting === item.id,
    omieCompanies,
    stdioByName
  });

  const statusMap = useMemo(() => {
    const map = {};
    for (const c of [...CONNECTORS, ...extras]) map[c.id] = statusOf(c);
    return map;
  }, [settings, claudeList, authByName, errors, connecting, omieCompanies, stdioByName, extras]);

  const filtered = useMemo(() => {
    const base = filterCatalog([...CONNECTORS, ...extras], { q, category, auth, verified: verifiedOnly });
    return filterByStatus(base, statusMap, installedOnly);
  }, [q, category, auth, verifiedOnly, installedOnly, extras, statusMap]);

  const attention = filtered.filter(c => isAttention(statusMap[c.id]));
  const connected = filtered.filter(c => statusMap[c.id]?.id === STATUS.connected || statusMap[c.id]?.id === STATUS.off);
  const rest = filtered.filter(c => !isPresent(statusMap[c.id]));
  const searching = !!q.trim() || !!category || !!auth || verifiedOnly || installedOnly;
  const count = installedCount(settings, claudeList);

  async function enableAgentsIfNeeded(name) {
    const off = S.agents.filter(a => !a.tools.includes('plugins'));
    if (off.length && await ov.confirm({ title: `${name} conectado`, body: `${off.map(a => a.name).join(', ')} ainda não pode(m) usar aplicativos. Ligar para ${off.length === 1 ? 'ele' : 'eles'}?`, action: 'Liberar' })) {
      await Promise.all(off.map(a => api(`/api/agents/${a.id}`, { method: 'PUT', body: { tools: [...a.tools, 'plugins'] } })));
      await refresh();
    }
  }

  async function connectItem(item, fields = {}) {
    const type = item.connect?.type;
    if (type === 'claude') {
      window.open(CLAUDE_CONNECTORS_URL, '_blank', 'noopener');
      toast(`Conecte o ${item.name} na sua conta claude.ai e volte aqui.`);
      return;
    }
    if (type === 'native') {
      setDetailId(item.id);
      return;
    }
    setConnecting(item.id);
    setErrors(e => ({ ...e, [item.id]: undefined }));
    try {
      let extra = {};
      if (type === 'token') {
        const token = fields.token?.trim();
        if (!token) throw new Error('Informe o token.');
        extra = { auth: { apiKey: token } };
      }
      if (type === 'local') {
        const env = {};
        for (const f of item.connect.fields || []) {
          const v = String(fields[f.key] || '').trim();
          if (!v) throw new Error(`Informe ${f.label}.`);
          env[f.key] = v;
        }
        extra = { env };
      }
      if (type === 'oauth') extra = { auth: { mode: 'oauth_now' } };
      await api('/api/settings', { method: 'PUT', body: { plugins: installPlugin(item.id, settings, extra) } });
      if (type === 'oauth') await runMcpOAuthLogin({ pluginName: item.id, url: item.connect.url });
      await refresh();
      loadLive();
      await enableAgentsIfNeeded(item.name);
      toast(`${item.name} conectado`);
      setDetailId(null);
    } catch (e) {
      setErrors(er => ({ ...er, [item.id]: e.message }));
      setLogs(l => ({ ...l, [item.id]: e.message }));
      toast(`Não conectou: ${e.message}`, 'error');
      await refresh();
      loadLive();
    } finally {
      setConnecting('');
    }
  }

  async function retryItem(item) {
    setConnecting(item.id);
    setErrors(e => ({ ...e, [item.id]: undefined }));
    try {
      const plugin = (settings.plugins || []).find(p => p.name === item.id);
      if (item.connect?.type === 'oauth' || plugin?.type === 'http') {
        const st = authByName[item.id];
        if (st?.state === 'expired_refreshable') {
          await refreshMcpOAuth(item.id);
        } else {
          await runMcpOAuthLogin({ pluginName: item.id, url: plugin?.url || item.connect.url });
        }
      }
      const probe = await api('/api/mcp/verify', {
        method: 'POST',
        body: plugin?.type === 'stdio'
          ? { type: 'stdio', name: item.id, command: plugin.command, args: plugin.args }
          : { url: plugin?.url || item.connect.url, pluginName: item.id }
      });
      if (!probe.ok && !probe.oauthRequired) {
        const detail = probe.failureReason || probe.warning || probe.steps?.find(s => s.status === 'error')?.detail || 'Falha ao contactar o aplicativo.';
        throw new Error(detail);
      }
      await refresh();
      loadLive();
      toast(`${item.name} ok`);
    } catch (e) {
      setErrors(er => ({ ...er, [item.id]: e.message }));
      setLogs(l => ({ ...l, [item.id]: e.message }));
      toast(e.message, 'error');
    } finally {
      setConnecting('');
    }
  }

  async function toggleEnabled(item, enabled) {
    await api('/api/settings', { method: 'PUT', body: { plugins: setPluginEnabled(item.id, settings, enabled) } });
    await refresh();
  }

  async function removeItem(item) {
    if (!(await ov.confirm({ title: `Remover ${item.name}?`, body: 'Os agentes deixam de usar este aplicativo. O acesso salvo é apagado.', action: 'Remover', danger: true }))) return;
    await api('/api/settings', { method: 'PUT', body: { plugins: uninstallPlugin(item.id, settings) } });
    await refresh();
    loadLive();
  }

  function card(item) {
    const st = statusMap[item.id] || statusOf(item);
    return (
      <ConnectorCard
        key={item.id}
        item={item}
        status={st}
        busy={connecting === item.id}
        error={errors[item.id]}
        logs={logs[item.id]}
        onOpen={id => setDetailId(id)}
        onConnect={fields => connectItem(item, fields)}
        onRetry={() => retryItem(item)}
        onRefresh={async () => {
          setConnecting(item.id);
          try {
            if (authByName[item.id]?.state === 'expired_refreshable') await refreshMcpOAuth(item.id);
            else await runMcpOAuthLogin({ pluginName: item.id, url: item.connect.url });
            await refresh();
            loadLive();
          } catch (e) {
            setErrors(er => ({ ...er, [item.id]: e.message }));
            toast(e.message, 'error');
          }
          setConnecting('');
        }}
        onEnable={() => toggleEnabled(item, true)}
      />
    );
  }

  if (detail) {
    const st = statusMap[detail.id] || statusOf(detail);
    return (
      <div className="mp-page">
        <ConnectorDetail
          item={detail}
          onBack={() => setDetailId(null)}
          onConnect={() => connectItem(detail)}
          connecting={connecting === detail.id}
          connected={st.id === STATUS.connected}
          status={st}
          onRemove={detail.connect?.type !== 'claude' && detail.connect?.type !== 'native' ? () => removeItem(detail) : undefined}
          onDisable={st.id === STATUS.connected && detail.connect?.type !== 'claude' && detail.connect?.type !== 'native' ? () => toggleEnabled(detail, false) : undefined}
        />
      </div>
    );
  }

  return (
    <>
      <HubShell
        title="Conectar aplicativos"
        search={q}
        onSearch={setQ}
        searchPlaceholder="Buscar Notion, Gmail, GitHub…"
        actions={
          <>
            <button type="button" className="btn btn-sm" onClick={() => setCustomOpen(true)}>
              <Icon name="plus" size={14} /> Adicionar por endereço
            </button>
            <button type="button" className={`mp-installed ${installedOnly ? 'on' : ''}`} onClick={() => setInstalledOnly(v => !v)}>
              <span className="mp-installed-icons">
                {listInstalledPlugins(settings, claudeList).slice(0, 4).map(p => <MpIcon key={p.id} id={p.icon} size={22} />)}
              </span>
              Conectados: {count}
            </button>
          </>
        }
      >
        <div className="mp-filters" role="toolbar" aria-label="Filtros">
          <div className="pills">
            {CATEGORIES.map(([id, label]) => (
              <button key={id} type="button" className={`chip ${category === id ? 'on' : ''}`} onClick={() => setCategory(c => chipOn(c, id))}>{label}</button>
            ))}
          </div>
          <div className="pills">
            {AUTH_KINDS.map(([id, label]) => (
              <button key={id} type="button" className={`chip ${auth === id ? 'on' : ''}`} onClick={() => setAuth(c => chipOn(c, id))}>{label}</button>
            ))}
            <button type="button" className={`chip ${verifiedOnly ? 'on' : ''}`} onClick={() => setVerifiedOnly(v => !v)}>Verificados</button>
            <button type="button" className={`chip ${installedOnly ? 'on' : ''}`} onClick={() => setInstalledOnly(v => !v)}>Instalados</button>
          </div>
        </div>

        {!filtered.length && (
          <div className="mp-conn-empty">
            <p><b>Nada encontrado.</b> Tente outro nome ou adicione um aplicativo pelo endereço HTTPS.</p>
            <div className="row">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => { setQ(''); setCategory(''); setAuth(''); setVerifiedOnly(false); setInstalledOnly(false); }}>Limpar busca</button>
              <button type="button" className="btn btn-sm" onClick={() => setCustomOpen(true)}>Adicionar por endereço</button>
            </div>
          </div>
        )}

        {!!attention.length && (
          <section className="mp-section">
            <h2>Precisa de você</h2>
            <div className="mp-grid two">{attention.map(card)}</div>
          </section>
        )}

        {!!connected.length && (
          <section className="mp-section">
            <h2>{searching ? 'Conectados' : 'Seus aplicativos'}</h2>
            <div className="mp-grid two">{connected.map(card)}</div>
          </section>
        )}

        {!!rest.length && (
          <section className="mp-section">
            <div className="mp-section-head">
              <h2>{searching ? 'Resultados' : 'Todos os aplicativos'} <span className="tag">{rest.length}</span></h2>
            </div>
            <div className="mp-grid two">{rest.map(card)}</div>
          </section>
        )}

        <MarketSkills filter={x => !q.trim() || (x.name + x.desc + (x.author || '')).toLowerCase().includes(q.trim().toLowerCase())} />

        {isEnterpriseMode(S.settings) && S.settings.flags?.socialWebhooks && (
          <section className="mp-section" id="mp-webhooks">
            <h2>Webhooks sociais</h2>
            <SocialWebhooksPanel />
          </section>
        )}
      </HubShell>
      <CustomConnectorModal open={customOpen} onClose={() => setCustomOpen(false)} onSaved={() => { refresh(); loadLive(); }} />
    </>
  );
}
