import { createContext, lazy as reactLazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import { api, go, useRoute, useTheme, useMediaQuery, fmtAgo, local, brandLogoSrc, brandTitle } from './lib.js';
import { Icon, AgentAvatar, ToastProvider, useToast, Dialog, Menu, MenuItem } from './ui.jsx';
import Home from './pages/Home.jsx';
import { OverlayProvider } from './overlay.jsx';
import ChatAvatar, { isGroupChat } from './chatAvatar.jsx';
import { useChatMenu } from './actions.jsx';
import { ApprovalTray } from './approvals.jsx';
import { ResizeHandle } from './resize.jsx';
import Chat from './pages/Chat.jsx';
import UiModeToggle from './uiModeToggle.jsx';
import { getUiMode, isEnterpriseMode, isRouteAllowed, brandForChrome } from './uiMode.js';
import { I18nProvider, useT } from './i18n/index.jsx';

// Telas fora do caminho principal carregam sob demanda. Se o build mudou desde que a aba abriu,
// o pedaço antigo não existe mais: recarrega uma vez para pegar a versão nova.
const lazy = load => reactLazy(() => load().catch(err => {
  const last = +sessionStorage.getItem('ripper.reloaded') || 0;
  if (Date.now() - last > 30_000) { sessionStorage.setItem('ripper.reloaded', Date.now()); location.reload(); return new Promise(() => {}); }
  throw err;
}));
const Agents = lazy(() => import('./pages/Agents.jsx'));
const Inbox = lazy(() => import('./pages/Inbox.jsx'));
const ExternalLog = lazy(() => import('./pages/ExternalLog.jsx'));
const Projects = lazy(() => import('./pages/Projects.jsx'));
const Project = lazy(() => import('./pages/Project.jsx'));
const Chats = lazy(() => import('./pages/Chats.jsx'));
const Explore = lazy(() => import('./pages/Explore.jsx'));
const Library = lazy(() => import('./pages/Library.jsx'));
const Integrations = lazy(() => import('./pages/Integrations.jsx'));
const Marketplace = lazy(() => import('./pages/Marketplace.jsx'));
const Connectors = lazy(() => import('./pages/Connectors.jsx'));
const SkillsHub = lazy(() => import('./pages/SkillsHub.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const AdminCenter = lazy(() => import('./pages/AdminCenter.jsx'));
const AdminUso = lazy(() => import('./pages/AdminUso.jsx'));
const NewAgent = lazy(() => import('./pages/NewAgent.jsx'));
const AgentConfig = lazy(() => import('./pages/AgentConfig.jsx'));
const Flows = lazy(() => import('./pages/Flows.jsx'));
const Outbox = lazy(() => import('./pages/Outbox.jsx'));

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

function Provider({ children }) {
  const [S, setS] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState({}); // agentId -> true enquanto responde (em alguma conversa)
  const [busyChats, setBusyChats] = useState({}); // chatId -> true: só esta conversa anima
  const toast = useToast();
  const refresh = useCallback(async () => {
    try { setS(await api('/api/state')); setError(null); }
    catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  // Rotinas criam conversas no servidor: atualiza ao voltar para a aba.
  useEffect(() => { const f = () => document.visibilityState === 'visible' && refresh(); document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f); }, [refresh]);
  const value = useMemo(() => S && {
    S, refresh, toast, busy, setBusy, busyChats, setBusyChats,
    agent: id => S.agents.find(a => a.id === id),
    updateAgent: async (id, patch) => { const a = await api(`/api/agents/${id}`, { method: 'PUT', body: patch }); setS(s => ({ ...s, agents: s.agents.map(x => x.id === id ? a : x) })); return a; }
  }, [S, refresh, toast, busy, busyChats]);
  if (error && !S) return <Boot error={error} retry={refresh} />;
  if (!value) return <Boot />;
  return <Ctx.Provider value={value}><I18nProvider locale={S.settings.ui?.locale}>{children}</I18nProvider></Ctx.Provider>;
}

function Boot({ error, retry }) {
  return (
    <div className="boot">
      <ThinkingOrb state={error ? 'breathing' : 'connecting'} size={64} paused={!!error} />
      {error ? <><p>Não consegui falar com o servidor do Ripper.</p><p className="muted">{error}</p><button className="btn" onClick={retry}>Tentar de novo</button></> : <p className="muted">Conectando…</p>}
    </div>
  );
}

// Etiqueta curta do agente na lista (função)
const agentTag = a => a?.description || a?.category || '';

function Sidebar({ onNavigate, onSearch, theme, toggleTheme, collapsed, onCollapse }) {
  const { S, agent, busy } = useApp();
  const t = useT();
  const enterprise = isEnterpriseMode(S.settings);
  const { parts } = useRoute();
  const chatMenu = useChatMenu();
  const section = parts[0] === 'c' ? 'chat' : parts[0] || '';
  // Avisos de agente de canal moram na Caixa, não na lista de conversas
  const visible = [...S.chats].filter(c => !c.archived && !String(c.channelKey || '').startsWith('owner:')).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  const recent = visible.slice(0, 30);
  // Fixados: os agentes com conversa mais recente (até 3), como atalhos grandes no topo
  const lastTalk = id => visible.find(c => (c.agentIds || [c.agentId]).includes(id))?.updatedAt || 0;
  const pins = [...S.agents].filter(a => !a.archived).sort((a, b) => lastTalk(b.id) - lastTalk(a.id)).slice(0, 3);
  const nav = to => { onNavigate(); go(to); };
  const brand = brandForChrome(S.settings);
  const logoSrc = brand ? brandLogoSrc(brand.logoUrl) : null;
  const brandName = brand ? brandTitle(S.settings) : t('shell.brand');
  const brandStyle = brand?.accentColor ? { '--brand-accent': brand.accentColor } : undefined;
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`} style={brandStyle}>
      {onCollapse && <ResizeHandle side="left" cssVar="side-w" min={260} max={460} collapsed={collapsed} label="Largura da barra lateral"
        onCollapse={() => !collapsed && onCollapse()} onExpand={() => collapsed && onCollapse()} />}
      <div className="side-top">
        <a href="#/" className="brand" onClick={onNavigate} aria-label={brand ? `${brandName}, início` : t('nav.brand')}>
          {logoSrc
            ? <img className="brand-logo" src={logoSrc} width="28" height="28" alt="" />
            : <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect width="32" height="32" rx="9" className="brand-bg" /><path d="M11 23V9h6.2a4.3 4.3 0 0 1 .9 8.5L22 23" className="brand-r" /></svg>}
          <span>{brandName}</span>
        </a>
        <div className="side-actions">
          <button className="round-btn" onClick={onSearch} aria-label={t('common.search')} title={`${t('common.search')} (Ctrl K)`}><Icon name="search" size={18} /></button>
          <Menu align="right" className="new-menu" trigger={({ toggle, open }) => (
            <button className="round-btn" onClick={toggle} aria-expanded={open} aria-haspopup="menu" aria-label="Novo"><Icon name="plus" size={18} /></button>
          )}>
            <MenuItem icon="chat" onClick={() => nav('/')}>Nova conversa</MenuItem>
            <MenuItem icon="agents" onClick={() => nav('/new')}>Novo agente</MenuItem>
            {enterprise && <MenuItem icon="group" onClick={() => nav('/projects')}>Novo grupo ou projeto</MenuItem>}
          </Menu>
        </div>
      </div>

      {pins.length > 0 && (
        <div className="pins" aria-label="Agentes fixados">
          {pins.map(a => {
            const on = parts[0] === 'a' && parts[1] === a.id;
            return (
              <a key={a.id} href={`#/a/${a.id}`} className={`pin ${on ? 'on' : ''}`} onClick={onNavigate} title={a.name}>
                <span className="pin-av"><AgentAvatar agent={a} size={collapsed ? 30 : 56} state={busy[a.id] ? 'working' : undefined} />{busy[a.id] && <i className="pin-dot" aria-label="trabalhando" />}</span>
                <b>{a.name}</b>
                {agentTag(a) && <small>{agentTag(a)}</small>}
              </a>
            );
          })}
        </div>
      )}

      <nav className="side-list" aria-label={t('nav.chats')}>
        <a href="#/inbox" className={`row inbox-row ${section === 'inbox' ? 'on' : ''}`} onClick={onNavigate} aria-current={section === 'inbox' ? 'page' : undefined}>
          <span className="row-icon"><Icon name="inbox" size={19} /></span>
          <span className="row-text"><b>{t('nav.inbox')}</b><small>{S.inboxCount > 0 ? `${S.inboxCount} esperando você` : 'Nada pendente'}</small></span>
          {S.inboxCount > 0 && <span className="count attn" aria-label={`${S.inboxCount} pendentes`}>{S.inboxCount}</span>}
        </a>
        {recent.map(c => {
          const group = isGroupChat(c);
          const a = agent(c.agentId);
          const unread = c.unread && parts[1] !== c.id;
          return (
            <a key={c.id} href={`#/c/${c.id}`} className={`row ${parts[1] === c.id ? 'on' : ''} ${unread ? 'unread' : ''} ${c.urgent && c.unread ? 'urgent' : ''}`} onClick={onNavigate}
              onContextMenu={e => chatMenu(e, c)} title={collapsed ? c.title : undefined}>
              <span className="row-av"><ChatAvatar chat={c} size={40} /></span>
              <span className="row-text">
                <span className="row-top"><b>{c.title || a?.name}</b>{group ? <em className="row-tag">{t('nav.group')}</em> : a && <em className="row-tag">{a.name}</em>}</span>
                <small>{c.preview || t('nav.noMessages')}</small>
              </span>
              {unread ? <span className="unread-dot" title={t('nav.routineUnread')} /> : <time>{fmtAgo(c.updatedAt || c.createdAt)}</time>}
            </a>
          );
        })}
        {visible.length > recent.length && <a href="#/chats" className="row more-row" onClick={onNavigate}>{t('nav.viewAll')} ({visible.length})</a>}
      </nav>

      <div className="side-foot">
        <Menu align="up" className="account-menu" trigger={({ toggle, open }) => (
          <button className={`me ${['settings', 'admin'].includes(section) ? 'on' : ''}`} onClick={toggle} aria-expanded={open} aria-haspopup="menu" aria-label={t('nav.account')} title={S.settings.name || t('common.you')}>
            {(S.settings.name || 'V')[0].toUpperCase()}
          </button>
        )}>
          <div className="account-head"><span className="initial">{(S.settings.name || 'V')[0].toUpperCase()}</span><span><b>{S.settings.name || t('common.you')}</b><small>{t('nav.agentsProjects', { agents: S.agents.length, projects: S.projects.length })}</small></span></div>
          <MenuItem icon="data" onClick={() => nav('/settings/models')}>Uso das assinaturas</MenuItem>
          <MenuItem icon="agents" onClick={() => nav('/agents')}>{t('nav.agents')}</MenuItem>
          <MenuItem icon="flow" onClick={() => nav('/flows')}>{t('nav.flows')}</MenuItem>
          {enterprise && <MenuItem icon="folder" onClick={() => nav('/projects')}>{t('nav.projects')}</MenuItem>}
          {enterprise && <MenuItem icon="book" onClick={() => nav('/library')}>{t('nav.library')}</MenuItem>}
          <MenuItem icon="gear" onClick={() => nav('/settings')}>{t('nav.settings')}<kbd className="menu-kbd">Ctrl ,</kbd></MenuItem>
          {enterprise && <MenuItem icon="grid" onClick={() => nav('/admin')}>{t('nav.adminCenter')}</MenuItem>}
          <hr className="menu-sep" />
          <div className="menu-mode"><UiModeToggle compact /></div>
          <MenuItem icon={theme === 'dark' ? 'sun' : 'moon'} onClick={toggleTheme}>{t('nav.themeUse', { theme: theme === 'dark' ? t('nav.themeLight') : t('nav.themeDark') })}</MenuItem>
          {onCollapse && <MenuItem icon="sidebar" onClick={onCollapse}>{collapsed ? t('nav.expandBar') : t('nav.collapseBar')}<kbd className="menu-kbd">Ctrl B</kbd></MenuItem>}
        </Menu>
        <button className="connect-btn" onClick={() => { onNavigate(); dispatchEvent(new CustomEvent('ripper:open-marketplace')); }}>
          <Icon name="plug" size={16} /><span>Conectar aplicativos</span>
        </button>
      </div>
    </aside>
  );
}

/* ---------- paleta de comandos ---------- */
function Palette({ open, onClose, toggleTheme }) {
  const { S, agent } = useApp();
  const enterprise = isEnterpriseMode(S.settings);
  const tr = useT();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const [chatHits, setChatHits] = useState([]);
  useEffect(() => { if (open) { setQ(''); setI(0); setChatHits([]); } }, [open]);
  useEffect(() => {
    let alive = true;
    const t = q.trim();
    if (t.length < 2) { setChatHits([]); return () => { alive = false; }; }
    api(`/api/chats?q=${encodeURIComponent(t)}&limit=15`).then(r => { if (alive) setChatHits(r.items || []); }).catch(() => { if (alive) setChatHits([]); });
    return () => { alive = false; };
  }, [q]);
  const items = useMemo(() => {
    const term = q.trim().toLowerCase();
    const chats = term.length >= 2 && chatHits.length ? chatHits : S.chats;
    const all = [
      { g: tr('palette.group.actions'), label: tr('palette.action.newAgent'), icon: 'plus', run: () => go('/new') },
      ...(enterprise ? [{ g: tr('palette.group.actions'), label: tr('palette.action.explore'), icon: 'compass', run: () => go('/explore') }] : []),
      { g: tr('palette.group.actions'), label: tr('palette.action.toggleTheme'), icon: 'moon', run: toggleTheme },
      { g: tr('palette.group.actions'), label: tr('palette.action.settings'), icon: 'gear', run: () => go('/settings') },
      ...S.agents.map(a => ({ g: tr('palette.group.agents'), label: tr('palette.chatWith', { name: a.name }), agent: a, run: () => go(`/a/${a.id}`) })),
      // Resultado do servidor já casou no conteúdo da conversa: não pode ser descartado por não estar no título.
      ...chats.map(c => ({ g: tr('palette.group.chats'), label: c.title, hint: agent(c.agentId)?.name, icon: 'chat', match: chats === chatHits, run: () => go(`/c/${c.id}`) })),
      ...(term.length >= 2 ? [
        ...S.artifacts.filter(a => (a.title + ' ' + (a.kind || '')).toLowerCase().includes(term))
          .map(a => ({ g: 'Artefatos', label: a.title, hint: a.kind, icon: 'file', match: true, run: () => go('/library') })),
        ...S.skills.filter(k => `${k.name} ${k.description || ''} ${k.content || ''}`.toLowerCase().includes(term))
          .map(k => ({ g: 'Skills', label: k.name, hint: k.description, icon: 'bolt', match: true, run: () => go('/library') }))
      ] : [])
    ];
    return all.filter(x => !term || x.match || x.label.toLowerCase().includes(term) || x.hint?.toLowerCase().includes(term)).slice(0, 30);
  }, [q, S, agent, toggleTheme, chatHits, enterprise, tr]);
  const listRef = useRef(null);
  useEffect(() => { listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }, [i]);
  const run = x => { onClose(); x.run(); };
  let g = '';
  return (
    <Dialog open={open} onClose={onClose} className="palette" label={tr('palette.title')}>
      <div className="palette-input"><Icon name="search" /><input autoFocus value={q} placeholder={tr('palette.placeholder')} onChange={e => { setQ(e.target.value); setI(0); }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setI(v => Math.min(v + 1, items.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setI(v => Math.max(v - 1, 0)); }
          if (e.key === 'Enter' && items[i]) run(items[i]);
        }} aria-label={tr('common.search')} /><kbd>Esc</kbd></div>
      <div className="palette-list" ref={listRef} role="listbox">
        {items.length === 0 && <p className="muted pad">{tr('palette.empty', { q })}</p>}
        {items.map((x, n) => (
          <div key={n}>
            {x.g !== g && (g = x.g) && <p className="palette-group">{x.g}</p>}
            <button role="option" aria-selected={n === i} className={n === i ? 'on' : ''} onMouseEnter={() => setI(n)} onClick={() => run(x)}>
              {x.agent ? <AgentAvatar agent={x.agent} size={20} /> : <Icon name={x.icon} size={16} />}
              <span>{x.label}</span>{x.hint && <small>{x.hint}</small>}
            </button>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

function Shell() {
  const { S, toast } = useApp();
  const { parts, query } = useRoute();
  const t = useT();
  const [theme, toggleTheme] = useTheme();
  const [palette, setPalette] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(() => local.get('sideCollapsed', false));
  const toggleCollapsed = () => setCollapsed(c => { local.set('sideCollapsed', !c); return !c; });
  const mobile = useMediaQuery('(max-width: 900px)');
  useEffect(() => {
    const f = e => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p); }
      else if (mod && e.key === ',') { e.preventDefault(); go('/settings'); }
      else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleCollapsed(); }
    };
    addEventListener('keydown', f); return () => removeEventListener('keydown', f);
  }, []);
  useEffect(() => {
    const open = () => setPalette(true);
    addEventListener('ripper:open-palette', open);
    return () => removeEventListener('ripper:open-palette', open);
  }, []);
  useEffect(() => { setDrawer(false); document.querySelector('.main')?.scrollTo(0, 0); }, [parts.join('/')]);
  useEffect(() => {
    if (!S) return;
    if (parts[0] === 'enterprise') {
      go('/admin');
      return;
    }
    if (!isRouteAllowed(parts, S.settings)) {
      if (parts[0] === 'settings') go('/settings');
      else go('/');
      toast?.('Essa tela fica no modo Enterprise. Ative em Configurações › Aparência para ver Projetos e grupos.');
    }
  }, [parts.join('/'), S?.settings?.ui?.mode, S?.settings?.enterprise?.enabled]);

  const [p0, p1, p2] = parts;
  const homeAgent = useMemo(() => {
    const live = S.agents.filter(a => !a.archived);
    const last = [...S.chats].sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0)).find(c => live.some(a => a.id === c.agentId));
    return live.find(a => a.id === last?.agentId) || live[0];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- escolhido ao entrar no Início; não troca no meio da digitação
  }, [S.agents.length, parts.join('/')]);
  const page =
    p0 === 'c' ? <Chat key="chat" chatId={p1} /> :
    p0 === 'a' ? <Chat key="chat" agentId={p1} /> :
    p0 === 'p' && p2 === 'new' ? <Chat key="chat" projectId={p1} agentIds={query.get('agents')?.split(',').filter(Boolean)} /> :
    p0 === 'p' ? <Project id={p1} /> :
    p0 === 'projects' ? <Projects /> :
    p0 === 'chats' ? <Chats /> :
    p0 === 'agents' && p1 && p2 === 'settings' ? <AgentConfig id={p1} /> :
    p0 === 'agents' ? <Agents /> :
    p0 === 'inbox' ? <Inbox /> :
    p0 === 'flows' ? <Flows /> :
    p0 === 'outbox' ? <Outbox /> :
    p0 === 'log' ? <ExternalLog /> :
    p0 === 'new' ? <NewAgent key={query.get('template') || 'blank'} /> :
    p0 === 'explore' ? <Explore /> :
    p0 === 'library' ? <Library /> :
    p0 === 'integrations' ? <Integrations /> :
    p0 === 'marketplace' ? <Marketplace /> :
    p0 === 'connectors' ? <Connectors /> :
    p0 === 'skills' ? <SkillsHub /> :
    p0 === 'admin' && p1 === 'uso' ? <AdminUso /> :
    p0 === 'admin' ? <AdminCenter /> :
    p0 === 'enterprise' ? null :
    p0 === 'settings' ? <Settings theme={theme} toggleTheme={toggleTheme} tab={p1} /> :
    // Início = conversa nova com o agente mais recente; sem agentes, a tela de boas-vindas
    (homeAgent ? <Chat key="chat" agentId={homeAgent.id} /> : <Home />);

  return (
    <div className={`shell ${drawer ? 'drawer-open' : ''} ${collapsed && !mobile ? 'side-collapsed' : ''}`}>
      <Sidebar onNavigate={() => setDrawer(false)} onSearch={() => setPalette(true)} theme={theme} toggleTheme={toggleTheme}
        collapsed={collapsed && !mobile} onCollapse={mobile ? null : toggleCollapsed} />
      {mobile && <button className="scrim" aria-label={t('shell.closeMenu')} onClick={() => setDrawer(false)} tabIndex={drawer ? 0 : -1} />}
      <main className="main">
        {mobile && (
          <div className="mobile-bar">
            <button className="icon-btn" onClick={() => setDrawer(true)} aria-label={t('shell.openMenu')}><Icon name="menu" /></button>
            <span className="mobile-title">{t('shell.brand')}{getUiMode(S.settings) === 'enterprise' ? '' : <span className="mobile-mode-tag">{t('shell.modeSimple')}</span>}</span>
            <div className="mobile-bar-actions">
              <UiModeToggle compact className="mobile-mode" />
              <button className="icon-btn" onClick={() => setPalette(true)} aria-label={t('common.search')}><Icon name="search" /></button>
            </div>
          </div>
        )}
        <Suspense fallback={<div className="page-loading"><ThinkingOrb state="breathing" size={20} /></div>}>{page}</Suspense>
      </main>
      <ApprovalTray />
      <Palette open={palette} onClose={() => setPalette(false)} toggleTheme={toggleTheme} />
    </div>
  );
}

export default function App() {
  return <ToastProvider><Provider><OverlayProvider><Shell /></OverlayProvider></Provider></ToastProvider>;
}
