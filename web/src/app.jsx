import { createContext, lazy as reactLazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import { api, go, useRoute, useTheme, useMediaQuery, fmtAgo, local } from './lib.js';
import { Icon, AgentAvatar, ToastProvider, useToast, Dialog, Menu, MenuItem } from './ui.jsx';
import Home from './pages/Home.jsx';
import { OverlayProvider } from './overlay.jsx';
import ChatAvatar, { isGroupChat } from './chatAvatar.jsx';
import { useChatMenu } from './actions.jsx';
import { ApprovalTray } from './approvals.jsx';
import { ResizeHandle } from './resize.jsx';
import Chat from './pages/Chat.jsx';

// Telas fora do caminho principal carregam sob demanda. Se o build mudou desde que a aba abriu,
// o pedaço antigo não existe mais: recarrega uma vez para pegar a versão nova.
const lazy = load => reactLazy(() => load().catch(err => {
  const last = +sessionStorage.getItem('ripper.reloaded') || 0;
  if (Date.now() - last > 30_000) { sessionStorage.setItem('ripper.reloaded', Date.now()); location.reload(); return new Promise(() => {}); }
  throw err;
}));
const Agents = lazy(() => import('./pages/Agents.jsx'));
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
const NewAgent = lazy(() => import('./pages/NewAgent.jsx'));
const AgentConfig = lazy(() => import('./pages/AgentConfig.jsx'));

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
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function Boot({ error, retry }) {
  return (
    <div className="boot">
      <ThinkingOrb state={error ? 'breathing' : 'connecting'} size={64} paused={!!error} />
      {error ? <><p>Não consegui falar com o servidor do Ripper.</p><p className="muted">{error}</p><button className="btn" onClick={retry}>Tentar de novo</button></> : <p className="muted">Conectando…</p>}
    </div>
  );
}

const NAV = [
  ['', 'Início', 'home'],
  ['projects', 'Projetos', 'folder'],
  ['agents', 'Agentes', 'agents'],
  ['explore', 'Explorar', 'compass'],
  ['library', 'Biblioteca', 'book']
];

function Sidebar({ onNavigate, onSearch, theme, toggleTheme, collapsed, onCollapse }) {
  const { S, agent, busy } = useApp();
  const { parts } = useRoute();
  const chatMenu = useChatMenu();
  const section = parts[0] === 'c' ? 'chat' : parts[0] === 'new' ? 'agents' : parts[0] === 'p' ? 'projects' : parts[0] || '';
  const recent = [...S.chats].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)).slice(0, 12);
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      {onCollapse && <ResizeHandle side="left" cssVar="side-w" min={220} max={440} collapsed={collapsed} label="Largura da barra lateral"
        onCollapse={() => !collapsed && onCollapse()} onExpand={() => collapsed && onCollapse()} />}
      <div className="brand-row">
        <a href="#/" className="brand" onClick={onNavigate} aria-label="Ripper, início">
          <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><rect width="32" height="32" rx="8" className="brand-bg" /><path d="M11 23V9h6.2a4.3 4.3 0 0 1 .9 8.5L22 23" className="brand-r" /></svg>
          <span>Ripper</span>
        </a>
        {onCollapse && <button className="icon-btn sm collapse-btn" onClick={onCollapse} aria-label={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'} title={collapsed ? 'Expandir (Ctrl B)' : 'Recolher (Ctrl B)'}><Icon name="sidebar" size={17} /></button>}
      </div>
      <button className="side-search" onClick={onSearch} aria-label="Buscar"><Icon name="search" size={16} /><span>Buscar</span><kbd>Ctrl K</kbd></button>
      <nav className="nav" aria-label="Principal">
        {NAV.map((n, i) => n ? (
          <a key={n[0]} href={'#/' + n[0]} className={section === n[0] ? 'on' : ''} aria-current={section === n[0] ? 'page' : undefined} onClick={onNavigate} title={collapsed ? n[1] : undefined} aria-label={n[1]}>
            <Icon name={n[2]} /><span className="nav-label">{n[1]}</span>
            {n[0] === 'projects' && S.projects.length > 0 && <span className="count">{S.projects.length}</span>}
          </a>
        ) : <hr key={i} />)}
        {collapsed && <a href="#/chats" className={section === 'chats' ? 'on' : ''} onClick={onNavigate} title="Conversas" aria-label="Conversas"><Icon name="chat" /></a>}
      </nav>
      {!collapsed && recent.length > 0 && (
        <div className="recent">
          <div className="side-label-row"><p className="side-label">Conversas</p><a href="#/chats" className={`side-all ${section === 'chats' ? 'on' : ''}`} onClick={onNavigate}>Ver todas<span>{S.chats.length}</span></a></div>
          {recent.map(c => {
            const group = isGroupChat(c);
            return (
              <a key={c.id} href={`#/c/${c.id}`} className={`recent-item ${parts[1] === c.id ? 'on' : ''} ${group ? 'is-group' : ''} ${c.unread && parts[1] !== c.id ? 'unread' : ''} ${c.urgent && c.unread ? 'urgent' : ''}`} onClick={onNavigate}
                onContextMenu={e => chatMenu(e, c)}>
                <span className="recent-av"><ChatAvatar chat={c} size={24} /></span>
                <span className="recent-text">
                  <b>{c.title}</b>
                  <small>{group && <span className="recent-group">Grupo · </span>}{c.preview || 'Sem mensagens'}</small>
                </span>
                {c.unread && parts[1] !== c.id ? <span className="unread-dot" title="Novidade de rotina" /> : <time>{fmtAgo(c.updatedAt || c.createdAt)}</time>}
              </a>
            );
          })}
        </div>
      )}
      <div className="side-foot">
        <Menu align="up" className="account-menu" trigger={({ toggle, open }) => (
          <button className={`account ${['settings', 'integrations', 'marketplace', 'connectors', 'skills'].includes(section) ? 'on' : ''}`} onClick={toggle} aria-expanded={open} aria-haspopup="menu" title={collapsed ? 'Conta e configurações' : undefined}>
            <span className="initial">{(S.settings.name || 'V')[0].toUpperCase()}</span>
            <span className="account-name"><b>{S.settings.name || 'Você'}</b><small>Conta e configurações</small></span>
            <Icon name="more" size={16} className="account-more" />
          </button>
        )}>
          <div className="account-head"><span className="initial">{(S.settings.name || 'V')[0].toUpperCase()}</span><span><b>{S.settings.name || 'Você'}</b><small>{S.agents.length} agentes · {S.projects.length} projetos</small></span></div>
          <MenuItem icon="gear" onClick={() => { onNavigate(); go('/settings'); }}>Configurações</MenuItem>
          <MenuItem icon="store" onClick={() => { onNavigate(); go('/marketplace'); }}>Marketplace</MenuItem>
          <MenuItem icon="plug" onClick={() => { onNavigate(); go('/connectors'); }}>Conectores</MenuItem>
          <MenuItem icon="bolt" onClick={() => { onNavigate(); go('/skills'); }}>Habilidades</MenuItem>
          <MenuItem icon="cube" onClick={() => { onNavigate(); go('/settings/models'); }}>Modelos e computador<small className="menu-hint">Claude, Docker, plugins</small></MenuItem>
          <MenuItem icon={theme === 'dark' ? 'sun' : 'moon'} onClick={toggleTheme}>Tema {theme === 'dark' ? 'claro' : 'escuro'}</MenuItem>
          <hr className="menu-sep" />
          <MenuItem icon="search" onClick={onSearch}>Buscar<kbd className="menu-kbd">Ctrl K</kbd></MenuItem>
          <MenuItem icon="sidebar" onClick={onCollapse || undefined} disabled={!onCollapse}>{collapsed ? 'Expandir barra' : 'Recolher barra'}<kbd className="menu-kbd">Ctrl B</kbd></MenuItem>
        </Menu>
      </div>
    </aside>
  );
}

/* ---------- paleta de comandos ---------- */
function Palette({ open, onClose, toggleTheme }) {
  const { S, agent } = useApp();
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
    const t = q.trim().toLowerCase();
    const chats = t.length >= 2 && chatHits.length ? chatHits : S.chats;
    const all = [
      { g: 'Ações', label: 'Criar novo agente', icon: 'plus', run: () => go('/new') },
      { g: 'Ações', label: 'Explorar templates', icon: 'compass', run: () => go('/explore') },
      { g: 'Ações', label: 'Alternar tema', icon: 'moon', run: toggleTheme },
      { g: 'Ações', label: 'Configurações', icon: 'gear', run: () => go('/settings') },
      ...S.agents.map(a => ({ g: 'Agentes', label: `Conversar com ${a.name}`, agent: a, run: () => go(`/a/${a.id}`) })),
      ...chats.map(c => ({ g: 'Conversas', label: c.title, hint: agent(c.agentId)?.name, icon: 'chat', run: () => go(`/c/${c.id}`) }))
    ];
    return all.filter(x => !t || x.label.toLowerCase().includes(t) || x.hint?.toLowerCase().includes(t)).slice(0, 30);
  }, [q, S, agent, toggleTheme, chatHits]);
  const listRef = useRef(null);
  useEffect(() => { listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }, [i]);
  const run = x => { onClose(); x.run(); };
  let g = '';
  return (
    <Dialog open={open} onClose={onClose} className="palette" label="Buscar">
      <div className="palette-input"><Icon name="search" /><input autoFocus value={q} placeholder="Buscar conversas, agentes e ações…" onChange={e => { setQ(e.target.value); setI(0); }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setI(v => Math.min(v + 1, items.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setI(v => Math.max(v - 1, 0)); }
          if (e.key === 'Enter' && items[i]) run(items[i]);
        }} aria-label="Buscar" /><kbd>Esc</kbd></div>
      <div className="palette-list" ref={listRef} role="listbox">
        {items.length === 0 && <p className="muted pad">Nada encontrado para “{q}”.</p>}
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
  const { parts, query } = useRoute();
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

  const [p0, p1, p2] = parts;
  const page =
    p0 === 'c' ? <Chat key="chat" chatId={p1} /> :
    p0 === 'a' ? <Chat key="chat" agentId={p1} /> :
    p0 === 'p' && p2 === 'new' ? <Chat key="chat" projectId={p1} agentIds={query.get('agents')?.split(',').filter(Boolean)} /> :
    p0 === 'p' ? <Project id={p1} /> :
    p0 === 'projects' ? <Projects /> :
    p0 === 'chats' ? <Chats /> :
    p0 === 'agents' && p1 && p2 === 'settings' ? <AgentConfig id={p1} /> :
    p0 === 'agents' ? <Agents /> :
    p0 === 'new' ? <NewAgent key={query.get('template') || 'blank'} /> :
    p0 === 'explore' ? <Explore /> :
    p0 === 'library' ? <Library /> :
    p0 === 'integrations' ? <Integrations /> :
    p0 === 'marketplace' ? <Marketplace /> :
    p0 === 'connectors' ? <Connectors /> :
    p0 === 'skills' ? <SkillsHub /> :
    p0 === 'settings' ? <Settings theme={theme} toggleTheme={toggleTheme} tab={p1} /> :
    <Home />;

  return (
    <div className={`shell ${drawer ? 'drawer-open' : ''} ${collapsed && !mobile ? 'side-collapsed' : ''}`}>
      <Sidebar onNavigate={() => setDrawer(false)} onSearch={() => setPalette(true)} theme={theme} toggleTheme={toggleTheme}
        collapsed={collapsed && !mobile} onCollapse={mobile ? null : toggleCollapsed} />
      {mobile && <button className="scrim" aria-label="Fechar menu" onClick={() => setDrawer(false)} tabIndex={drawer ? 0 : -1} />}
      <main className="main">
        {mobile && (
          <div className="mobile-bar">
            <button className="icon-btn" onClick={() => setDrawer(true)} aria-label="Abrir menu"><Icon name="menu" /></button>
            <span className="mobile-title">Ripper</span>
            <button className="icon-btn" onClick={() => setPalette(true)} aria-label="Buscar"><Icon name="search" /></button>
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
