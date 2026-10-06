import { createContext, lazy as reactLazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import { api, go, useRoute, useTheme, useMediaQuery, fmtAgo, local, brandLogoSrc, brandTitle, stepLabel } from './lib.js';
import { Icon, AgentAvatar, ToastProvider, useToast, Dialog, Menu, MenuItem } from './ui.jsx';
import Home from './pages/Home.jsx';
import { OverlayProvider } from './overlay.jsx';
import ChatAvatar, { isGroupChat } from './chatAvatar.jsx';
import { useChatMenu } from './actions.jsx';
import { ApprovalTray } from './approvals.jsx';
import { FirstRunWizard } from './firstRunWizard.jsx';
import { ResizeHandle } from './resize.jsx';
import Chat from './pages/Chat.jsx';
import { useSidebarDrag, useFlip } from './agentDrag.jsx';
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
const Help = lazy(() => import('./pages/Help.jsx'));
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
const Health = lazy(() => import('./pages/Health.jsx'));

const HUB_ROUTES = new Set(['marketplace', 'connectors', 'skills', 'integrations', 'explore', 'settings', 'saude', 'ajuda']);
const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

function Provider({ children }) {
  const [S, setS] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState({}); // agentId -> true enquanto responde (em alguma conversa)
  const [busyChats, setBusyChats] = useState({}); // chatId -> true: só esta conversa anima
  // Quem está trabalhando segundo o servidor (rotinas, WhatsApp, outra aba): a tela nunca fica parada
  const [working, setWorking] = useState({});
  useEffect(() => {
    const load = () => document.visibilityState === 'visible' && api('/api/agents/working').then(r => setWorking(r.working || {}), () => {});
    load(); const t = setInterval(load, 4000); return () => clearInterval(t);
  }, []);
  const toast = useToast();
  const refresh = useCallback(async () => {
    try { setS(await api('/api/state')); setError(null); }
    catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  // Rotinas criam conversas no servidor: atualiza ao voltar para a aba.
  useEffect(() => { const f = () => document.visibilityState === 'visible' && refresh(); document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f); }, [refresh]);
  const value = useMemo(() => S && {
    S, refresh, toast, setBusy, setBusyChats, working,
    busy: { ...Object.fromEntries(Object.keys(working).map(id => [id, true])), ...busy },
    busyChats: { ...Object.fromEntries(Object.values(working).filter(w => w.chatId).map(w => [w.chatId, true])), ...busyChats },
    agent: id => S.agents.find(a => a.id === id),
    updateAgent: async (id, patch) => { const a = await api(`/api/agents/${id}`, { method: 'PUT', body: patch }); setS(s => ({ ...s, agents: s.agents.map(x => x.id === id ? a : x) })); return a; }
  }, [S, refresh, toast, busy, busyChats, working]);
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
  const { S, agent, busy, working } = useApp();
  const t = useT();
  const enterprise = isEnterpriseMode(S.settings);
  const { parts } = useRoute();
  const doing = id => { const w = working[id]; return w ? `${w.tool ? stepLabel(w.tool) : 'trabalhando'}${w.chatTitle === 'WhatsApp' ? ' no WhatsApp' : ''}…` : 'trabalhando…'; };
  const chatMenu = useChatMenu();
  const section = parts[0] === 'c' ? 'chat' : parts[0] || '';
  // Avisos de agente de canal moram na Caixa, não na lista de conversas
  // Avisos de agente de canal moram na Caixa, não na lista
  const visible = [...S.chats].filter(c => !c.archived && !String(c.channelKey || '').startsWith('owner:')).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  // Um agente = uma conversa (como num mensageiro); grupos aparecem como entradas próprias
  const soloOf = id => visible.find(c => !isGroupChat(c) && c.agentId === id);
  const live = S.agents.filter(a => !a.archived);
  const entries = [
    ...live.map(a => ({ key: a.id, kind: 'agent', a, c: soloOf(a.id), at: soloOf(a.id)?.updatedAt || a.createdAt || 0 })),
    ...visible.filter(isGroupChat).map(c => ({ key: `g:${c.id}`, kind: 'group', c, at: c.updatedAt || c.createdAt || 0 }))
  ].sort((x, y) => y.at - x.at);
  const byKey = new Map(entries.map(e => [e.key, e]));
  // Fixados e ordem da lista: escolhidos arrastando (salvo neste navegador). Itens novos entram no topo.
  // Salvo nas configurações (igual em todos os aparelhos); o navegador guarda só como reserva
  const synced = S.settings.ui?.sidebar;
  const [pinIds, setPinIds] = useState(() => synced?.pins ?? local.get('pins', null));
  const [order, setOrder] = useState(() => synced?.order ?? local.get('sideOrder', []));
  useEffect(() => { if (synced?.pins) setPinIds(synced.pins); if (synced?.order) setOrder(synced.order); }, [synced?.pins?.join(), synced?.order?.join()]);
  const pinKeys = (pinIds || entries.filter(e => e.kind === 'agent').slice(0, 3).map(e => e.key)).filter(k => byKey.get(k)?.kind === 'agent');
  const rest = entries.map(e => e.key).filter(k => !pinKeys.includes(k));
  const listKeys = [...rest.filter(k => !order.includes(k)), ...order.filter(k => rest.includes(k))];
  const saveOrder = (P, Lk) => {
    setPinIds(P); local.set('pins', P); setOrder(Lk); local.set('sideOrder', Lk);
    api('/api/settings', { method: 'PUT', body: { ui: { sidebar: { pins: P, order: Lk.slice(0, 1000) } } } }).catch(() => {});
  };
  // Mesmo que arrastar, pelo teclado: Alt+setas move, Alt+P fixa/desafixa (o leitor de tela ouve o resultado)
  const [said, setSaid] = useState('');
  const keyMove = (e, k) => {
    if (!e.altKey) return;
    const P = [...pinKeys], Lk = [...listKeys], inPins = P.includes(k), arr = inPins ? P : Lk, i = arr.indexOf(k);
    const name = byKey.get(k)?.a?.name || byKey.get(k)?.c?.title || '';
    let d = 0;
    if (e.key === (inPins ? 'ArrowLeft' : 'ArrowUp')) d = -1;
    else if (e.key === (inPins ? 'ArrowRight' : 'ArrowDown')) d = 1;
    else if (e.key.toLowerCase() === 'p') {
      e.preventDefault();
      if (inPins) { P.splice(i, 1); Lk.unshift(k); setSaid(`${name} saiu dos fixados`); }
      else if (byKey.get(k)?.kind === 'agent') { Lk.splice(i, 1); P.push(k); if (P.length > 4) Lk.unshift(P.shift()); setSaid(`${name} fixado`); }
      else return;
      saveOrder(P, Lk); setTimeout(() => document.querySelector(`[data-flip="${k}"]`)?.focus(), 50); return;
    } else return;
    e.preventDefault();
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    saveOrder(P, Lk); setSaid(`${name} na posição ${j + 1}`);
    setTimeout(() => document.querySelector(`[data-flip="${k}"]`)?.focus(), 50);
  };
  const drag = useSidebarDrag({
    pins: pinKeys, list: listKeys, canPin: k => byKey.get(k)?.kind === 'agent',
    idsOf: k => { const e = byKey.get(k); return e?.kind === 'agent' ? [e.a.id] : (e?.c?.agentIds || []); },
    onCommit: ({ pins: P, list: Lk }) => saveOrder(P, Lk),
    renderGhost: (k, kind) => {
      const e = byKey.get(k);
      if (!e) return null;
      return kind === 'pin' || e.kind === 'agent'
        ? <><AgentAvatar agent={e.a} size={kind === 'pin' ? 52 : 40} animate /><b>{e.a.name}</b></>
        : <><ChatAvatar chat={e.c} size={40} /><b>{e.c.title}</b></>;
    }
  });
  const pinsRef = useRef(null), listRef = useRef(null);
  useFlip(pinsRef); useFlip(listRef);
  const dragKey = drag.drag?.key;
  const activeAgent = parts[0] === 'a' ? parts[1] : parts[0] === 'c' ? S.chats.find(c => c.id === parts[1] && !isGroupChat(c))?.agentId : null;
  const nav = to => { onNavigate(); go(to); };
  const brand = brandForChrome(S.settings);
  const logoSrc = brand ? brandLogoSrc(brand.logoUrl) : null;
  const brandName = brand ? brandTitle(S.settings) : t('shell.brand');
  const brandStyle = brand?.accentColor ? { '--brand-accent': brand.accentColor } : undefined;
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`} style={brandStyle}>
      {onCollapse && <ResizeHandle side="left" cssVar="side-w" min={300} max={480} collapsed={collapsed} label="Largura da barra lateral"
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
            <MenuItem icon="agents" onClick={() => nav('/new')}>Novo agente</MenuItem>
            {enterprise && <MenuItem icon="group" onClick={() => nav('/projects')}>Novo grupo ou projeto</MenuItem>}
          </Menu>
        </div>
      </div>

      <div ref={pinsRef} className={`pins ${drag.drag ? 'drop-ready' : ''} ${drag.drag?.over?.zone === 'pins' ? 'over' : ''}`} aria-label="Agentes fixados" onClickCapture={drag.onClickCapture}>
        {drag.pins.map(k => byKey.get(k)?.a).filter(Boolean).map(a => (
          <a key={a.id} data-flip={a.id} data-pin={a.id} href={`#/a/${a.id}`} className={`pin ${activeAgent === a.id ? 'on' : ''} ${dragKey === a.id ? 'lifted' : ''}`} onClick={onNavigate}
            title={`${a.name} · Alt+setas move, Alt+P desafixa`} draggable={false} onPointerDown={e => drag.onPointerDown(e, a.id)} onKeyDown={e => keyMove(e, a.id)}>
            <span className="pin-av"><AgentAvatar agent={a} size={collapsed ? 30 : 52} state={busy[a.id] ? 'working' : undefined} />{busy[a.id] && <i className="pin-dot" aria-label="trabalhando" />}</span>
            <b>{a.name}</b>
          </a>
        ))}
        {drag.pins.length === 0 && <p className="pins-empty">Arraste um agente para cá para fixar</p>}
      </div>
      {drag.ghost}
      <p className="sr-only" aria-live="polite">{said}</p>

      <nav ref={listRef} className="side-list" aria-label={t('nav.agents')} onClickCapture={drag.onClickCapture}>
        <a href="#/inbox" className={`row inbox-row ${section === 'inbox' ? 'on' : ''}`} onClick={onNavigate} aria-current={section === 'inbox' ? 'page' : undefined}>
          <span className="row-icon"><Icon name="inbox" size={19} /></span>
          <span className="row-text"><b>{t('nav.inbox')}</b><small>{S.inboxCount > 0 ? `${S.inboxCount} esperando você` : 'Nada pendente'}</small></span>
          {S.inboxCount > 0 && <span className="count attn" aria-label={`${S.inboxCount} pendentes`}>{S.inboxCount}</span>}
        </a>
        {drag.list.map(k => byKey.get(k)).filter(Boolean).map(e => {
          const c = e.c;
          const unread = c?.unread && parts[1] !== c.id;
          const common = { key: e.key, 'data-flip': e.key, 'data-item': e.key, draggable: false, onClick: onNavigate, onPointerDown: ev => drag.onPointerDown(ev, e.key), onKeyDown: ev => keyMove(ev, e.key) };
          if (e.kind === 'group') return (
            <a {...common} href={`#/c/${c.id}`} className={`row ${parts[1] === c.id ? 'on' : ''} ${unread ? 'unread' : ''} ${dragKey === e.key ? 'lifted' : ''}`} onContextMenu={ev => chatMenu(ev, c)} title={collapsed ? c.title : undefined}>
              <span className="row-av"><ChatAvatar chat={c} size={40} /></span>
              <span className="row-text"><span className="row-top"><b>{c.title}</b><em className="row-tag">{t('nav.group')}</em></span><small>{c.preview || t('nav.noMessages')}</small></span>
              {unread ? <span className="unread-dot" /> : <time>{fmtAgo(e.at)}</time>}
            </a>
          );
          const a = e.a;
          return (
            <a {...common} href={`#/a/${a.id}`} className={`row ${activeAgent === a.id ? 'on' : ''} ${unread ? 'unread' : ''} ${dragKey === e.key ? 'lifted' : ''}`} onContextMenu={ev => c && chatMenu(ev, c)} title={collapsed ? a.name : undefined}>
              <span className="row-av"><AgentAvatar agent={a} size={40} state={busy[a.id] ? 'working' : undefined} /></span>
              <span className="row-text"><span className="row-top"><b>{a.name}</b></span><small className={busy[a.id] ? 'is-working' : ''}>{busy[a.id] ? doing(a.id) : c?.preview || agentTag(a) || 'Diga oi'}</small></span>
              {unread ? <span className="unread-dot" /> : c && <time>{fmtAgo(e.at)}</time>}
            </a>
          );
        })}
        {visible.length > 0 && <a href="#/chats" className="row more-row" onClick={onNavigate}>Histórico de conversas</a>}
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
          <MenuItem icon="bulb" onClick={() => nav('/ajuda')}>Ajuda<kbd className="menu-kbd">?</kbd></MenuItem>
          <MenuItem icon="gear" onClick={() => nav('/settings')}>{t('nav.settings')}<kbd className="menu-kbd">Ctrl ,</kbd></MenuItem>
          <MenuItem icon="data" onClick={() => nav('/saude')}>Saúde do Ripper</MenuItem>
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
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if (e.key === '?' && !mod && !typing) { e.preventDefault(); go('/ajuda'); return; }
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

  // Marketplace/Conectores/Habilidades abrem como janela por cima da tela atual
  const bgRef = useRef(['']);
  const overlayOpen = HUB_ROUTES.has(parts[0]);
  if (!overlayOpen) bgRef.current = parts;
  const closeHub = useCallback(() => go('/' + bgRef.current.join('/')), []);
  useEffect(() => {
    const open = () => go('/marketplace');
    addEventListener('ripper:open-marketplace', open); addEventListener('ripper:close-hub', closeHub);
    return () => { removeEventListener('ripper:open-marketplace', open); removeEventListener('ripper:close-hub', closeHub); };
  }, [closeHub]);
  useEffect(() => {
    if (!overlayOpen) return;
    const f = e => e.key === 'Escape' && !document.querySelector('dialog[open]') && closeHub();
    addEventListener('keydown', f); return () => removeEventListener('keydown', f);
  }, [overlayOpen, closeHub]);
  const [p0, p1, p2] = overlayOpen ? bgRef.current : parts;
  // Um agente = uma conversa: /a/:id abre a conversa 1:1 mais recente dele
  const soloFor = id => id && [...S.chats].filter(c => !c.archived && c.agentId === id && (c.agentIds || []).length <= 1 && !String(c.channelKey || '').startsWith('owner:')).sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0))[0];
  const soloChat = p0 === 'a' ? soloFor(p1) : null;
  const homeAgent = useMemo(() => {
    const live = S.agents.filter(a => !a.archived);
    const last = [...S.chats].sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0)).find(c => live.some(a => a.id === c.agentId));
    return live.find(a => a.id === last?.agentId) || live[0];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- escolhido ao entrar no Início; não troca no meio da digitação
  }, [S.agents.length, parts.join('/')]);
  const page =
    p0 === 'c' ? <Chat key="chat" chatId={p1} /> :
    p0 === 'a' ? (soloChat ? <Chat key="chat" chatId={soloChat.id} /> : <Chat key="chat" agentId={p1} />) :
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
    (!homeAgent ? <Home /> : soloFor(homeAgent.id) ? <Chat key="chat" chatId={soloFor(homeAgent.id).id} /> : <Chat key="chat" agentId={homeAgent.id} />);

  const hubPage = !overlayOpen ? null :
    parts[0] === 'marketplace' ? <Marketplace /> :
    parts[0] === 'connectors' ? <Connectors /> :
    parts[0] === 'skills' ? <SkillsHub /> :
    parts[0] === 'explore' ? <Explore /> :
    parts[0] === 'ajuda' ? <Help /> :
    parts[0] === 'saude' ? <Health onClose={closeHub} /> :
    parts[0] === 'settings' ? <div className="hub-settings"><button className="icon-btn hub-close" aria-label="Fechar" onClick={closeHub}><Icon name="x" /></button><Settings theme={theme} toggleTheme={toggleTheme} tab={parts[1]} /></div> : <Integrations />;

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
      {hubPage && (
        <div className="hub-overlay" onMouseDown={e => e.target === e.currentTarget && closeHub()}>
          <div className="hub-modal" role="dialog" aria-modal="true" aria-label={parts[0] === 'settings' ? t('nav.settings') : parts[0] === 'saude' ? 'Saúde do Ripper' : 'Marketplace'}>
            <Suspense fallback={<div className="page-loading"><ThinkingOrb state="breathing" size={20} /></div>}>{hubPage}</Suspense>
          </div>
        </div>
      )}
      <ApprovalTray />
      <FirstRunWizard />
      <Palette open={palette} onClose={() => setPalette(false)} toggleTheme={toggleTheme} />
    </div>
  );
}

export default function App() {
  return <ToastProvider><Provider><OverlayProvider><Shell /></OverlayProvider></Provider></ToastProvider>;
}
