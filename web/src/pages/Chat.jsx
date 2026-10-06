import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import WorkspaceBar from '../workspaceBar.jsx';
import { api, go, fmtTime, fmtSize, stepLabel, useMediaQuery, local, nameColor, speak, canSpeak } from '../lib.js';
import { markdown, closeOpen } from '../markdown.js';
import { AgentAvatar, Icon, Menu, MenuItem, StatusDot, useConfirm, EmptyState } from '../ui.jsx';
import { useApp } from '../app.jsx';
import Composer, { uploadFile } from '../composer.jsx';
import { sessionPayload } from '../marketplace/sessionMcp.js';
import { createInputQueue, normalizeInputQueue } from '../../../lib/input-queue.mjs';
import { effortLabel } from '../modelPicker.jsx';
import MessageAttachments, { DeliveredFiles } from '../MessageAttachments.jsx';
import ChatPanel, { MiniScreen } from '../chatPanel.jsx';
import { ResizeHandle } from '../resize.jsx';
import ActionLine from '../actionLine.jsx';
import { useChatMenu } from '../actions.jsx';
import { useOv } from '../overlay.jsx';
import { botAvatarPalette } from 'bot-avatars';
import { FirstRunChecklist } from '../firstRunChecklist.jsx';
import { isEnterpriseMode } from '../uiMode.js';
import { findChatMatches } from '../../../lib/chat-edit.mjs';
import ErrorNote from '../errorNote.jsx';

// Cor do agente como TEXTO: misturada com a tinta para passar contraste nos dois temas (a pura dava 3,3:1).
const agentColor = a => `color-mix(in srgb, ${nameColor(a, botAvatarPalette)} 58%, var(--ink))`;
// Qual "verbo" o orb mostra para cada fase da resposta.
// Por que a resposta parou (gravado pelo servidor em message.stopReason).
const STOP_REASON = {
  user: 'Você interrompeu a resposta.',
  connection: 'A conexão caiu antes do fim (aba fechada ou rede).',
  tool_loop: 'Parada automática: o agente repetiu a mesma ferramenta em loop.',
  budget: 'Parada pelo orçamento de tokens.'
};
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

// O que aparece ao lado dos pontinhos enquanto o agente trabalha
function typingLabel(phase) {
  if (phase === 'route') return 'Lendo a sua mensagem…';
  if (phase === 'think') return 'Pensando com calma…';
  if (phase === 'approval') return 'Esperando a sua aprovação…';
  if (/^(WebSearch|WebFetch)$/.test(phase || '')) return 'Pesquisando na web…';
  if (/^computer_/.test(phase || '')) return 'Usando o computador…';
  if (/^browser_/.test(phase || '')) return 'Navegando…';
  return 'Escrevendo…';
}

const BotMessage = memo(function BotMessage({ m, agent, live, phase, onRetry, models, group, showModel, allFiles, onFileError }) {
  // ids (resposta salva) ou objetos (chegando ao vivo)
  const { agent: getAgent } = useApp();
  const delivered = (m.files || []).map(x => (typeof x === 'string' ? allFiles?.find(f => f.id === x) : x)).filter(Boolean);
  return (
    <div className="msg bot">
      <div className="msg-av"><AgentAvatar agent={agent} size={36} state={live ? 'working' : undefined} paused={!live} /></div>
      <div className="msg-col">
        {group && <span className="speaker" style={{ color: agentColor(agent) }}>{agent.name}</span>}
        <div className="bubble bot-bubble">
          <ActionLine steps={m.steps} live={live} />
          {delivered.length > 0 && <DeliveredFiles items={delivered} onError={onFileError} />}
          {m.content ? (live ? <LiveText text={m.content} /> : <Markdown text={m.content} />)
            : live ? <div className="typing" role="status" aria-live="polite"><span className="typing-dots" aria-hidden="true"><i /><i /><i /></span><span>{typingLabel(phase)}</span></div>
            : m.error ? <ErrorNote raw={m.error} onRetry={onRetry} />
            : m.stopped ? <p className="muted">{STOP_REASON[m.stopReason] || 'Resposta interrompida.'}</p> : null}
        </div>
        <div className="msg-meta">
          {m.at && <time>{fmtTime(m.at)}</time>}
          {/* detalhes (tempo, custo, modelo) só ao passar o mouse: no dia a dia é ruído em toda mensagem */}
          <span className="msg-meta-more">
          {m.timing?.totalMs > 0 && <span className="msg-took" title={m.timing.firstMs ? `Começou a responder em ${(m.timing.firstMs / 1000).toFixed(1)}s` : undefined}>· {(m.timing.totalMs / 1000).toFixed(1)}s{m.costUsd ? ` · US$ ${m.costUsd.toFixed(3).replace('.', ',')}` : ''}{m.steps?.length ? ` · ${m.steps.length} ${m.steps.length === 1 ? 'ação' : 'ações'}` : ''}</span>}
          {m.via?.type === 'inbox' && <a className="badge via" href={`#/c/${m.via.threadChatId}`} title="Abrir a troca entre os agentes"><Icon name="chat" size={12} />Resposta por mensagem</a>}
          {/* qual modelo respondeu: só no Enterprise — para os demais é ruído em toda mensagem */}
          {m.model && showModel && <span className="badge">{m.routed ? 'Auto → ' : ''}{models[m.model]?.label || m.model}{m.effort && m.effort !== 'auto' ? ` · ${effortLabel(m.effort)}` : ''}</span>}
          </span>
          {!live && m.content && <>
            <button className="meta-btn" onClick={() => navigator.clipboard.writeText(m.content)}><Icon name="copy" size={14} />Copiar</button>
            {canSpeak && <button className="meta-btn" onClick={() => speak(m.content)}><Icon name="volume" size={14} />Ouvir</button>}
            {onRetry && <button className="meta-btn" onClick={onRetry}><Icon name="retry" size={14} />Refazer</button>}
          </>}
        </div>
        {group && m.delegations?.map(d => <Delegation key={d.to} from={agent} to={getAgent(d.to)} task={d.task} />)}
        {live && group && m.plan?.length > 0 && (() => {
          const after = m.plan.filter(id => id !== m.agentId).map(id => getAgent(id)?.name).filter(Boolean);
          return <p className="turn-plan">Agora: {agent.name}{after.length ? ` · depois: ${after.join(', ')}` : ''}</p>;
        })()}
      </div>
    </div>
  );
}, (a, b) => a.m === b.m && a.agent === b.agent && a.live === b.live && a.phase === b.phase && a.group === b.group && a.showModel === b.showModel && a.allFiles === b.allFiles && a.models === b.models && !!a.onRetry === !!b.onRetry);

/** "Ana → Bruno: pesquisar preços" — quem passou a palavra para quem, e para quê. */
function Delegation({ from, to, task }) {
  if (!to) return null;
  return (
    <div className="delegation">
      <AgentAvatar agent={from} size={18} paused /><span>{from?.name}</span>
      <span aria-label="delegou para">→</span>
      <AgentAvatar agent={to} size={18} paused /><span>{to.name}</span>
      {task && <span className="delegation-task" title={task}>{task}</span>}
    </div>
  );
}

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

const UserMessage = memo(function UserMessage({ m, name, files, onEdit }) {
  // Prévias locais (recém-enviadas) ou os arquivos já salvos no servidor.
  const mine = m.previews || (m.files || []).map(id => files.find(f => f.id === id)).filter(Boolean).map(f => ({ ...f, url: `/api/files/${f.id}` }));
  const hasFiles = mine.length > 0;
  const [draft, setDraft] = useState(null); // texto em edição (null = não editando)
  const resend = () => { const t = draft.trim(); if (!t && !m.files?.length) return; setDraft(null); onEdit(t); };
  return (
    <div className="msg user">
      <div className="msg-col">
        {hasFiles && <MessageAttachments items={mine} />}
        {draft !== null
          ? <div className="user-edit">
              <textarea className="input" aria-label="Editar mensagem" autoFocus rows={Math.min(8, draft.split('\n').length + 1)} value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setDraft(null); else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); resend(); } }} />
              <div className="user-edit-actions">
                <button type="button" className="btn btn-sm" onClick={() => setDraft(null)}>Cancelar</button>
                <button type="button" className="btn btn-sm btn-primary" onClick={resend}>Reenviar</button>
              </div>
              <p className="fine">As respostas a partir daqui serão substituídas.</p>
            </div>
          : m.content && <div className={`bubble user-bubble${m.voice ? ' voice' : ''}`} title={m.voice ? 'Mensagem ditada' : undefined}>{m.content}</div>}
        <div className="msg-meta">
          {m.at && <time className="msg-time">{fmtTime(m.at)}</time>}
          {m.content && draft === null && <button className="meta-btn" aria-label="Copiar mensagem" onClick={() => navigator.clipboard.writeText(m.content)}><Icon name="copy" size={14} />Copiar</button>}
          {onEdit && draft === null && <button className="meta-btn" aria-label="Editar e reenviar mensagem" onClick={() => setDraft(m.content || '')}><Icon name="edit" size={14} />Editar</button>}
        </div>
      </div>
      <span className="initial">{(name || 'V')[0].toUpperCase()}</span>
    </div>
  );
});

export default function Chat({ chatId: initialId, agentId: initialAgent, projectId: initialProject, agentIds: initialMembers }) {
  const { S, agent: getAgent, refresh, toast, setBusy, busy, setBusyChats } = useApp();
  const [pip, setPip] = useState(null); // agente cuja tela aparece em miniatura na conversa (painel fechado)
  const chatMenu = useChatMenu();
  const ov = useOv();
  const [chat, setChat] = useState(null);
  const [pendingWs, setPendingWs] = useState(null); // pasta escolhida antes da 1ª mensagem
  // Só mensagens novas animam a entrada; o histórico ao abrir a conversa aparece parado.
  const animateFrom = useRef(Infinity);
  const [chatId, setChatId] = useState(initialId || null);
  const [loading, setLoading] = useState(!!initialId);
  const [notFound, setNotFound] = useState(false);
  const [live, setLive] = useState(null); // mensagem em construção
  const [phase, setPhase] = useState(null);
  // painel da direita: abre sozinho só em tela larga; abaixo de 1440 px o chat fica com a largura toda (o botão reabre)
  const [panel, setPanel] = useState(() => local.get('panel.v2', typeof matchMedia === 'function' && matchMedia('(min-width: 1440px)').matches));
  const wide = useMediaQuery('(min-width: 1200px)');
  const ctrl = useRef(null), scroller = useRef(null), stick = useRef(true);
  const queueRef = useRef(null);
  const sendTurnRef = useRef(null);
  const [confirm, confirmNode] = useConfirm();
  const [search, setSearch] = useState(null); // { q, at } — busca na conversa aberta
  const searchRef = useRef(null);
  useEffect(() => { // rola até o resultado atual
    if (!search?.q) return;
    const el = scroller.current?.querySelector('.search-hit.current');
    if (el) { stick.current = false; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }, [search]);
  useEffect(() => setSearch(null), [initialId]);

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
  const [interrupted, setInterrupted] = useState(false);

  const idRef = useRef(chatId);
  idRef.current = chatId;
  // A mesma tela serve todas as conversas: troca de rota recarrega, a URL que nós mesmos
  // atualizamos ao criar a conversa não (senão a resposta em andamento seria perdida).
  useEffect(() => {
    if (initialId && initialId === idRef.current && chat) return;
    ctrl.current?.abort();
    queueRef.current?.cancel();
    setLive(null); setNotFound(false);
    setChatId(initialId || null);
    if (!initialId) { animateFrom.current = 0; setChat(null); setLoading(false); setChoice(defaults(null, getAgent(initialAgent || initialMembers?.[0]), (initialMembers || []).length > 1)); return; }
    setLoading(true);
    let alive = true;
    api(`/api/chats/${initialId}`)
      .then(c => { if (!alive) return; if (c.unread === false && S.chats.find(x => x.id === c.id)?.unread) refresh(); animateFrom.current = c.messages.length; setChat(c); setInterrupted(!!c.interrupted); setChoice(defaults(c, getAgent(c.agentId), (c.agentIds || []).length > 1)); })
      .catch(() => alive && setNotFound(true))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [initialId, initialAgent, initialProject, (initialMembers || []).join(',')]);
  useEffect(() => () => ctrl.current?.abort(), []);
  // Reabriu a página com o agente ainda respondendo (o turno segue no servidor): mostra a resposta chegando e,
  // ao terminar, carrega a conversa salva.
  const watching = !!chat?.streaming && !ctrl.current;
  useEffect(() => {
    if (!watching || !chatId) return;
    let alive = true;
    const tick = async () => {
      const r = await api(`/api/chats/${chatId}/live`).catch(() => null);
      if (!alive || !r) return;
      if (r.streaming) {
        if (r.live?.agentId) setLive({ role: 'assistant', agentId: r.live.agentId, content: r.live.content, steps: r.live.steps.map(s => s.kind === 'tool' ? { ...s, label: stepLabel(s.tool) } : s), at: r.live.at });
        setBusyChats(b => ({ ...b, [chatId]: true }));
        return;
      }
      clearInterval(t);
      setLive(null);
      setBusyChats(b => { const n = { ...b }; delete n[chatId]; return n; });
      const c = await api(`/api/chats/${chatId}`).catch(() => null);
      if (alive && c) { setChat(c); setInterrupted(!!c.interrupted); }
    };
    const t = setInterval(tick, 1000);
    tick();
    return () => { alive = false; clearInterval(t); };
  }, [watching, chatId]);
  const waiting = chatId && S.pendingInbox?.[chatId];
  const flowLive = ['running', 'waiting'].includes(chat?.flowRun?.status); // fluxo roda no servidor: a conversa se atualiza sozinha
  useEffect(() => {
    if (!waiting && !flowLive) return;
    const t = setInterval(async () => {
      if (ctrl.current) return;
      try { const c = await api(`/api/chats/${chatId}`); setChat(c); } catch {}
      refresh();
    }, 4000);
    return () => clearInterval(t);
  }, [waiting, flowLive, chatId]);
  useEffect(() => {
    if (!chatId) return;
    const refetch = async () => {
      if (ctrl.current || document.visibilityState !== 'visible') return;
      try {
        const c = await api(`/api/chats/${chatId}`);
        setChat(c);
        setInterrupted(!!c.interrupted);
      } catch {}
    };
    document.addEventListener('visibilitychange', refetch);
    window.addEventListener('online', refetch);
    return () => { document.removeEventListener('visibilitychange', refetch); window.removeEventListener('online', refetch); };
  }, [chatId]);

  useEffect(() => {
    const { enabled, windowMs } = normalizeInputQueue(S.settings);
    queueRef.current?.cancel();
    queueRef.current = createInputQueue({
      enabled,
      windowMs,
      onFlush: batch => sendTurnRef.current?.(batch),
      schedule: (fn, ms) => setTimeout(fn, ms),
      clearSchedule: clearTimeout
    });
    return () => queueRef.current?.cancel();
  }, [S.settings.inputQueue?.enabled, S.settings.inputQueue?.windowMs]);

  function queueSend(payload, { immediate = false } = {}) {
    if (!queueRef.current) {
      const { enabled, windowMs } = normalizeInputQueue(S.settings);
      queueRef.current = createInputQueue({
        enabled,
        windowMs,
        onFlush: batch => sendTurnRef.current?.(batch),
        schedule: (fn, ms) => setTimeout(fn, ms),
        clearSchedule: clearTimeout
      });
    }
    queueRef.current.enqueue(payload, { immediate });
  }
  // Ctrl+. recolhe/mostra o painel da direita.
  useEffect(() => {
    const k = e => { if ((e.ctrlKey || e.metaKey) && e.key === '.') { e.preventDefault(); setPanel(p => { local.set('panel.v2', !p); return !p; }); } };
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

  async function send({ text, fileIds = [], previews, mcpSession, resume = false, credentialRefs = [], voice = false }, forceChoice) {
    const use = forceChoice || choice;
    if (ctrl.current || !agent) return;
    if (resume && !chatId) return;
    if (!resume) {
      const userMsg = { id: 'u' + Date.now(), role: 'user', content: text, files: fileIds, previews, voice, at: Date.now() };
      setChat(c => ({ ...(c || { title: 'Nova conversa', agentId: agent.id, agentIds: isGroup ? memberIds : undefined, projectId }), messages: [...(c?.messages || []), userMsg] }));
    } else setInterrupted(false);
    let building = { role: 'assistant', agentId: agent.id, content: '', steps: [], at: Date.now() };
    let plan = []; // ordem de fala da rodada em grupo (turnPlan + delegados)
    setLive(building); setPhase(['xhigh', 'max'].includes(use.effort) ? 'think' : 'route');
    stick.current = true;
    const ac = new AbortController(); ctrl.current = ac;
    let cid = chatId, pending = false, finished = false, sawDone = false;
    const flush = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; if (!finished) setLive({ ...building, steps: [...building.steps], plan }); }); };
    try {
      const endpoint = resume ? `/api/chats/${chatId}/resume` : '/api/chat';
      const payload = resume
        ? { mcpSession: mcpSession || sessionPayload() }
        : {
          agentId: agent.id, agentIds: isGroup ? memberIds : undefined, projectId, chatId: cid, text, fileIds,
          model: use.model, effort: use.effort, mcpSession: mcpSession || sessionPayload(), credentialRefs, voice,
          ...(!cid && pendingWs ? { workspace: pendingWs } : {})
        };
      const res = await fetch(endpoint, { method: 'POST', signal: ac.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
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
          // Primeiro uso do computador/navegador nesta resposta: o painel abre a tela ao vivo.
          if (e.tool && /^(computer_|browser_)/.test(e.tool) && !building.steps.some(s => /^(computer_|browser_)/.test(s.tool || ''))) dispatchEvent(new CustomEvent('ripper:computer'));
          // Navegador em uso: a tela aparece em miniatura (só com computador Docker, que tem a tela ao vivo)
          if ((e.screen || /^browser_/.test(e.tool || '')) && S.settings.computer?.mode === 'docker') setPip(p => p || building.agentId);
          if (e.file) building.files = [...(building.files || []), e.file]; // arquivo entregue aparece na hora
          if (e.tool) { building.steps.push({ kind: 'tool', tool: e.tool, label: stepLabel(e.tool), detail: e.detail }); setPhase(e.tool); }
          if (e.handoff) {
            const lbl = S.models[e.handoff]?.label || e.handoff;
            const fromLbl = e.from && (getAgent(e.from)?.name || S.models[e.from]?.label);
            building.steps.push({ kind: 'warn', label: fromLbl ? `De ${fromLbl} para ${lbl}` : `Transferindo para ${lbl}` });
          }
          if (e.providerRetry) {
            const sec = Math.max(1, Math.round(e.providerRetry.waitMs / 1000));
            building.steps.push({ kind: 'warn', label: `Limite do provedor — tentativa ${e.providerRetry.attempt}/${e.providerRetry.maxAttempts} em ~${sec}s` });
          }
          if (e.turnPlan) plan = e.turnPlan;
          if (e.turnDone) plan = plan.filter(id => id !== e.turnDone);
          if (e.delegated) plan = [...plan, ...e.delegated.filter(id => !plan.includes(id))];
          if (e.delegation) building.delegations = [...(building.delegations || []), e.delegation];
          if (e.delegated?.length) {
            const names = e.delegated.map(id => getAgent(id)?.name || 'colega').join(', ');
            building.steps.push({ kind: 'done', label: 'Palavra delegada', detail: names });
          }
          if (e.tokenBudget?.message) building.steps.push({ kind: 'warn', label: e.tokenBudget.message });
          if (e.warn) building.steps.push({ kind: 'warn', label: e.warn });
          if (e.subtask) { const st = building.steps.find(x => x.kind === 'subtask' && x.key === e.subtask.key); st ? Object.assign(st, e.subtask) : building.steps.push({ kind: 'subtask', ...e.subtask }); }
          if (e.memory) building.steps.push({ kind: 'done', label: 'Guardado na memória', detail: e.memory });
          if (e.approval) { building.steps.push({ kind: 'approval', rec: e.approval, status: 'pending' }); setPhase('approval'); }
          if (e.approvalDone) { const st = building.steps.find(x => x.kind === 'approval' && x.rec.id === e.approvalDone.id); if (st) st.status = e.approvalDone.status; }
          if (e.sent) building.steps.push({ kind: 'done', label: `Mensagem enviada para ${e.sent.to}`, detail: e.sent.priority === 'now' ? 'urgente' : e.sent.priority === 'low' ? 'sem pressa' : 'normal' });
          if (e.artifact) building.steps.push({ kind: 'done', label: `Artefato salvo (v${e.artifact.version})`, detail: e.artifact.title });
          if (e.skill) building.steps.push({ kind: 'done', label: 'Skill guardada', detail: e.skill });
          if (e.routine) building.steps.push({ kind: 'done', label: 'Rotina criada', detail: e.routine });
          if (e.text) { building.content += e.text; setPhase('text'); }
          if (e.stopped) building.stopped = true;
          if (e.interrupted) { building.interrupted = true; setInterrupted(true); }
          if (e.done) sawDone = true;
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
      // A resposta pronta entra no MESMO render em que a ao vivo sai (mesma posição na lista): sem sumir e voltar.
      // Depois a versão salva do servidor só atualiza o conteúdo.
      const keep = (building.content || building.steps.length || building.error || building.stopped) && !building.passed;
      setLive(null); setPhase(null);
      if (keep) setChat(c => ({ ...c, messages: [...(c?.messages || []), { ...building, steps: [...building.steps] }] }));
      if (sawDone && building.content && !building.error && local.get('handsFree', false)) speak(building.content);
      if (cid) {
        try {
          const c = await api(`/api/chats/${cid}`);
          setChat(c);
          setInterrupted(!!c.interrupted);
        } catch { /* fica a versão local */ }
      }
      refresh();
      queueRef.current?.scheduleFlush();
    }
  }
  sendTurnRef.current = send;

  if (loading) return <div className="page-loading" role="status" aria-live="polite" aria-label="Carregando conversa"><ThinkingOrb state="breathing" size={20} /></div>;
  if (notFound || !agent) return <div className="page"><EmptyState title="Conversa não encontrada" body="Ela pode ter sido apagada." action={<a className="btn" href="#/chats">Ver conversas</a>} /></div>;

  const messages = chat?.messages || [];
  const files = S.files.filter(f => f.chatId && f.chatId === chatId);
  const title = chat?.title || 'Nova conversa';
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const canEdit = !!chatId && !chat?.flowRun && !live; // fluxos rodam no servidor: editar quebraria os passos
  const matches = search ? findChatMatches(messages, search.q) : [];
  const hit = matches.length ? Math.min(search.at, matches.length - 1) : -1;
  const goHit = d => setSearch(s => ({ ...s, at: (hit + d + matches.length) % matches.length }));
  async function editFrom(m, text) {
    try { await api(`/api/chats/${chatId}/truncate`, { method: 'POST', body: { fromMessageId: m.id } }); }
    catch (e) { toast(e.message, 'error'); return; }
    setChat(c => ({ ...c, messages: c.messages.slice(0, Math.max(0, c.messages.findIndex(x => x.id === m.id))) }));
    send({ text, fileIds: m.files || [] });
  }
  function onChatKey(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setSearch(s => s || { q: '', at: 0 }); setTimeout(() => searchRef.current?.focus()); }
  }

  const showPanel = panel && wide;
  const togglePanel = () => { setPanel(!panel); local.set('panel.v2', !panel); };
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
    <div className={`chat ${showPanel ? 'with-panel' : ''}`} onKeyDown={onChatKey}>
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
          {messages.length > 0 && <button type="button" className="icon-btn chat-search-btn" aria-label="Buscar na conversa" title="Buscar na conversa (Ctrl F)" aria-expanded={!!search}
            onClick={() => { setSearch(s => s ? null : { q: '', at: 0 }); setTimeout(() => searchRef.current?.focus()); }}><Icon name="search" size={16} /></button>}
        </header>
        {search && (
          <div className="chat-search" role="search">
            <Icon name="search" size={14} />
            <input ref={searchRef} className="chat-search-input" aria-label="Buscar na conversa" placeholder="Buscar na conversa…" value={search.q}
              onChange={e => setSearch({ q: e.target.value, at: 0 })}
              onKeyDown={e => { if (e.key === 'Escape') setSearch(null); else if (e.key === 'Enter' && matches.length) { e.preventDefault(); goHit(e.shiftKey ? -1 : 1); } }} />
            <span className="chat-search-count" aria-live="polite">{search.q.trim() ? (matches.length ? `${hit + 1} de ${matches.length}` : 'Nada encontrado') : ''}</span>
            <button type="button" className="icon-btn sm" aria-label="Resultado anterior" disabled={!matches.length} onClick={() => goHit(-1)}><Icon name="arrowUp" size={14} /></button>
            <button type="button" className="icon-btn sm" aria-label="Próximo resultado" disabled={!matches.length} onClick={() => goHit(1)}><Icon name="down" size={14} /></button>
            <button type="button" className="icon-btn sm" aria-label="Fechar busca" onClick={() => setSearch(null)}><Icon name="x" size={14} /></button>
          </div>
        )}

        <div className="thread" ref={scroller} onScroll={onScroll} onContextMenu={openMenu}>
          <div className="thread-inner">
            {chat?.flowRun && <FlowProgress run={chat.flowRun} />}
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
            {[...messages.map((m, i) => <div key={i} data-mi={i} className={[i >= animateFrom.current && 'is-new', matches.includes(i) && `search-hit${matches[hit] === i ? ' current' : ''}`].filter(Boolean).join(' ') || undefined}>{m.inbox ? <InboxMessage m={m} from={getAgent(m.inbox.from)} /> : m.role === 'user'
              ? <UserMessage m={m} name={S.settings.name} files={S.files} onEdit={canEdit && m.id && !/^u\d+$/.test(m.id) ? text => editFrom(m, text) : null} />
              : <BotMessage m={m} agent={getAgent(m.agentId) || agent} group={isGroup || (!!m.agentId && m.agentId !== agent.id)} models={S.models} showModel={isEnterpriseMode(S.settings)} allFiles={S.files} onFileError={msg => toast(msg, 'error')} onRetry={m === messages.at(-1) && lastUser ? () => send({ text: lastUser.content }) : null} />}</div>),
              live && <div key={messages.length} className="is-new"><BotMessage m={live} agent={getAgent(live.agentId) || agent} group={isGroup} live phase={phase} models={S.models} /></div>]}
          </div>
        </div>

        <div className="chat-dock">
          {interrupted && !live && (
            <div className="chat-recovery-banner" role="status">
              <p>Conexão interrompida — retome ou reenvie.</p>
              <button type="button" className="btn sm" onClick={() => send({ resume: true })}>Retomar resposta</button>
            </div>
          )}
          {<WorkspaceBar chat={chat} chatId={chatId} agents={isGroup ? members : [agent]} pending={pendingWs} setPending={setPendingWs} onChanged={c => setChat(x => ({ ...x, ...c }))} />}
          <Composer agent={agent} chatId={chatId} projectId={projectId} streaming={!!live} onSend={queueSend} onStop={() => { queueRef.current?.cancel(); if (chatId) api(`/api/chats/${chatId}/cancel`, { method: 'POST' }).catch(() => {}); ctrl.current?.abort(); }}
            choice={choice} setChoice={setChoice} group={isGroup} mentions={isGroup ? members : null}
            placeholder={isGroup ? 'Mensagem para o grupo… use @Nome para chamar alguém' : `Mensagem para ${agent.name}…`} autoFocus draftKey={chatId || 'new-' + memberIds.join('-')} />
          {waiting > 0 && <p className="inbox-wait"><Icon name="clock" size={13} />Aguardando {waiting === 1 ? 'resposta de 1 mensagem' : `respostas de ${waiting} mensagens`} enviadas a colegas…</p>}
          <p className="fine">{isGroup ? 'Agentes' : `O ${agent.name}`} pode{isGroup ? 'm' : ''} errar. Confira o que for importante.</p>
        </div>
      </div>
      {!showPanel && wide && <div className="panel-collapsed-edge"><ResizeHandle side="right" cssVar="panel-w" min={280} max={620} collapsed label="Abrir painel" onExpand={togglePanel} /><button className="panel-reopen" onClick={togglePanel} aria-label="Mostrar painel" title="Mostrar painel (Ctrl .)"><Icon name="sidebar" size={16} style={{ transform: 'scaleX(-1)' }} /></button></div>}
      {pip && !showPanel && getAgent(pip) && <MiniScreen agent={getAgent(pip)} working={!!busy[pip]} onClose={() => setPip(null)} />}
      {showPanel && <ChatPanel members={members} project={project} chatId={chatId} messages={messages} files={files} onCollapse={() => { setPanel(false); local.set('panel.v2', false); }} />}
      {confirmNode}
    </div>
  );
}

/** Barra do fluxo no topo da conversa: em que passo está e se espera você. */
function FlowProgress({ run }) {
  const label = { running: `Passo ${run.step + 1} de ${run.total}`, waiting: `Passo ${run.step + 1} de ${run.total} pronto · esperando a sua aprovação na Caixa`, done: `Fluxo concluído · ${run.total} ${run.total === 1 ? 'passo' : 'passos'}`, stopped: 'Fluxo parado: você não aprovou o próximo passo', failed: `Fluxo parou no passo ${run.step + 1}` }[run.status];
  const pct = run.status === 'done' ? 100 : Math.round(((run.step + (run.status === 'waiting' ? 1 : 0.5)) / run.total) * 100);
  return (
    <div className={`flow-progress ${run.status}`} role="status">
      <Icon name="flow" size={16} />
      <span>{label}</span>
      <span className="flow-progress-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
      {run.status === 'waiting' && <a className="btn btn-sm" href="#/inbox">Abrir a Caixa</a>}
      {run.status === 'failed' && run.error && <ErrorNote raw={run.error} compact />}
    </div>
  );
}
