import { useEffect, useMemo, useRef, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import { api, fmtAgo, TOOL_INFO } from './lib.js';
import { AgentAvatar, Icon, Menu, Segmented, StatusDot } from './ui.jsx';
import { useApp } from './app.jsx';
import { uploadFile } from './composer.jsx';
import { ResizeHandle } from './resize.jsx';
import { AutonomySemaphore, autonomyMeta } from './autonomy.jsx';
import { ArtifactList } from './actions.jsx';
import ConversationMedia from './ConversationMedia.jsx';
import { consumeLiveTabOpen, doingLine, isLiveScreenTool, liveScreenAutoKey, liveScreenStep, shouldAutoConnect, shouldHandleLiveScreenEscape, shouldRetryConnect } from './liveScreenLogic.js';
export { doingLine };
const COMP_LABEL = { running: 'Ligado', stopped: 'Parado', 'not started': 'Ainda não iniciado', local: 'Pasta local', off: 'Desligado', 'no key': 'Falta a chave do boat.dev', unknown: 'Sem resposta da VM' };

/** Engrenagem: as ferramentas de cada agente ficam "anexadas" aqui, sem ocupar o painel. */
function ToolsMenu({ members }) {
  return (
    <Menu align="right" className="tools-menu" trigger={({ toggle, open }) => (
      <button className="icon-btn" onClick={toggle} aria-expanded={open} aria-label="Ferramentas e configurações" title="Ferramentas e configurações"><Icon name="gear" /></button>
    )}>
      <div className="tools-pop">
        {members.map(a => (
          <div key={a.id} className="tools-agent">
            <div className="tools-agent-head"><AgentAvatar agent={a} size={22} paused /><b>{a.name}</b>
              <a role="menuitem" className="tools-edit" href={`#/agents/${a.id}/settings`}>Configurar</a></div>
            <ul>
              {Object.entries(TOOL_INFO).map(([k, t]) => {
                const on = a.tools.includes(k);
                return <li key={k} className={on ? 'on' : ''}><Icon name={t.icon} size={15} /><span>{t.label}</span><small>{on ? 'Ligada' : 'Desligada'}</small></li>;
              })}
            </ul>
            <a role="menuitem" className="tools-more" href={`#/agents/${a.id}/settings?tab=tools`}><Icon name="plus" size={14} />Gerenciar ferramentas</a>
          </div>
        ))}
      </div>
    </Menu>
  );
}

/** O que este agente faz e decide sozinho — o que importa durante a conversa. Modelo fica no composer. */
function AgentBrief({ a, S }) {
  const auto = autonomyMeta(a.autonomyLevel);
  const routines = S.routines.filter(r => r.agentId === a.id).length;
  return <>
    <p className="panel-label">Pode fazer aqui</p>
    <ul className="cap-chips">{Object.entries(TOOL_INFO).filter(([k]) => a.tools.includes(k)).map(([k, t]) => (
      <li key={k} title={t.desc}><Icon name={t.icon} size={14} />{t.label}</li>
    ))}</ul>
    <p className="panel-label">Autonomia</p>
    <div className="autonomy-brief"><AutonomySemaphore level={a.autonomyLevel} settings={S.settings} /><small>{auto.desc}</small></div>
    {routines > 0 && <p className="muted small"><Icon name="clock" size={13} /> {routines} rotina{routines > 1 ? 's' : ''} ativa{routines > 1 ? 's' : ''}</p>}
  </>;
}

function Details({ members, project, S, working = {} }) {
  const group = members.length > 1;
  const solo = !group && doingLine(working[members[0].id]);
  return (
    <div className="panel-tab">
      {group ? <>
        <ul className="member-list">
          {members.map(a => (
            <li key={a.id}><AgentAvatar agent={a} size={30} paused /><span><b>{a.name}</b><small className={working[a.id] ? 'is-working' : ''} title={doingLine(working[a.id]) || undefined}>{doingLine(working[a.id]) || a.description || a.category}</small></span>
              <a className="icon-btn sm" href={`#/agents/${a.id}/settings`} aria-label={`Configurar ${a.name}`} title="Configurar"><Icon name="gear" size={15} /></a></li>
          ))}
        </ul>
        <p className="panel-note">Quem responde é escolhido pelo pedido. Escreva <b>@Nome</b> para chamar alguém direto; eles também passam tarefas entre si.</p>
      </> : <>
        {solo && <p className="panel-note is-working" aria-live="polite"><b>Agora:</b> {solo}</p>}
        <p className="panel-desc">{members[0].description || 'Sem descrição.'}</p>
        <AgentBrief a={members[0]} S={S} />
      </>}
      {project && <p className="panel-project"><Icon name="folder" size={14} /> Projeto <a className="link" href={`#/p/${project.id}`}>{project.name}</a></p>}
      {!group && <a className="btn btn-block btn-sm" href={`#/agents/${members[0].id}/settings`}><Icon name="gear" size={14} />Configurar {members[0].name}</a>}
    </div>
  );
}

function Files({ members, project, chatId, files, refresh, toast }) {
  const input = useRef(null);
  async function add(list) {
    for (const f of list) { try { await uploadFile(members[0].id, chatId, f, project?.id); } catch (e) { toast(e.message, 'error'); } }
    refresh();
  }
  const emptyHint = `Nenhum arquivo nesta conversa.${members.length > 1 ? ' Todos os participantes veem o que for enviado.' : ''}`;
  return (
    <>
      <ConversationMedia
        files={files}
        canUpload={!!chatId}
        emptyHint={emptyHint}
        onAdd={() => input.current?.click()}
        onRemove={f => api(`/api/files/${f.id}`, { method: 'DELETE' }).then(refresh)}
      />
      <input ref={input} type="file" multiple hidden onChange={e => { add([...e.target.files]); e.target.value = ''; }} />
    </>
  );
}

/**
 * Tela ao vivo do computador (noVNC) — um componente só, em dois modos:
 * painel (aba Computador) e miniatura flutuante. Liga só enquanto o agente
 * usa a tela agora (não ao abrir conversa antiga). O passo atual fica por cima.
 */
function AgentLiveScreen({ agent, working, variant = 'panel', onClose, messages, step: stepProp, autoConnect = false }) {
  const { working: workingNow } = useApp();
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(null);
  const [control, setControl] = useState(false);
  const [big, setBig] = useState(false);
  const [loading, setLoading] = useState(false);
  const tried = useRef('');
  const rootRef = useRef(null);
  const fullRef = useRef(null);
  const closeBtn = useRef(null);
  const float = variant === 'float';
  const live = shouldAutoConnect({ working, autoConnect });
  const step = useMemo(
    () => liveScreenStep({ working: workingNow, messages, agentId: agent.id, busy: working, step: stepProp }),
    [workingNow, messages, agent.id, working, stepProp]
  );
  const closeFull = () => { setBig(false); setControl(false); };

  async function connect(fromUser = false) {
    if (!shouldRetryConnect({ url, loading, err, live, alreadyTried: tried.current === agent.id, fromUser })) return;
    tried.current = agent.id;
    setLoading(true); setErr(null);
    try { setUrl((await api(`/api/agents/${agent.id}/vnc`)).url); }
    catch (e) { setErr(e.message); setUrl(null); }
    setLoading(false);
  }
  useEffect(() => {
    if (!live) { tried.current = ''; return undefined; }
    if (!shouldRetryConnect({ url: null, loading: false, err: null, live, alreadyTried: false, fromUser: false })) return undefined;
    let gone = false;
    tried.current = agent.id;
    setLoading(true); setErr(null); setUrl(null);
    api(`/api/agents/${agent.id}/vnc`).then(
      r => { if (!gone) setUrl(r.url); },
      e => { if (!gone) { setErr(e.message); setUrl(null); } }
    ).finally(() => { if (!gone) setLoading(false); });
    return () => { gone = true; };
  }, [live, agent.id]);
  useEffect(() => {
    const onKey = e => {
      const inside = !!(rootRef.current?.contains(document.activeElement) || fullRef.current?.contains(document.activeElement));
      const action = shouldHandleLiveScreenEscape({ key: e.key, big, float, focusInside: inside });
      if (!action) return;
      e.preventDefault();
      if (big) e.stopPropagation();
      if (action === 'close-full') closeFull();
      else onClose?.();
    };
    addEventListener('keydown', onKey, big);
    return () => removeEventListener('keydown', onKey, big);
  }, [big, float, onClose]);
  useEffect(() => {
    if (!big) return;
    const prev = document.activeElement;
    closeBtn.current?.focus();
    const onTab = e => {
      if (e.key !== 'Tab' || !fullRef.current) return;
      const nodes = [...fullRef.current.querySelectorAll('button, [href], iframe')].filter(el => !el.disabled);
      if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onTab, true);
    return () => {
      document.removeEventListener('keydown', onTab, true);
      if (prev?.focus) prev.focus();
    };
  }, [big]);

  const canControl = float ? big && control : control;
  const src = url && `${url}&view_only=${canControl ? 0 : 1}`;
  const frame = src && <iframe key={src} src={src} title={`Tela de ${agent.name}`} allow="clipboard-read; clipboard-write" tabIndex={float && !big ? -1 : undefined} />;
  const idle = err || (big ? 'Aberta em tela cheia.' : loading ? 'Ligando o computador…' : live ? 'Ligando a tela…' : `Veja a tela do computador de ${agent.name} quando ele estiver usando.`);
  const overlay = step && !big && (
    <p className="live-screen-step" aria-live="polite">
      {working && <span className="live-dot" aria-hidden="true" />}
      <span>{step}</span>
    </p>
  );
  const retry = !url && !big && (
    <button type="button" className="btn btn-sm" onClick={() => connect(true)} disabled={loading}>
      {loading ? 'Ligando o computador…' : err ? 'Tentar de novo' : 'Ver tela ao vivo'}
    </button>
  );

  return <>
    {float ? (
      <aside ref={rootRef} tabIndex={-1} className={`live-screen live-screen-float mini-screen ${working ? 'live' : ''}`} data-live-screen="float" aria-label={`Tela de ${agent.name} ao vivo`}
        onPointerDown={e => e.currentTarget.focus({ preventScroll: true })}>
        <div className="live-screen-bar mini-screen-bar">
          {working && <span className="live-dot" aria-hidden="true" />}
          <span className="grow">{agent.name}{working ? ' · na tela' : ''}</span>
          <button type="button" className="icon-btn sm" onClick={() => setBig(true)} aria-label="Tela cheia"><Icon name="share" size={13} /></button>
          {onClose && <button type="button" className="icon-btn sm" onClick={onClose} aria-label="Fechar a tela"><Icon name="x" size={13} /></button>}
        </div>
        <div className="live-screen-body">
          {frame && !big ? frame : <p className="mini-screen-msg">{idle}</p>}
          {frame && !big && overlay}
          {!frame && !big && <div className="vnc-off">{retry}</div>}
        </div>
      </aside>
    ) : (
      <div ref={rootRef} className={`live-screen live-screen-panel agent-screen live-vnc ${working ? 'live' : ''} ${control ? 'controlling' : ''}`} data-live-screen="panel">
        <div className="pc-bar">
          <i /><i /><i /><span>tela · {agent.name}</span>
          {working && <span className="live-dot">trabalhando</span>}
          {url && <>
            <button type="button" className={`vnc-btn ${control ? 'on' : ''}`} onClick={() => setControl(c => !c)} title={control ? 'Voltar a só assistir' : 'Usar mouse e teclado no computador'}>
              <Icon name={control ? 'x' : 'edit'} size={12} />{control ? 'Soltar controle' : 'Assumir controle'}
            </button>
            <button type="button" className="vnc-btn icon" onClick={() => setBig(true)} title="Tela cheia" aria-label="Tela cheia"><Icon name="share" size={12} /></button>
          </>}
        </div>
        <div className="live-screen-body">
          {frame && !big ? frame : (
            <div className="vnc-off">
              <p className="pc-idle">{idle}</p>
              {retry}
            </div>
          )}
          {overlay}
        </div>
      </div>
    )}
    {big && (
      <div ref={fullRef} className="vnc-full" role="dialog" aria-modal="true" aria-label={`Tela de ${agent.name}`} onClick={e => { if (e.target === e.currentTarget) closeFull(); }}>
        <div className="vnc-full-bar">
          <b>Tela de {agent.name}</b>
          {working && <span className="live-dot">trabalhando</span>}
          {step && <span className="live-screen-step-inline">{step}</span>}
          <div className="grow" />
          <button type="button" className={`btn btn-sm ${control ? 'btn-primary' : ''}`} onClick={() => setControl(c => !c)}>{control ? 'Soltar controle' : 'Assumir controle'}</button>
          <button type="button" ref={closeBtn} className="btn btn-sm" onClick={closeFull}><Icon name="x" size={14} />Fechar</button>
        </div>
        {frame}
        {step && <p className="live-screen-step live-screen-step-full" aria-live="polite">{step}</p>}
        <p className="vnc-hint">{control ? 'Você está no controle: mouse e teclado vão para o computador. Mostre a tarefa e depois peça ao agente para repetir.' : 'Só assistindo. Clique em “Assumir controle” para usar mouse e teclado.'}</p>
      </div>
    )}
  </>;
}

/** A "tela" do computador: estado da VM e o que o agente executou nesta conversa. */
function Computer({ members, messages, busy, S_mode }) {
  const withPc = members.filter(a => a.tools.includes('computer'));
  const [status, setStatus] = useState({});
  useEffect(() => {
    let alive = true;
    const load = () => Promise.all(withPc.map(a => api(`/api/agents/${a.id}/computer`).then(r => [a.id, r]).catch(() => [a.id, { status: 'unknown' }])))
      .then(r => alive && setStatus(Object.fromEntries(r)));
    load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, [withPc.map(a => a.id).join()]);
  const log = useMemo(() => messages.flatMap(m => (m.steps || [])
    .filter(s => isLiveScreenTool(s.tool))
    .map(s => ({ ...s, agentId: m.agentId, at: s.at || m.at }))), [messages]);
  const screen = useRef(null);
  useEffect(() => { screen.current?.scrollTo({ top: 1e9 }); }, [log.length]);

  if (!withPc.length) return (
    <div className="panel-tab"><div className="pc-empty"><Icon name="terminal" size={22} /><b>Sem computador</b><p>Ligue a ferramenta Computador nas configurações do agente para ele instalar, rodar e mostrar coisas aqui.</p></div></div>
  );
  const working = withPc.some(a => busy[a.id]);
  return (
    <div className="panel-tab">
      {withPc.map(a => {
        const st = status[a.id];
        return (
          <div key={a.id} className="pc-status">
            <AgentAvatar agent={a} size={20} paused />
            <span>{a.name}</span>
            <small className={`comp comp-${(st?.status || '').replace(' ', '-')}`}>{st ? COMP_LABEL[st.status] || st.status : '…'}</small>
          </div>
        );
      })}
      {S_mode === 'docker' && withPc.map(a => <AgentLiveScreen key={a.id} agent={a} working={!!busy[a.id]} messages={messages} autoConnect={!!busy[a.id]} />)}
      <div className={`pc-screen ${working ? 'live' : ''}`} ref={screen} aria-label="Tela do computador" role="log">
        <div className="pc-bar"><i /><i /><i /><span>{withPc.length > 1 ? 'computadores' : withPc[0].name.toLowerCase().replace(/\s+/g, '-')}</span>{working && <ThinkingOrb state="working" size={20} />}</div>
        {log.length === 0
          ? <p className="pc-idle">{working ? 'Aguardando comandos…' : 'Nada executado nesta conversa ainda. Quando o agente usar o computador, os comandos aparecem aqui ao vivo.'}</p>
          : log.map((s, i) => (
            <div key={i} className="pc-line">
              <span className="pc-prompt">{s.tool === 'computer_share' ? 'link' : s.tool?.startsWith('browser_') ? 'web' : '$'}</span>
              <code>{s.detail || s.tool}</code>
              <time>{fmtAgo(s.at)}</time>
            </div>
          ))}
      </div>
      {S_mode !== 'docker' && <p className="muted small">A tela ao vivo precisa do computador em modo Docker (Configurações → Computador).</p>}
    </div>
  );
}

export default function ChatPanel({ members, project, chatId, messages, files, onCollapse }) {
  const { S, refresh, toast, busy: busyAgents, busyChats, working: workingNow } = useApp();
  // Nesta tela, "trabalhando" é desta conversa (não de outra em que o agente esteja).
  const busy = chatId && busyChats[chatId] ? busyAgents : {};
  const [tab, setTab] = useState('details');
  const memberKey = members.map(x => x.id).join();
  const liveKey = useMemo(
    () => liveScreenAutoKey({ messages, working: workingNow, busy, agentIds: memberKey ? memberKey.split(',') : [] }),
    [messages, workingNow, busy, memberKey]
  );
  const openedLive = useRef('');
  useEffect(() => { openedLive.current = ''; }, [chatId]);
  useEffect(() => { const show = () => setTab('computer'); addEventListener('ripper:computer', show); return () => removeEventListener('ripper:computer', show); }, []);
  useEffect(() => {
    if (S.settings.computer?.mode !== 'docker') return;
    const next = consumeLiveTabOpen(openedLive.current, liveKey);
    openedLive.current = next.openedKey;
    if (next.open) setTab('computer');
  }, [liveKey, S.settings.computer?.mode]);
  const group = members.length > 1, a = members[0];
  const working = members.some(x => busy[x.id]);
  const arts = S.artifacts.filter(x => project ? x.projectId === project.id : chatId && x.chatId === chatId);
  return (
    <aside className="agent-panel v2" data-resizable aria-label={group ? 'Conversa em grupo' : `Sobre ${a.name}`}>
      <ResizeHandle side="right" cssVar="panel-w" min={280} max={620} label="Largura do painel" onCollapse={onCollapse} />
      <div className="panel-tools">
        <ToolsMenu members={members} />
        <button className="icon-btn" onClick={onCollapse} aria-label="Recolher painel" title="Recolher painel"><Icon name="sidebar" /></button>
      </div>
      <div className="panel-profile">
        {group ? <span className="avatar-stack lg">{members.slice(0, 3).map(x => <AgentAvatar key={x.id} agent={x} size={56} state={busy[x.id] ? 'working' : undefined} />)}</span>
          : <AgentAvatar agent={a} size={88} state={working ? 'working' : undefined} />}
        <h2>{group ? 'Grupo' : a.name}</h2>
        {!group && a.description && <p className="panel-role">{a.description}</p>}
        {working ? <span className="status status-online"><i />respondendo…</span> : group ? <small className="muted">{members.length} agentes</small> : <StatusDot status={a.status} />}
      </div>
      <Segmented label="Seções do painel" value={tab} onChange={setTab} size="sm" className="panel-tabs"
        items={[['details', 'Detalhes'], ['artifacts', 'Artefatos', arts.length || null], ['files', 'Arquivos', files.length || null], ['computer', 'Computador']]} />
    {tab === 'details' && <Details members={members} project={project} S={S} working={workingNow} />}
      {tab === 'artifacts' && <div className="panel-tab">
        <ArtifactList items={arts} empty={project ? 'Nenhum artefato no projeto ainda. Peça: “salve isso como artefato”. Todos os agentes do projeto veem.' : 'Nenhum artefato ainda. Peça: “salve isso como artefato”.'} />
        {arts.length > 0 && <p className="muted small">{project ? 'Compartilhados com todos os agentes do projeto.' : 'Salvos nesta conversa.'}</p>}
      </div>}
      {tab === 'files' && <Files members={members} project={project} chatId={chatId} files={files} refresh={refresh} toast={toast} />}
      {tab === 'computer' && <Computer members={members} messages={messages} busy={busy} S_mode={S.settings.computer.mode} />}
    </aside>
  );
}

/**
 * Miniatura da tela do agente (canto da conversa). Mesmo componente da aba Computador.
 * Chat.jsx continua importando MiniScreen — a API { agent, working, onClose } não muda.
 */
export function MiniScreen(props) {
  return <AgentLiveScreen {...props} variant="float" />;
}
