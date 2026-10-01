import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import { api, go, fmtTime, fmtSize, STEP_LABEL, useMediaQuery, local, nameColor } from '../lib.js';
import { markdown, closeOpen } from '../markdown.js';
import { AgentAvatar, Icon, Menu, MenuItem, StatusDot, useConfirm, EmptyState } from '../ui.jsx';
import { useApp } from '../app.jsx';
import Composer, { uploadFile } from '../composer.jsx';
import { sessionPayload } from '../marketplace/sessionMcp.js';
import { effortLabel } from '../modelPicker.jsx';
import MessageAttachments from '../MessageAttachments.jsx';
import ChatPanel from '../chatPanel.jsx';
import { ResizeHandle } from '../resize.jsx';
import ActionLine from '../actionLine.jsx';
import { useChatMenu } from '../actions.jsx';
import { useOv } from '../overlay.jsx';
import { botAvatarPalette } from 'bot-avatars';
import { FirstRunChecklist } from '../firstRunChecklist.jsx';

const agentColor = a => nameColor(a, botAvatarPalette);
// Qual "verbo" o orb mostra para cada fase da resposta.
const ORB = { route: 'connecting', WebSearch: 'searching', WebFetch: 'searching', computer_exec: 'working', computer_share: 'working', remember: 'weaving', schedule_routine: 'shaping', think: 'solving', text: 'composing' };

/**
 * Digitação suave: o texto chega em rajadas da rede, mas aparece num ritmo constante.
 * Quanto mais atrasado, mais rápido alcança; nunca trava a thread (um passo por quadro).
 */
function useSmoothText(target, live) {
  const [shown, setShown] = useState(live ? '' : target);
  const ref = useRef({ target, len: live ? 0 : target.length });
  ref.current.target = target;
  useEffect(() => {
    if (!live) { ref.current.len = target.length; setShown(target); return; }
    let raf;
    const tick = () => {
      const r = ref.current, behind = r.target.length - r.len;
      if (behind > 0) {
        r.len += Math.max(1, Math.ceil(behind / 10));
        setShown(r.target.slice(0, r.len));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live]);
  useEffect(() => { if (!live) setShown(target); }, [target, live]);
  return shown;
}

function Markdown({ text, live }) {
  // Markdown só é recalculado quando o texto muda; mensagens antigas nunca são refeitas.
  const html = useMemo(() => markdown(text), [text]);
  const onClick = e => {
    const b = e.target.closest('[data-copy]');
    if (b) { navigator.clipboard.writeText(b.closest('.code').querySelector('code').textContent); b.lastChild.textContent = 'Copiado'; setTimeout(() => (b.lastChild.textContent = 'Copiar'), 1400); }
  };
  return <div className={`md ${live ? 'streaming' : ''}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}

function LiveText({ text }) {
  const shown = useSmoothText(text, true);
  return shown ? <Markdown text={closeOpen(shown)} live /> : null;
}

const BotMessage = memo(function BotMessage({ m, agent, live, phase, onRetry, models, group }) {
  return (
    <div className="msg bot">
      <div className="msg-av"><AgentAvatar agent={agent} size={36} state={live ? 'working' : undefined} paused={!live} /></div>
      <div className="msg-col">
        {group && <span className="speaker" style={{ color: agentColor(agent) }}>{agent.name}</span>}
        <div className="bubble bot-bubble">
          <ActionLine steps={m.steps} live={live} />
          {m.content ? (live ? <LiveText text={m.content} /> : <Markdown text={m.content} />)
            : live ? <div className="thinking"><ThinkingOrb state={ORB[phase] || 'breathing'} size={20} /><span>{phase === 'route' ? 'Escolhendo o melhor modelo…' : phase === 'think' ? 'Pensando com calma…' : phase === 'approval' ? 'Aguardando sua aprovação…' : 'Pensando…'}</span></div>
            : m.error ? <p className="msg-error">Não consegui responder. {m.error}</p>
            : m.stopped ? <p className="muted">Resposta interrompida.</p> : null}
        </div>
        <div className="msg-meta">
          {m.at && <time>{fmtTime(m.at)}</time>}
          {m.via?.type === 'inbox' && <a className="badge via" href={`#/c/${m.via.threadChatId}`} title="Abrir a troca entre os agentes"><Icon name="chat" size={12} />Resposta por mensagem</a>}
          {m.model && <span className="badge">{m.routed ? 'Auto → ' : ''}{models[m.model]?.label || m.model}{m.effort && m.effort !== 'auto' ? ` · ${effortLabel(m.effort)}` : ''}</span>}
          {!live && m.content && <>
            <button className="meta-btn" onClick={() => navigator.clipboard.writeText(m.content)}><Icon name="copy" size={14} />Copiar</button>
            {onRetry && <button className="meta-btn" onClick={onRetry}><Icon name="retry" size={14} />Refazer</button>}
          </>}
        </div>
      </div>
    </div>
  );
}, (a, b) => a.m === b.m && a.agent === b.agent && a.live === b.live && a.phase === b.phase && a.group === b.group && a.models === b.models && !!a.onRetry === !!b.onRetry);

function InboxMessage({ m, from }) {
  return (
    <div className="msg inbox-msg">
      <div className="msg-av"><AgentAvatar agent={from} size={30} paused /></div>
      <div className="msg-col">
        <span className="speaker" style={{ color: agentColor(from) }}>{from?.name || 'Agente'} enviou{m.inbox.priority === 'now' ? ' · urgente' : ''}</span>
        <div className="bubble inbox-bubble">{m.content.replace(/^\[Mensagem de [^\]]+\]\n/, '').replace(/\n\nResponda de forma direta[\s\S]*$/, '')}</div>
        {m.at && <time className="msg-time">{fmtTime(m.at)}</time>}
      </div>
    </div>
  );
}

const UserMessage = memo(function UserMessage({ m, name, files }) {
  // Prévias locais (recém-enviadas) ou os arquivos já salvos no servidor.
  const mine = m.previews || (m.files || []).map(id => files.find(f => f.id === id)).filter(Boolean).map(f => ({ ...f, url: `/api/files/${f.id}` }));
  const hasFiles = mine.length > 0;
  return (
    <div className="msg user">
      <div className="msg-col">
        {hasFiles && <MessageAttachments items={mine} />}
        {m.content && <div className="bubble user-bubble">{m.content}</div>}
        {m.at && <time className="msg-time">{fmtTime(m.at)}</time>}
      </div>
      <span className="initial">{(name || 'V')[0].toUpperCase()}</span>
    </div>
  );
});

export default function Chat({ chatId: initialId, agentId: initialAgent, projectId: initialProject, agentIds: initialMembers }) {
  const { S, agent: getAgent, refresh, toast, setBusy, busy, setBusyChats } = useApp();
  const chatMenu = useChatMenu();
  const ov = useOv();
  const [chat, setChat] = useState(null);
  const [chatId, setChatId] = useState(initialId || null);
  const [loading, setLoading] = useState(!!initialId);
  const [notFound, setNotFound] = useState(false);
  const [live, setLive] = useState(null); // mensagem em construção
  const [phase, setPhase] = useState(null);
  const [panel, setPanel] = useState(() => local.get('panel', true));
  const wide = useMediaQuery('(min-width: 1180px)');
  const ctrl = useRef(null), scroller = useRef(null), stick = useRef(true);
  const [confirm, confirmNode] = useConfirm();

  const memberIds = chat ? (chat.agentIds || [chat.agentId]) : initialMembers?.length ? initialMembers : [initialAgent];
  const members = memberIds.map(getAgent).filter(Boolean);
  const agent = members[0];
  const isGroup = members.length > 1;
  const projectId = chat?.projectId || initialProject;
  const project = projectId && S.projects.find(p => p.id === projectId);
  const nameOf = id => getAgent(id)?.name || 'Agente';
  // Modelo + esforço da conversa. Em grupo, o padrão é deixar cada agente com o seu.
  const defaults = (c, a, group) => ({ model: c?.model || (group ? 'agent' : a?.model || S.settings.defaultModel), effort: c?.effort || a?.effort || 'auto' });
  const [choice, setChoice] = useState(() => defaults(null, agent, isGroup));

  const idRef = useRef(chatId);
  idRef.current = chatId;
  // A mesma tela serve todas as conversas: troca de rota recarrega, a URL que nós mesmos
  // atualizamos ao criar a conversa não (senão a resposta em andamento seria perdida).
  useEffect(() => {
    if (initialId && initialId === idRef.current && chat) return;
    ctrl.current?.abort();
    setLive(null); setNotFound(false);
    setChatId(initialId || null);
    if (!initialId) { setChat(null); setLoading(false); setChoice(defaults(null, getAgent(initialAgent || initialMembers?.[0]), (initialMembers || []).length > 1)); return; }
    setLoading(true);
    let alive = true;
    api(`/api/chats/${initialId}`)
      .then(c => { if (!alive) return; if (c.unread === false && S.chats.find(x => x.id === c.id)?.unread) refresh(); setChat(c); setChoice(defaults(c, getAgent(c.agentId), (c.agentIds || []).length > 1)); })
      .catch(() => alive && setNotFound(true))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [initialId, initialAgent, initialProject, (initialMembers || []).join(',')]);
  useEffect(() => () => ctrl.current?.abort(), []);
  const waiting = chatId && S.pendingInbox?.[chatId];
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => {
      if (ctrl.current) return;
      try { const c = await api(`/api/chats/${chatId}`); setChat(c); } catch {}
      refresh();
    }, 4000);
    return () => clearInterval(t);
  }, [waiting, chatId]);
  // Ctrl+. recolhe/mostra o painel da direita.
  useEffect(() => {
    const k = e => { if ((e.ctrlKey || e.metaKey) && e.key === '.') { e.preventDefault(); setPanel(p => { local.set('panel', !p); return !p; }); } };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);

  // Mensagem vinda do Início.
  useEffect(() => {
    if (!initialAgent) return;
    const raw = sessionStorage.getItem('ripper.pending');
    if (!raw) return;
    sessionStorage.removeItem('ripper.pending');
    const p = JSON.parse(raw);
    if (p.agentId === initialAgent) { const ch = { model: p.model, effort: p.effort || 'auto' }; setChoice(ch); send(p, ch); }
  }, [initialAgent]);

  const onScroll = () => { const el = scroller.current; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; };
  useEffect(() => { if (stick.current) scroller.current?.scrollTo({ top: 1e9 }); }, [chat?.messages.length, live?.content, live?.steps?.length]);

  async function send({ text, fileIds = [], previews, mcpSession }, forceChoice) {
    const use = forceChoice || choice;
    if (ctrl.current || !agent) return;
    const userMsg = { id: 'u' + Date.now(), role: 'user', content: text, files: fileIds, previews, at: Date.now() };
    setChat(c => ({ ...(c || { title: 'Nova conversa', agentId: agent.id, agentIds: isGroup ? memberIds : undefined, projectId }), messages: [...(c?.messages || []), userMsg] }));
    let building = { role: 'assistant', agentId: agent.id, content: '', steps: [], at: Date.now() };
    setLive(building); setPhase(['xhigh', 'max'].includes(use.effort) ? 'think' : 'route');
    stick.current = true;
    const ac = new AbortController(); ctrl.current = ac;
    let cid = chatId, pending = false, finished = false;
    const flush = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; if (!finished) setLive({ ...building, steps: [...building.steps] }); }); };
    try {
      const res = await fetch('/api/chat', { method: 'POST', signal: ac.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId: agent.id, agentIds: isGroup ? memberIds : undefined, projectId, chatId: cid, text, fileIds, model: use.model, effort: use.effort, mcpSession: mcpSession || sessionPayload() }) });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = errBody.error || `Erro ${res.status}`;
        if (res.status === 429) throw new Error(msg);
        throw new Error(msg);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += value;
        const parts = buf.split('\n\n'); buf = parts.pop();
        for (const p of parts) {
          if (!p.startsWith('data: ')) continue;
          const e = JSON.parse(p.slice(6));
          if (e.chatId) setBusyChats(b => ({ ...b, [e.chatId]: true }));
          if (e.chatId && !cid) { cid = e.chatId; idRef.current = cid; setChatId(cid); location.hash = `/c/${cid}`; }
          if (e.speaker) {
            // Novo agente com a palavra: a bolha anterior vira mensagem e começa outra.
            if (!building.passed && (building.content || building.steps.length)) { const done = building; setChat(c => ({ ...c, messages: [...c.messages, done] })); }
            building = { role: 'assistant', agentId: e.speaker, content: '', steps: [], at: Date.now() };
            setBusy(b => ({ ...b, [e.speaker]: true })); setPhase('route');
          }
          if (e.passed) { building = { role: 'assistant', agentId: e.passed, content: '', steps: [], at: Date.now(), passed: true }; }
          if (e.turnDone) setBusy(b => { const n = { ...b }; delete n[e.turnDone]; return n; });
          if (e.route) { building.model = e.route.model; building.effort = e.route.effort; building.routed = e.route.by !== 'manual'; }
          if (e.tool) { building.steps.push({ kind: 'tool', tool: e.tool, label: STEP_LABEL[e.tool] || `Usando ${e.tool}`, detail: e.detail }); setPhase(e.tool); }
          if (e.handoff) {
            const lbl = S.models[e.handoff]?.label || e.handoff;
            const fromLbl = e.from && (getAgent(e.from)?.name || S.models[e.from]?.label);
            building.steps.push({ kind: 'warn', label: fromLbl ? `De ${fromLbl} para ${lbl}` : `Transferindo para ${lbl}` });
          }
          if (e.providerRetry) {
            const sec = Math.max(1, Math.round(e.providerRetry.waitMs / 1000));
            building.steps.push({ kind: 'warn', label: `Limite do provedor — tentativa ${e.providerRetry.attempt}/${e.providerRetry.maxAttempts} em ~${sec}s` });
          }
          if (e.delegated?.length) {
            const names = e.delegated.map(id => getAgent(id)?.name || 'colega').join(', ');
            building.steps.push({ kind: 'done', label: 'Palavra delegada', detail: names });
          }
          if (e.warn) building.steps.push({ kind: 'warn', label: e.warn });
          if (e.memory) building.steps.push({ kind: 'done', label: 'Guardado na memória', detail: e.memory });
          if (e.approval) { building.steps.push({ kind: 'approval', rec: e.approval, status: 'pending' }); setPhase('approval'); }
          if (e.approvalDone) { const st = building.steps.find(x => x.kind === 'approval' && x.rec.id === e.approvalDone.id); if (st) st.status = e.approvalDone.status; }
          if (e.sent) building.steps.push({ kind: 'done', label: `Mensagem enviada para ${e.sent.to}`, detail: e.sent.priority === 'now' ? 'urgente' : e.sent.priority === 'low' ? 'sem pressa' : 'normal' });
          if (e.artifact) building.steps.push({ kind: 'done', label: `Artefato salvo (v${e.artifact.version})`, detail: e.artifact.title });
          if (e.skill) building.steps.push({ kind: 'done', label: 'Skill guardada', detail: e.skill });
          if (e.routine) building.steps.push({ kind: 'done', label: 'Rotina criada', detail: e.routine });
          if (e.text) { building.content += e.text; setPhase('text'); }
          if (e.stopped) building.stopped = true;
          flush();
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') { building.error = err.message; toast(err.message, 'error'); }
      else building.stopped = true;
    } finally {
      finished = true;
      ctrl.current = null;
      setBusy(b => { const n = { ...b }; memberIds.forEach(id => delete n[id]); return n; });
      if (cid) setBusyChats(b => { const n = { ...b }; delete n[cid]; return n; });
      setLive(null); setPhase(null);
      if (cid) { try { setChat(await api(`/api/chats/${cid}`)); } catch { setChat(c => ({ ...c, messages: [...c.messages, building] })); } }
      else setChat(c => ({ ...c, messages: [...c.messages, building] }));
      refresh();
    }
  }

  if (loading) return <div className="page-loading" role="status" aria-live="polite" aria-label="Carregando conversa"><ThinkingOrb state="breathing" size={20} /></div>;
  if (notFound || !agent) return <div className="page"><EmptyState title="Conversa não encontrada" body="Ela pode ter sido apagada." action={<a className="btn" href="#/chats">Ver conversas</a>} /></div>;

  const messages = chat?.messages || [];
  const files = S.files.filter(f => f.chatId && f.chatId === chatId);
  const title = chat?.title || 'Nova conversa';
  const lastUser = [...messages].reverse().find(m => m.role === 'user');

  const showPanel = panel && wide;
  const togglePanel = () => { setPanel(!panel); local.set('panel', !panel); };
  function openMenu(e) {
    if (e.target.closest('a, button, input, textarea, .md code, .md pre')) return; // mantém o menu nativo em links e textos de código
    if (window.getSelection()?.toString()) return;                              // e quando há texto selecionado (para copiar)
    const extra = [
      { label: 'Nova conversa', icon: 'plus', onSelect: () => go(isGroup || project ? `/p/${projectId}/new?agents=${memberIds.join(',')}` : `/a/${agent.id}`) },
      wide && { label: panel ? 'Recolher painel' : 'Mostrar painel', icon: 'sidebar', hint: 'Ctrl .', onSelect: togglePanel }
    ];
    if (chatId && chat) chatMenu(e, { ...chat, id: chatId, title }, extra);
    else ov.menu(e, extra, 'Nova conversa');
  }

  return (
    <div className={`chat ${showPanel ? 'with-panel' : ''}`}>
      <div className="chat-main">
        <header className="chat-head" onContextMenu={openMenu}>
          <div className="chat-who">
            {project && <><a href={`#/p/${project.id}`} className="crumb-link project-crumb"><Icon name="folder" size={15} />{project.name}</a><Icon name="arrowR" size={13} className="crumb-sep" /></>}
            {isGroup
              ? <span className="who-group">
                  <span className="avatar-stack">{members.slice(0, 4).map(a => <AgentAvatar key={a.id} agent={a} size={22} paused={!busy[a.id]} state={busy[a.id] ? 'working' : undefined} />)}</span>
                  <span className="who-names">{members.map((a, i) => <span key={a.id} style={{ color: agentColor(a) }}>{a.name}{i < members.length - 1 ? ', ' : ''}</span>)}</span>
                </span>
              : <span className="who-one"><AgentAvatar agent={agent} size={24} state={live ? 'working' : undefined} paused={!live} /><b>{agent.name}</b><StatusDot status={agent.status} /></span>}
          </div>
        </header>

        <div className="thread" ref={scroller} onScroll={onScroll} onContextMenu={openMenu}>
          <div className="thread-inner">
            {messages.length === 0 && !live && (
              <div className="chat-empty">
                {isGroup ? <div className="avatar-stack xl">{members.slice(0, 5).map(a => <AgentAvatar key={a.id} agent={a} size={72} interactive />)}</div> : <AgentAvatar agent={agent} size={96} interactive />}
                <h2>{isGroup ? members.map(a => a.name).join(' · ') : agent.name}</h2>
                <p>{isGroup ? 'Fale com o time: quem é da área responde e chama os colegas quando precisa. Use @Nome para chamar alguém direto.' : agent.description || 'Pronto para ajudar.'}</p>
                {project && <p className="muted small">No projeto {project.name}: instruções e arquivos do projeto entram no contexto.</p>}
                {agent.status === 'paused' && <p className="note">Este agente está pausado: conversas funcionam, rotinas não.</p>}
                {!isGroup && <FirstRunChecklist settings={S.settings} agentCount={S.agents.length} />}
              </div>
            )}
            {messages.map((m, i) => m.inbox ? <InboxMessage key={m.id || i} m={m} from={getAgent(m.inbox.from)} /> : m.role === 'user'
              ? <UserMessage key={m.id || i} m={m} name={S.settings.name} files={S.files} />
              : <BotMessage key={m.id || i} m={m} agent={getAgent(m.agentId) || agent} group={isGroup || (!!m.agentId && m.agentId !== agent.id)} models={S.models} onRetry={m === messages.at(-1) && lastUser ? () => send({ text: lastUser.content }) : null} />)}
            {live && <BotMessage m={live} agent={getAgent(live.agentId) || agent} group={isGroup} live phase={phase} models={S.models} />}
          </div>
        </div>

        <div className="chat-dock">
          <Composer agent={agent} chatId={chatId} projectId={projectId} streaming={!!live} onSend={p => send(p)} onStop={() => { if (chatId) api(`/api/chats/${chatId}/cancel`, { method: 'POST' }).catch(() => {}); ctrl.current?.abort(); }}
            choice={choice} setChoice={setChoice} group={isGroup} mentions={isGroup ? members : null}
            placeholder={isGroup ? 'Mensagem para o grupo… use @Nome para chamar alguém' : `Mensagem para ${agent.name}…`} autoFocus draftKey={chatId || 'new-' + memberIds.join('-')} />
          {waiting > 0 && <p className="inbox-wait"><Icon name="clock" size={13} />Aguardando {waiting === 1 ? 'resposta de 1 mensagem' : `respostas de ${waiting} mensagens`} enviadas a colegas…</p>}
          <p className="fine">{isGroup ? 'Agentes' : `O ${agent.name}`} pode{isGroup ? 'm' : ''} errar. Confira o que for importante.</p>
        </div>
      </div>
      {!showPanel && wide && <div className="panel-collapsed-edge"><ResizeHandle side="right" cssVar="panel-w" min={280} max={620} collapsed label="Abrir painel" onExpand={togglePanel} /><button className="panel-reopen" onClick={togglePanel} aria-label="Mostrar painel" title="Mostrar painel (Ctrl .)"><Icon name="sidebar" size={16} style={{ transform: 'scaleX(-1)' }} /></button></div>}
      {showPanel && <ChatPanel members={members} project={project} chatId={chatId} messages={messages} files={files} onCollapse={() => { setPanel(false); local.set('panel', false); }} />}
      {confirmNode}
    </div>
  );
}
