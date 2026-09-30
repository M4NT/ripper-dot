import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import { api, go, fmtTime, fmtSize, TOOL_INFO, STEP_LABEL, useMediaQuery, local } from '../lib.js';
import { markdown, closeOpen } from '../markdown.js';
import { AgentAvatar, Icon, Menu, MenuItem, StatusDot, useConfirm, EmptyState } from '../ui.jsx';
import { useApp } from '../app.jsx';
import Composer, { uploadFile } from '../composer.jsx';
import { effortLabel } from '../modelPicker.jsx';
import FileThumb from '../fileThumb.jsx';

const isImage = t => /^image\/(png|jpe?g|webp|gif)$/.test(t);
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

function Steps({ steps, live }) {
  if (!steps?.length) return null;
  return (
    <ol className="steps">
      {steps.map((s, i) => {
        const running = live && i === steps.length - 1 && s.kind === 'tool';
        return (
          <li key={i} className={`step step-${s.kind} ${running ? 'running' : ''}`}>
            {running ? <ThinkingOrb state={ORB[s.tool] || 'working'} size={20} /> : <Icon name={s.kind === 'warn' ? 'x' : 'check'} size={13} />}
            <span>{s.label}</span>{s.detail && <code>{s.detail}</code>}
          </li>
        );
      })}
    </ol>
  );
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
        {group && <span className="speaker">{agent.name}</span>}
        <div className="bubble bot-bubble">
          <Steps steps={m.steps} live={live} />
          {m.content ? (live ? <LiveText text={m.content} /> : <Markdown text={m.content} />)
            : live ? <div className="thinking"><ThinkingOrb state={ORB[phase] || 'breathing'} size={20} /><span>{phase === 'route' ? 'Escolhendo o melhor modelo…' : phase === 'think' ? 'Pensando com calma…' : 'Pensando…'}</span></div>
            : m.error ? <p className="msg-error">Não consegui responder. {m.error}</p>
            : m.stopped ? <p className="muted">Resposta interrompida.</p> : null}
        </div>
        <div className="msg-meta">
          {m.at && <time>{fmtTime(m.at)}</time>}
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

const UserMessage = memo(function UserMessage({ m, name, files }) {
  // Prévias locais (recém-enviadas) ou os arquivos já salvos no servidor.
  const mine = m.previews || (m.files || []).map(id => files.find(f => f.id === id)).filter(Boolean).map(f => ({ ...f, url: `/api/files/${f.id}` }));
  const imgs = mine.filter(f => isImage(f.type)), others = mine.filter(f => !isImage(f.type));
  return (
    <div className="msg user">
      <div className="msg-col">
        {imgs.length > 0 && (
          <div className="msg-images">
            {imgs.map(f => <a key={f.id || f.url} href={f.url} target="_blank" rel="noreferrer" className="msg-image"><img src={f.url} alt={f.name} loading="lazy" /></a>)}
          </div>
        )}
        {m.content && <div className="bubble user-bubble">{m.content}</div>}
        {others.length > 0 && <div className="msg-files">{others.map(f => <a key={f.id || f.url} href={f.url} target="_blank" rel="noreferrer" className="attach"><Icon name="file" size={14} />{f.name}</a>)}</div>}
        {m.at && <time className="msg-time">{fmtTime(m.at)}</time>}
      </div>
      <span className="initial">{(name || 'V')[0].toUpperCase()}</span>
    </div>
  );
});

function AgentPanel({ agent, chatId, projectId, files, onClose, refresh, toast }) {
  const { S } = useApp();
  const [computer, setComputer] = useState(null);
  const input = useRef(null);
  useEffect(() => { api(`/api/agents/${agent.id}/computer`).then(setComputer).catch(() => {}); }, [agent.id]);
  const routines = S.routines.filter(r => r.agentId === agent.id);
  const compLabel = { ready: 'Ligado', running: 'Ligado', archived: 'Parado', provisioning: 'Iniciando', 'not started': 'Ainda não iniciado', local: 'Pasta local', off: 'Desligado', 'no key': 'Falta a chave do boat.dev' };
  async function add(list) {
    for (const f of list) { try { await uploadFile(agent.id, chatId, f, projectId); } catch (e) { toast(e.message, 'error'); } }
    refresh();
  }
  return (
    <aside className="agent-panel" aria-label={`Sobre ${agent.name}`}>
      <div className="panel-top">
        <AgentAvatar agent={agent} size={72} interactive />
        {onClose && <button className="icon-btn" onClick={onClose} aria-label="Fechar painel"><Icon name="x" /></button>}
      </div>
      <h2>{agent.name}</h2>
      <StatusDot status={agent.status} />
      {agent.description && <p className="panel-desc">{agent.description}</p>}
      <a className="btn btn-block" href={`#/agents/${agent.id}/settings`}><Icon name="gear" size={16} />Configurar agente</a>

      <p className="panel-label">Ferramentas</p>
      <ul className="tool-list">
        {agent.tools.map(t => (
          <li key={t}><Icon name={TOOL_INFO[t].icon} size={16} /><span>{TOOL_INFO[t].label}</span>
            {t === 'computer' && computer && <small className={`comp comp-${computer.status.replace(' ', '-')}`}>{compLabel[computer.status] || computer.status}</small>}
            {t === 'routines' && routines.length > 0 && <small>{routines.length}</small>}
          </li>
        ))}
        <li><a href={`#/agents/${agent.id}/settings?tab=tools`} className="tool-more"><Icon name="plus" size={16} />Mais ferramentas</a></li>
      </ul>

      <p className="panel-label">Arquivos desta conversa</p>
      <ul className="file-list">
        {files.length === 0 && <li className="muted small">Nenhum arquivo ainda.</li>}
        {files.map(f => (
          <li key={f.id}>
            {isImage(f.type) ? <FileThumb src={`/api/files/${f.id}`} /> : <span className="thumb file-ico"><Icon name="file" size={18} /></span>}
            <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer"><b>{f.name}</b><small>{fmtSize(f.size)} · {fmtTime(f.createdAt)}</small></a>
            <Menu align="right" trigger={({ toggle }) => <button className="icon-btn sm" onClick={toggle} aria-label={`Opções de ${f.name}`}><Icon name="more" /></button>}>
              <MenuItem icon="download" onClick={() => window.open(`/api/files/${f.id}`, '_blank')}>Baixar</MenuItem>
              <MenuItem icon="trash" danger onClick={() => api(`/api/files/${f.id}`, { method: 'DELETE' }).then(refresh)}>Remover</MenuItem>
            </Menu>
          </li>
        ))}
      </ul>
      <button className="btn btn-block btn-ghost-line" onClick={() => input.current.click()} disabled={!chatId}><Icon name="plus" size={16} />Adicionar arquivo</button>
      <input ref={input} type="file" multiple hidden onChange={e => { add([...e.target.files]); e.target.value = ''; }} />
    </aside>
  );
}

function GroupPanel({ members, project, chatId, files, refresh, toast, busy }) {
  const input = useRef(null);
  async function add(list) {
    for (const f of list) { try { await uploadFile(members[0].id, chatId, f, project?.id); } catch (e) { toast(e.message, 'error'); } }
    refresh();
  }
  return (
    <aside className="agent-panel" aria-label="Participantes">
      <div className="avatar-stack lg">{members.slice(0, 4).map(a => <AgentAvatar key={a.id} agent={a} size={48} state={busy[a.id] ? 'working' : undefined} />)}</div>
      <h2>Conversa em grupo</h2>
      {project && <a className="link" href={`#/p/${project.id}`}><Icon name="folder" size={15} />{project.name}</a>}
      <p className="panel-desc">Todos respondem em sequência, vendo o que os colegas disseram. Use <b>@Nome</b> para chamar só quem você quer.</p>
      <p className="panel-label">Participantes</p>
      <ul className="member-list">
        {members.map(a => (
          <li key={a.id}>
            <AgentAvatar agent={a} size={32} state={busy[a.id] ? 'working' : undefined} paused={!busy[a.id]} />
            <span><b>{a.name}</b><small>{busy[a.id] ? 'respondendo…' : a.description || a.category}</small></span>
            <a className="icon-btn sm" href={`#/agents/${a.id}/settings`} aria-label={`Configurar ${a.name}`}><Icon name="gear" size={15} /></a>
          </li>
        ))}
      </ul>
      <p className="panel-label">Arquivos desta conversa</p>
      <ul className="file-list">
        {files.length === 0 && <li className="muted small">Nenhum arquivo ainda. Todos os participantes veem o que for enviado.</li>}
        {files.map(f => (
          <li key={f.id}>
            {isImage(f.type) ? <FileThumb src={`/api/files/${f.id}`} /> : <span className="thumb file-ico"><Icon name="file" size={18} /></span>}
            <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer"><b>{f.name}</b><small>{fmtSize(f.size)} · {fmtTime(f.createdAt)}</small></a>
          </li>
        ))}
      </ul>
      <button className="btn btn-block btn-ghost-line" onClick={() => input.current.click()} disabled={!chatId}><Icon name="plus" size={16} />Adicionar arquivo</button>
      <input ref={input} type="file" multiple hidden onChange={e => { add([...e.target.files]); e.target.value = ''; }} />
    </aside>
  );
}

export default function Chat({ chatId: initialId, agentId: initialAgent, projectId: initialProject, agentIds: initialMembers }) {
  const { S, agent: getAgent, refresh, toast, setBusy, busy } = useApp();
  const [chat, setChat] = useState(null);
  const [chatId, setChatId] = useState(initialId || null);
  const [loading, setLoading] = useState(!!initialId);
  const [notFound, setNotFound] = useState(false);
  const [live, setLive] = useState(null); // mensagem em construção
  const [phase, setPhase] = useState(null);
  const [panel, setPanel] = useState(() => local.get('panel', true));
  const [renaming, setRenaming] = useState(false);
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
    setLive(null); setNotFound(false); setRenaming(false);
    setChatId(initialId || null);
    if (!initialId) { setChat(null); setLoading(false); setChoice(defaults(null, getAgent(initialAgent || initialMembers?.[0]), (initialMembers || []).length > 1)); return; }
    setLoading(true);
    let alive = true;
    api(`/api/chats/${initialId}`)
      .then(c => { if (!alive) return; setChat(c); setChoice(defaults(c, getAgent(c.agentId), (c.agentIds || []).length > 1)); })
      .catch(() => alive && setNotFound(true))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [initialId, initialAgent, initialProject, (initialMembers || []).join(',')]);
  useEffect(() => () => ctrl.current?.abort(), []);

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

  async function send({ text, fileIds = [], previews }, forceChoice) {
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
        body: JSON.stringify({ agentId: agent.id, agentIds: isGroup ? memberIds : undefined, projectId, chatId: cid, text, fileIds, model: use.model, effort: use.effort }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erro ${res.status}`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += value;
        const parts = buf.split('\n\n'); buf = parts.pop();
        for (const p of parts) {
          if (!p.startsWith('data: ')) continue;
          const e = JSON.parse(p.slice(6));
          if (e.chatId && !cid) { cid = e.chatId; idRef.current = cid; setChatId(cid); location.hash = `/c/${cid}`; }
          if (e.speaker) {
            // Novo agente com a palavra: a bolha anterior vira mensagem e começa outra.
            if (building.content || building.steps.length) { const done = building; setChat(c => ({ ...c, messages: [...c.messages, done] })); }
            building = { role: 'assistant', agentId: e.speaker, content: '', steps: [], at: Date.now() };
            setBusy(b => ({ ...b, [e.speaker]: true })); setPhase('route');
          }
          if (e.turnDone) setBusy(b => { const n = { ...b }; delete n[e.turnDone]; return n; });
          if (e.route) { building.model = e.route.model; building.effort = e.route.effort; building.routed = e.route.by !== 'manual'; }
          if (e.tool) { building.steps.push({ kind: 'tool', tool: e.tool, label: STEP_LABEL[e.tool] || `Usando ${e.tool}`, detail: e.detail }); setPhase(e.tool); }
          if (e.handoff) building.steps.push({ kind: 'warn', label: `Transferindo para ${S.models[e.handoff]?.label}` });
          if (e.warn) building.steps.push({ kind: 'warn', label: e.warn });
          if (e.memory) building.steps.push({ kind: 'done', label: 'Guardado na memória', detail: e.memory });
          if (e.routine) building.steps.push({ kind: 'done', label: 'Rotina criada', detail: e.routine });
          if (e.text) { building.content += e.text; setPhase('text'); }
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
      setLive(null); setPhase(null);
      if (cid) { try { setChat(await api(`/api/chats/${cid}`)); } catch { setChat(c => ({ ...c, messages: [...c.messages, building] })); } }
      else setChat(c => ({ ...c, messages: [...c.messages, building] }));
      refresh();
    }
  }

  if (loading) return <div className="page-loading"><ThinkingOrb state="breathing" size={20} /></div>;
  if (notFound || !agent) return <div className="page"><EmptyState title="Conversa não encontrada" body="Ela pode ter sido apagada." action={<a className="btn" href="#/chats">Ver conversas</a>} /></div>;

  const messages = chat?.messages || [];
  const files = S.files.filter(f => f.chatId && f.chatId === chatId);
  const title = chat?.title || 'Nova conversa';
  const lastUser = [...messages].reverse().find(m => m.role === 'user');

  async function rename(t) {
    setRenaming(false);
    if (!chatId || !t.trim() || t === title) return;
    await api(`/api/chats/${chatId}`, { method: 'PUT', body: { title: t } }); setChat(c => ({ ...c, title: t.trim() })); refresh();
  }
  async function remove() {
    if (!(await confirm({ title: 'Apagar esta conversa?', body: 'Não dá para desfazer.', action: 'Apagar', danger: true }))) return;
    await api(`/api/chats/${chatId}`, { method: 'DELETE' }); await refresh(); go('/chats');
  }
  function exportMd() {
    const md = `# ${title}\n\n` + messages.map(m => `**${m.role === 'user' ? (S.settings.name || 'Você') : nameOf(m.agentId || agent.id)}** · ${m.at ? new Date(m.at).toLocaleString('pt-BR') : ''}\n\n${m.content}`).join('\n\n---\n\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = `${title.replace(/[^\w\-À-ú ]/g, '').slice(0, 50) || 'conversa'}.md`;
    a.click(); URL.revokeObjectURL(a.href);
  }
  const showPanel = panel && wide;

  return (
    <div className={`chat ${showPanel ? 'with-panel' : ''}`}>
      <div className="chat-main">
        <header className="chat-head">
          <div className="chat-title">
            {renaming
              ? <input className="title-input" autoFocus defaultValue={title} onBlur={e => rename(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setRenaming(false); }} aria-label="Nome da conversa" />
              : <button className="title-btn" onClick={() => chatId && setRenaming(true)} title={chatId ? 'Renomear' : undefined}>{title}{chatId && <Icon name="edit" size={14} />}</button>}
            <span className="chat-sub">
              {project && <><a href={`#/p/${project.id}`} className="crumb-link"><Icon name="folder" size={13} />{project.name}</a><span aria-hidden="true">·</span></>}
              {isGroup
                ? <><span className="avatar-stack">{members.slice(0, 4).map(a => <AgentAvatar key={a.id} agent={a} size={16} paused />)}</span>{members.map(a => a.name).join(', ')}</>
                : <><AgentAvatar agent={agent} size={16} state={live ? 'working' : undefined} />{agent.name}<StatusDot status={agent.status} /></>}
            </span>
          </div>
          <div className="grow" />
          {chatId && <button className="icon-btn" onClick={exportMd} aria-label="Exportar conversa em Markdown" title="Exportar"><Icon name="share" /></button>}
          <Menu align="right" trigger={({ toggle, open }) => <button className="icon-btn" onClick={toggle} aria-expanded={open} aria-label="Mais opções"><Icon name="more" /></button>}>
            <MenuItem icon="plus" onClick={() => go(isGroup || project ? `/p/${projectId}/new?agents=${memberIds.join(',')}` : `/a/${agent.id}`)}>Nova conversa</MenuItem>
            {chatId && <MenuItem icon="edit" onClick={() => setRenaming(true)}>Renomear</MenuItem>}
            {wide && <MenuItem icon="sidebar" onClick={() => { setPanel(!panel); local.set('panel', !panel); }}>{panel ? 'Esconder painel' : 'Mostrar painel'}</MenuItem>}
            {chatId && <MenuItem icon="trash" danger onClick={remove}>Apagar conversa</MenuItem>}
          </Menu>
        </header>

        <div className="thread" ref={scroller} onScroll={onScroll}>
          <div className="thread-inner">
            {messages.length === 0 && !live && (
              <div className="chat-empty">
                {isGroup ? <div className="avatar-stack xl">{members.slice(0, 5).map(a => <AgentAvatar key={a.id} agent={a} size={72} interactive />)}</div> : <AgentAvatar agent={agent} size={96} interactive />}
                <h2>{isGroup ? members.map(a => a.name).join(' · ') : agent.name}</h2>
                <p>{isGroup ? 'Todos respondem em sequência, cada um pela sua função. Use @Nome para chamar só alguém.' : agent.description || 'Pronto para ajudar.'}</p>
                {project && <p className="muted small">No projeto {project.name}: instruções e arquivos do projeto entram no contexto.</p>}
                {agent.status === 'paused' && <p className="note">Este agente está pausado: conversas funcionam, rotinas não.</p>}
              </div>
            )}
            {messages.map((m, i) => m.role === 'user'
              ? <UserMessage key={m.id || i} m={m} name={S.settings.name} files={S.files} />
              : <BotMessage key={m.id || i} m={m} agent={getAgent(m.agentId) || agent} group={isGroup} models={S.models} onRetry={m === messages.at(-1) && lastUser ? () => send({ text: lastUser.content }) : null} />)}
            {live && <BotMessage m={live} agent={getAgent(live.agentId) || agent} group={isGroup} live phase={phase} models={S.models} />}
          </div>
        </div>

        <div className="chat-dock">
          <Composer agent={agent} chatId={chatId} projectId={projectId} streaming={!!live} onSend={p => send(p)} onStop={() => ctrl.current?.abort()}
            choice={choice} setChoice={setChoice} group={isGroup} mentions={isGroup ? members : null}
            placeholder={isGroup ? 'Mensagem para o grupo… use @Nome para chamar alguém' : `Mensagem para ${agent.name}…`} autoFocus draftKey={chatId || 'new-' + memberIds.join('-')} />
          <p className="fine">{isGroup ? 'Agentes' : `O ${agent.name}`} pode{isGroup ? 'm' : ''} errar. Confira o que for importante.</p>
        </div>
      </div>
      {showPanel && (isGroup
        ? <GroupPanel members={members} project={project} chatId={chatId} files={files} refresh={refresh} toast={toast} busy={busy} />
        : <AgentPanel agent={agent} chatId={chatId} projectId={projectId} files={files} refresh={refresh} toast={toast} />)}
      {confirmNode}
    </div>
  );
}
