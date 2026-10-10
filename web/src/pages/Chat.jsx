import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import WorkspaceBar from '../workspaceBar.jsx';
import { api, go, fmtTime, fmtSize, stepLabel, seenLabel, useMediaQuery, local, nameColor, speak, canSpeak } from '../lib.js';
import { markdown, closeOpen, plain, tabelaParaCsv, titulosDo } from '../markdown.js';
import { AgentAvatar, Icon, Menu, MenuItem, StatusDot, useConfirm, EmptyState } from '../ui.jsx';
import { useApp } from '../app.jsx';
import Composer, { uploadFile } from '../composer.jsx';
import { sessionPayload } from '../marketplace/sessionMcp.js';
import { createInputQueue, normalizeInputQueue, coalesceSendParts } from '../../../lib/input-queue.mjs';
import { effortLabel } from '../modelPicker.jsx';
import MessageAttachments, { DeliveredFiles } from '../MessageAttachments.jsx';
import ChatPanel, { MiniScreen } from '../chatPanel.jsx';
import { MentionText } from '../mentions.jsx';
import ImageGenLoader from '../imageGenLoader.jsx';
import { AgentThread, ViaLabel } from '../agentThread.jsx';
import { delegationCardState } from '../../../lib/agent-flow.mjs';
import { ResizeHandle } from '../resize.jsx';
import { OpenUIBlock, splitOpenUi } from '../openui/library.jsx';
import ActionLine, { Fontes, StallNote } from '../actionLine.jsx';
import { useChatMenu } from '../actions.jsx';
import { useOv } from '../overlay.jsx';
import { botAvatarPalette } from 'bot-avatars';
import { FirstRunChecklist } from '../firstRunChecklist.jsx';
import { findChatMatches } from '../../../lib/chat-edit.mjs';
import ErrorNote from '../errorNote.jsx';
import { subscribeUserEvents, useUserEventsConnected, watchUserChat, applyChatDelta, liveRecordForChat, USER_EVENTS_SAFETY_MS } from '../userEvents.js';

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

const FADE_MS = 450;
/**
 * Enquanto a resposta chega, cada trecho novo entra transparente e ganha opacidade (sem cursor).
 * Guarda quando cada pedaço do texto apareceu; a cada render embrulha só os pedaços ainda "jovens".
 */
function useFadeIn(ref, html, live) {
  const born = useRef({ len: 0, spans: [] }); // spans: [{ from, to, t }]
  useLayoutEffect(() => {
    const el = ref.current;
    if (!live || !el) return;
    const b = born.current, now = performance.now();
    const total = el.textContent.length;
    if (total < b.len) b.spans = [];
    else if (total > b.len) b.spans.push({ from: b.len, to: total, t: now });
    b.len = total;
    b.spans = b.spans.filter(s => now - s.t < FADE_MS);
    if (!b.spans.length) return;
    const first = b.spans[0].from;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let n, pos = 0; (n = walker.nextNode()); pos += n.data.length) if (pos + n.data.length > first) nodes.push([n, pos]);
    for (const [node, pos] of nodes) {
      let cur = node, start = pos;
      for (const s of b.spans) {
        const a = Math.max(s.from, start), z = Math.min(s.to, pos + node.data.length);
        if (z <= a) continue;
        if (a > start) { cur = cur.splitText(a - start); start = a; }
        const rest = z < start + cur.data.length ? cur.splitText(z - start) : null;
        const span = document.createElement('span');
        span.className = 'fade-in';
        const age = now - s.t;
        span.style.opacity = String(Math.min(1, age / FADE_MS)); // continua de onde estava no quadro anterior
        cur.replaceWith(span); span.append(cur);
        requestAnimationFrame(() => { span.style.transitionDuration = `${Math.max(0, FADE_MS - age)}ms`; span.style.opacity = '1'; });
        if (!rest) break;
        cur = rest; start = z;
      }
    }
  }, [html, live]);
}

function MarkdownText({ text, live }) {
  // Âncoras únicas por texto (o índice aponta para elas). Só letras, números e hífen.
  const pid = useId().replace(/[^\w-]/g, '') + '-';
  // Markdown só é recalculado quando o texto muda; mensagens antigas nunca são refeitas.
  const html = useMemo(() => markdown(text, pid), [text, pid]);
  const titulos = useMemo(() => (live ? [] : titulosDo(text)), [text, live]);
  const ref = useRef(null);
  const [tabela, setTabela] = useState(null); // tabela aberta em tela cheia (HTML já pronto)
  useFadeIn(ref, html, live);
  useEffect(() => {
    if (!tabela) return;
    const k = e => { if (e.key === 'Escape') setTabela(null); };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [tabela]);
  const onClick = e => {
    const b = e.target.closest('[data-copy]');
    if (b) { navigator.clipboard.writeText(b.closest('.code').querySelector('code').textContent); b.lastChild.textContent = 'Copiado'; setTimeout(() => (b.lastChild.textContent = 'Copiar'), 1400); }
    // Tabela: copia o texto original em Markdown ou convertido para CSV
    const t = e.target.closest('[data-copy-table]');
    if (t) {
      const csv = t.dataset.copyTable === 'csv';
      navigator.clipboard.writeText(csv ? tabelaParaCsv(t.closest('.table')?.dataset.table) : (t.closest('.table')?.dataset.table || ''));
      const rotulo = csv ? 'Copiar como CSV' : 'Copiar como Markdown';
      t.textContent = 'Copiado'; setTimeout(() => (t.textContent = rotulo), 1400);
    }
    // Tabela larga em tela cheia (no celular, a rolagem lateral fica apertada)
    if (e.target.closest('[data-expand-table]')) setTabela(e.target.closest('.table')?.querySelector('table')?.outerHTML || null);
  };
  const irPara = id => document.getElementById(pid + id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  return <>
    {titulos.length >= 4 && (
      <nav className="indice-resposta" aria-label="Índice desta resposta">
        <b>Neste texto</b>
        <ol>{titulos.map(t => <li key={t.id} className={`nivel-${t.nivel}`}><button type="button" className="link" onClick={() => irPara(t.id)}>{t.texto}</button></li>)}</ol>
      </nav>
    )}
    <div ref={ref} className={`md ${live ? 'streaming' : ''}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
    {tabela && (
      <div className="tabela-tela-cheia" role="dialog" aria-modal="true" aria-label="Tabela em tela cheia">
        <div className="tabela-tela-cheia-topo"><button type="button" className="btn btn-sm" onClick={() => setTabela(null)}>Fechar</button></div>
        <div className="tabela-tela-cheia-corpo" dangerouslySetInnerHTML={{ __html: tabela }} />
      </div>
    )}
  </>;
}

// Blocos ```openui viram componentes visuais; o resto segue o markdown de sempre.
function Markdown({ text, live }) {
  const parts = useMemo(() => splitOpenUi(text), [text]);
  if (parts.length === 1 && parts[0].t === 'md') return <MarkdownText text={text} live={live} />;
  return parts.map((p, i) => p.t === 'ui'
    ? <OpenUIBlock key={i} code={p.code} live={live && p.open} />
    : <MarkdownText key={i} text={p.text} live={live} />);
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

// Resposta longa: recolhida com "Mostrar mais" (resposta já pronta; a que está chegando não recolhe).
const ALTURA_RECOLHIDA = 460;
function Recolhivel({ children }) {
  const conteudo = useRef(null);
  const [alto, setAlto] = useState(0);
  const [aberto, setAberto] = useState(false);
  useLayoutEffect(() => { setAlto(conteudo.current?.scrollHeight || 0); }, [children]);
  const longo = alto > ALTURA_RECOLHIDA + 40;
  return (
    <div className={`recolhivel ${longo && !aberto ? 'is-collapsed' : ''}`}>
      <div ref={conteudo}>{children}</div>
      {longo && <button type="button" className="link recolher-btn" aria-expanded={aberto} onClick={() => setAberto(v => !v)}>{aberto ? 'Mostrar menos' : 'Mostrar mais'}</button>}
    </div>
  );
}

/** O que a pessoa precisa para reportar um erro: a hora, a última ação e quantas já tinham terminado (itens 39 e 44). */
function contextoDoErro(m) {
  const acoes = (m.steps || []).filter(s => s.kind === 'tool');
  const ultima = acoes.at(-1);
  return { quando: m.at, etapa: ultima ? stepLabel(ultima.tool) : null, feitas: acoes.length };
}

/** "Outro modelo" e "Mais curta" para refazer a última resposta (item 25). */
function RefazerEscolha({ models, onPick }) {
  const [aberto, setAberto] = useState(false);
  const opcoes = Object.entries(models || {}).slice(0, 8);
  return (
    <>
      <button type="button" className="meta-btn" aria-expanded={aberto} onClick={() => setAberto(v => !v)}><Icon name="retry" size={14} /><span>Outro modelo</span></button>
      <button type="button" className="meta-btn" onClick={() => onPick({ curta: true })}><Icon name="down" size={14} /><span>Mais curta</span></button>
      {aberto && (
        <div className="refazer-modelos" role="menu" aria-label="Refazer com outro modelo">
          {opcoes.map(([id, mo]) => <button key={id} type="button" role="menuitem" className="link" onClick={() => { setAberto(false); onPick({ modelo: id }); }}>{mo?.label || id}</button>)}
        </div>
      )}
    </>
  );
}

/** Pedidos desta conversa, para achar o começo de uma conversa longa (item 47). Resumo automático, sem modelo. */
function ResumoConversa({ messages }) {
  const pedidos = messages.filter(m => m.role === 'user' && m.content).map(m => plain(m.content).slice(0, 140));
  if (!pedidos.length) return null;
  return (
    <details className="resumo-conversa">
      <summary>Começo desta conversa · {pedidos.length} {pedidos.length === 1 ? 'pedido' : 'pedidos'}</summary>
      <ol>{pedidos.slice(0, 25).map((p, i) => <li key={i}>{p}</li>)}</ol>
    </details>
  );
}

const BotMessage = memo(function BotMessage({ m, agent, live, phase, onRetry, onStop, models, group, allFiles, onFileError, deleg, onContinue, onRetryWith, onPin }) {
  // ids (resposta salva) ou objetos (chegando ao vivo)
  const { agent: getAgent } = useApp();
  const delivered = (m.files || []).map(x => (typeof x === 'string' ? allFiles?.find(f => f.id === x) : x)).filter(Boolean);
  return (
    <div className="msg bot">
      <div className="msg-av"><AgentAvatar agent={agent} size={36} state={live ? 'working' : undefined} paused={!live} /></div>
      <div className="msg-col">
        {group && <span className="speaker" style={{ color: agentColor(agent) }}>{agent.name}</span>}
        <div className="bubble bot-bubble" tabIndex={-1}>
          <ActionLine steps={m.steps} live={live} onStop={live ? onStop : undefined} />
          {live && phase === 'approval' && <p className="action-status" role="status"><Icon name="clock" size={13} />Esperando você responder acima</p>}
          {(m.steps || []).filter(s => s.tool === 'send_message' && s.detail).map((s, i) => <span key={i} className="enviada-a">Enviada a {String(s.detail).replace(/^→\s*/, '')}</span>)}
          {live && phase === 'generate_image' && <ImageGenLoader />}
          {live && phase !== 'approval' && <StallNote label={phase === 'text' ? 'Escrevendo' : phase === 'route' || phase === 'think' || !phase ? 'Pensando' : stepLabel(phase)} sig={`${phase}|${m.steps.length}|${m.content.length}|${m.agentId}`} slowAfterMs={phase === 'generate_image' ? 200_000 : undefined} />}
          {delivered.length > 0 && <DeliveredFiles items={delivered} onError={onFileError} />}
          {m.content ? (live ? <LiveText text={m.content} /> : <Recolhivel><Markdown text={m.content} /></Recolhivel>)
            : live ? <div className="typing" role="status" aria-live="polite"><span className="typing-dots" aria-hidden="true"><i /><i /><i /></span><span>{typingLabel(phase)}</span></div>
            : m.error ? <ErrorNote raw={m.error} onRetry={onRetry} contexto={contextoDoErro(m)} />
            : m.stopped ? <p className="muted">{STOP_REASON[m.stopReason] || 'Resposta interrompida.'}</p> : null}
          {!live && <Fontes steps={m.steps} />}
          {(m.stopped || m.truncated) && !live && onContinue && (
            <div className="continuar-resposta">
              <p>{m.truncated ? 'A resposta parou no limite de tamanho.' : 'Você interrompeu a resposta.'}</p>
              <button type="button" className="btn btn-sm" onClick={onContinue}>Continuar de onde parou</button>
            </div>
          )}
        </div>
        <div className="msg-meta">
          {m.at && <time>{fmtTime(m.at)}</time>}
          {/* detalhes (tempo, custo, modelo) só ao passar o mouse: no dia a dia é ruído em toda mensagem */}
          <span className="msg-meta-more">
          {m.timing?.totalMs > 0 && <span className="msg-took" title={m.timing.firstMs ? `Começou a responder em ${(m.timing.firstMs / 1000).toFixed(1)}s` : undefined}>· {(m.timing.totalMs / 1000).toFixed(1)}s{m.costUsd ? ` · US$ ${m.costUsd.toFixed(3).replace('.', ',')}` : ''}{m.steps?.length ? ` · ${m.steps.length} ${m.steps.length === 1 ? 'ação' : 'ações'}` : ''}</span>}
          {/* qual IA respondeu (e se o Ripper Auto escolheu): detalhe técnico, só ao abrir (§3.1) */}
          {m.model && <span className="badge model-badge">{m.routedBy && m.routedBy !== 'manual' ? 'Ripper Auto → ' : ''}{models?.[m.model]?.label || m.model}{m.effort && m.effort !== 'auto' ? ` · ${effortLabel(m.effort)}` : ''}</span>}
          </span>
          {!live && m.content && <>
            <button className="meta-btn" aria-label="Copiar" onClick={() => navigator.clipboard.writeText(m.content)}><Icon name="copy" size={14} /><span>Copiar</span></button>
            {canSpeak && <button className="meta-btn" aria-label="Ouvir" onClick={() => speak(m.content)}><Icon name="volume" size={14} /><span>Ouvir</span></button>}
            {onRetry && <button className="meta-btn" aria-label="Refazer" onClick={onRetry}><Icon name="retry" size={14} /><span>Refazer</span></button>}
            {onRetryWith && <RefazerEscolha models={models} onPick={onRetryWith} />}
            {onPin && <button className="meta-btn" aria-pressed={!!m.fixada} onClick={onPin}><Icon name="star" size={14} /><span>{m.fixada ? 'Desafixar' : 'Fixar'}</span></button>}
          </>}
        </div>
        {m.delegations?.map(d => <Delegation key={d.messageId || d.to} to={getAgent(d.to)} task={d.task} state={delegationCardState(d, deleg?.messages, deleg?.inbox, deleg?.liveAgentId)} />)}
        {live && group && m.plan?.length > 0 && (() => {
          const after = m.plan.filter(id => id !== m.agentId).map(id => getAgent(id)?.name).filter(Boolean);
          return <p className="turn-plan">Agora: {agent.name}{after.length ? ` · depois: ${after.join(', ')}` : ''}</p>;
        })()}
      </div>
    </div>
  );
}, (a, b) => a.m === b.m && a.agent === b.agent && a.live === b.live && a.phase === b.phase && a.group === b.group && a.allFiles === b.allFiles && a.models === b.models && a.deleg === b.deleg && !!a.onRetry === !!b.onRetry && !!a.onContinue === !!b.onContinue && !!a.onRetryWith === !!b.onRetryWith && !!a.onPin === !!b.onPin);

const DELEG_TONE = { aguardando: 'wait', trabalhando: 'work', feito: 'ok', falhou: 'err' };
/** Cartão no fio de quem pediu: "Pedi ao Donald: ajustar a faixa · trabalhando", e o resultado ali mesmo. */
function Delegation({ to, task, state }) {
  const [open, setOpen] = useState(false);
  if (!to) return null;
  const { status, result } = state;
  return (
    <div className="delegation">
      <div className="delegation-row">
        <AgentAvatar agent={to} size={18} state={status === 'trabalhando' ? 'working' : undefined} paused={status !== 'trabalhando'} />
        <span>Pedi ao {to.name}:</span>
        {task && <span className="delegation-task" title={task}>{task}</span>}
        <span className={`delegation-status ${DELEG_TONE[status]}`} role="status">{status}</span>
        {result && <button type="button" className="meta-btn" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'Esconder' : status === 'falhou' ? 'Ver erro' : 'Ver resultado'}</button>}
      </div>
      {open && result && <div className="delegation-result"><Markdown text={result} /></div>}
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

const UserMessage = memo(function UserMessage({ m, name, files, onEdit, ack, onRetryAck }) {
  const { S } = useApp();
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
          : m.content && <Recolhivel><div className={`bubble user-bubble${m.voice ? ' voice' : ''}`} title={m.voice ? 'Mensagem ditada' : undefined}><MentionText text={m.content} agents={S.agents} /></div></Recolhivel>}
        <div className="msg-meta">
          {m.at && <time className="msg-time">{fmtTime(m.at)}</time>}
          {ack?.state === 'seen' && <span className="msg-ack" role="status">{ack.label}</span>}
          {ack?.state === 'late' && <span className="msg-ack late" role="status">Ainda não chegou — <button type="button" className="meta-btn" onClick={onRetryAck}>tentar de novo</button></span>}
          {m.content && draft === null && <button className="meta-btn" aria-label="Copiar mensagem" onClick={() => navigator.clipboard.writeText(m.content)}><Icon name="copy" size={14} /><span>Copiar</span></button>}
          {onEdit && draft === null && <button className="meta-btn" aria-label="Editar e reenviar mensagem" onClick={() => setDraft(m.content || '')}><Icon name="edit" size={14} />Editar</button>}
        </div>
      </div>
      <span className="initial">{(name || 'V')[0].toUpperCase()}</span>
    </div>
  );
});

export default function Chat({ chatId: initialId, agentId: initialAgent, projectId: initialProject, agentIds: initialMembers }) {
  const { S, agent: getAgent, refresh, toast, setBusy, busy, setBusyChats } = useApp();
  const eventsOpen = useUserEventsConnected();
  const [pip, setPip] = useState(null); // agente cuja tela aparece em miniatura na conversa (painel fechado)
  const chatMenu = useChatMenu();
  const ov = useOv();
  const [chat, setChat] = useState(null);
  const [pendingWs, setPendingWs] = useState(null); // pasta escolhida antes da 1ª mensagem
  // Só mensagens novas animam a entrada; o histórico ao abrir a conversa aparece parado.
  const animateFrom = useRef(Infinity);
  const [thread, setThread] = useState(null); // conversa entre agentes aberta ao lado
  const [chatId, setChatId] = useState(initialId || null);
  useEffect(() => watchUserChat(chatId), [chatId]);
  const [loading, setLoading] = useState(!!initialId);
  const [notFound, setNotFound] = useState(false);
  const [live, setLive] = useState(null); // mensagem em construção
  const [phase, setPhase] = useState(null);
  // painel da direita: abre sozinho só em tela larga; abaixo de 1440 px o chat fica com a largura toda (o botão reabre)
  const [panel, setPanel] = useState(() => local.get('panel.v2', typeof matchMedia === 'function' && matchMedia('(min-width: 1440px)').matches));
  const wide = useMediaQuery('(min-width: 1200px)');
  const ctrl = useRef(null), scroller = useRef(null), stick = useRef(true);
  // mensagens enviadas com um turno em andamento (ex.: esperando aprovação): antes eram descartadas em silêncio
  const heldRef = useRef([]); const [held, setHeld] = useState(0);
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
  const [aviso, setAviso] = useState(null); // aviso do servidor no topo da conversa (orçamento, limite do provedor)
  const [pendAprov, setPendAprov] = useState(0); // pedidos da Caixa esperando você nesta conversa
  // "Novo desde a sua última visita": guarda quando esta conversa foi vista pela última vez, neste aparelho.
  const vistoAnterior = useMemo(() => (chatId ? Number(local.get('visto.' + chatId, 0)) || 0 : 0), [chatId]);
  useEffect(() => {
    if (!chatId) return;
    local.set('visto.' + chatId, Date.now());
    return () => local.set('visto.' + chatId, Date.now());
  }, [chatId]);
  useEffect(() => {
    if (!chatId) return;
    let on = true;
    const apply = pending => { if (on) setPendAprov((pending || []).filter(a => a.chatId === chatId).length); };
    const load = () => api('/api/approvals').then(r => apply(r.pending)).catch(() => {});
    const unsub = subscribeUserEvents(ev => {
      if ((ev.type === 'approvals' || ev.type === 'snapshot') && ev.approvals) apply(ev.approvals);
    });
    load();
    const h = eventsOpen ? null : setInterval(load, 10000);
    return () => { on = false; unsub(); if (h) clearInterval(h); };
  }, [chatId, live, eventsOpen]);
  const [ack, setAck] = useState(null); // { id, state: 'wait'|'seen'|'late', label, retry } da última mensagem enviada

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
    const liveRef = { current: null };
    const paint = rec => {
      if (!alive || !rec) return false;
      if (rec.streaming) {
        const body = rec.live || rec;
        if (body.agentId || body.content) {
          const msg = { role: 'assistant', agentId: body.agentId, content: body.content || '', steps: (body.steps || []).map(s => s.kind === 'tool' ? { ...s, label: stepLabel(s.tool) } : s), at: body.at };
          liveRef.current = msg;
          setLive(msg);
        }
        setBusyChats(b => ({ ...b, [chatId]: true }));
        return true;
      }
      liveRef.current = null;
      setLive(null);
      setBusyChats(b => { const n = { ...b }; delete n[chatId]; return n; });
      api(`/api/chats/${chatId}`).then(c => { if (alive && c) { setChat(c); setInterrupted(!!c.interrupted); } }).catch(() => {});
      return false;
    };
    const fromEvent = ev => {
      if (ev.type === 'chat.delta' && ev.chatId === chatId) {
        paint(applyChatDelta(liveRef.current, ev));
        return;
      }
      const rec = liveRecordForChat(ev, chatId);
      if (rec) paint(rec);
    };
    const unsub = subscribeUserEvents(fromEvent);
    const tick = async () => {
      const r = await api(`/api/chats/${chatId}/live`).catch(() => null);
      if (!paint(r)) clearInterval(t);
    };
    // Com SSE: poll lento de reserva (chat.done perdido). Sem SSE: 1 s como antes.
    const t = setInterval(tick, eventsOpen ? USER_EVENTS_SAFETY_MS : 1000);
    tick();
    return () => { alive = false; unsub(); clearInterval(t); };
  }, [watching, chatId, eventsOpen]);
  const waiting = chatId && S.pendingInbox?.[chatId];
  const flowLive = ['running', 'waiting'].includes(chat?.flowRun?.status); // fluxo roda no servidor: a conversa se atualiza sozinha
  useEffect(() => {
    if (!waiting && !flowLive) return;
    const pull = async () => {
      if (ctrl.current) return;
      try { const c = await api(`/api/chats/${chatId}`); setChat(c); } catch {}
      refresh();
    };
    const unsub = subscribeUserEvents(ev => {
      if (ev.type === 'inbox' && ev.pendingInbox && (chatId in ev.pendingInbox || waiting)) pull();
      else if (ev.type === 'flows' && ev.flows && (chatId in ev.flows || flowLive)) pull();
      else if (ev.type === 'snapshot' && (ev.pendingInbox?.[chatId] != null || ev.flows?.[chatId] != null || waiting || flowLive)) pull();
    });
    const t = eventsOpen ? null : setInterval(pull, 4000);
    return () => { unsub(); if (t) clearInterval(t); };
  }, [waiting, flowLive, chatId, eventsOpen]);
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

  // Escreveu enquanto o agente trabalha: a mensagem fica visível "na fila" e sai sozinha quando o passo atual terminar.
  const [queued, setQueued] = useState([]);
  const queuedRef = useRef([]);
  const setQueue = q => { queuedRef.current = q; setQueued(q); };
  function queueSend(payload, { immediate = false } = {}) {
    if (ctrl.current) { setQueue([...queuedRef.current, payload]); return; }
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

  // Botão "Ir para o fim": aparece quando a pessoa rola para cima; conta as mensagens que chegaram lá de cima.
  const [longe, setLonge] = useState(false);
  const [novas, setNovas] = useState(0);
  const ultimoTamanho = useRef(0);
  const onScroll = () => { const el = scroller.current; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; setLonge(!stick.current); if (stick.current) setNovas(0); };
  useEffect(() => {
    const n = chat?.messages.length || 0;
    if (stick.current) scroller.current?.scrollTo({ top: 1e9 });
    else if (ultimoTamanho.current && n > ultimoTamanho.current) setNovas(v => v + (n - ultimoTamanho.current));
    ultimoTamanho.current = n;
  }, [chat?.messages.length, live?.content, live?.steps?.length]);

  async function send(args, forceChoice) {
    const { text, fileIds = [], previews, mcpSession, resume = false, credentialRefs = [], voice = false } = args;
    setAviso(null);
    const use = forceChoice || choice;
    let ackId = null;
    if (!agent) return;
    if (ctrl.current) { if (!resume) { heldRef.current.push([args, forceChoice]); setHeld(heldRef.current.length); } return; }
    if (resume && !chatId) return;
    if (!resume) {
      const userMsg = { id: 'u' + Date.now(), role: 'user', content: text, files: fileIds, previews, voice, at: Date.now() };
      setChat(c => ({ ...(c || { title: 'Nova conversa', agentId: agent.id, agentIds: isGroup ? memberIds : undefined, projectId }), messages: [...(c?.messages || []), userMsg] }));
      ackId = userMsg.id; setAck({ id: ackId, state: 'wait' });
    } else setInterrupted(false);
    let building = { role: 'assistant', agentId: agent.id, content: '', steps: [], at: Date.now() };
    let plan = []; // ordem de fala da rodada em grupo (turnPlan + delegados)
    setLive(building); setPhase(['xhigh', 'max'].includes(use.effort) ? 'think' : 'route');
    stick.current = true; setLonge(false); setNovas(0);
    const ac = new AbortController(); ctrl.current = ac;
    // Sem nenhum evento do servidor em 5 s: avisa e oferece reenviar (aborta este e manda de novo).
    const lateTimer = ackId && setTimeout(() => setAck(a => a?.id === ackId && a.state === 'wait' ? { ...a, state: 'late', retry: () => { ac.retry = true; ac.abort(); } } : a), 5000);
    let seen = !ackId; const seenIds = [];
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
      // "Tentar de novo" reenvia a MESMA chave e o MESMO corpo: se o servidor já recebeu, não roda o turno de novo.
      args.idem ||= { key: crypto.randomUUID?.() || `k${Date.now()}${Math.random().toString(36).slice(2)}`, body: JSON.stringify(payload) };
      const res = await fetch(endpoint, { method: 'POST', signal: ac.signal, headers: { 'content-type': 'application/json', 'idempotency-key': args.idem.key }, body: args.idem.body });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = errBody.error || `Erro ${res.status}`;
        // "Tentar de novo" com a 1ª resposta ainda rodando: não é erro. A conversa recarrega abaixo (finally),
        // vem marcada como respondendo e a tela passa a acompanhar ao vivo até terminar.
        // ponytail: na 1ª mensagem de uma conversa nova (sem id ainda) não há o que recarregar; a resposta aparece ao reabrir.
        if (res.status === 409 && /em processamento/.test(msg)) { toast('A resposta anterior ainda está chegando; acompanhando.'); return; }
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
          // Primeiro evento do servidor = turno começou: "Ripper viu" (em grupo, quem vai falar).
          for (const id of [...(e.turnPlan || []), e.speaker].filter(Boolean)) if (!seenIds.includes(id)) { seenIds.push(id); seen = false; }
          if (!seen) { seen = true; clearTimeout(lateTimer); const ids = seenIds.length ? seenIds : [agent.id]; setAck({ id: ackId, state: 'seen', label: seenLabel(ids.map(id => getAgent(id)?.name)) }); }
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
          // Tela ao vivo: avisa na conversa (com botão "Abrir tela"), sem abrir o painel sozinha.
          if (e.tool && /^(computer_|browser_)/.test(e.tool) && !building.steps.some(s => s.kind === 'screen')) building.steps.push({ kind: 'screen', label: 'Tela ao vivo disponível' });
          // Navegador em uso: a tela aparece em miniatura (só com computador Docker, que tem a tela ao vivo)
          if ((e.screen || /^browser_/.test(e.tool || '')) && S.settings.computer?.mode === 'docker') setPip(p => p || building.agentId);
          if (e.file) building.files = [...(building.files || []), e.file]; // arquivo entregue aparece na hora
          if (e.tool) {
            // O que o agente escreveu antes da ferramenta ("Vou checar…") vira anotação na hora — igual ao que o servidor grava no fim.
            if (building.content.trim()) { building.steps.push({ kind: 'note', label: building.content.trim() }); building.content = ''; }
            building.steps.push({ kind: 'tool', tool: e.tool, label: stepLabel(e.tool), detail: e.detail, at: Date.now() }); setPhase(e.tool);
          }
          if (e.handoff) {
            const lbl = S.models[e.handoff]?.label || e.handoff;
            const fromLbl = e.from && (getAgent(e.from)?.name || S.models[e.from]?.label);
            building.steps.push({ kind: 'warn', label: fromLbl ? `De ${fromLbl} para ${lbl}` : `Transferindo para ${lbl}` });
          }
          if (e.providerRetry) {
            const sec = Math.max(1, Math.round(e.providerRetry.waitMs / 1000));
            setAviso(`Limite do provedor: tentando de novo (${e.providerRetry.attempt} de ${e.providerRetry.maxAttempts}) em cerca de ${sec} s.`);
          }
          if (e.turnPlan) plan = e.turnPlan;
          if (e.turnDone) plan = plan.filter(id => id !== e.turnDone);
          if (e.delegated) plan = [...plan, ...e.delegated.filter(id => !plan.includes(id))];
          if (e.delegationStatus) { const { messageId, ...st } = e.delegationStatus; setLiveInbox(x => ({ ...x, [messageId]: st })); }
          if (e.delegation) building.delegations = [...(building.delegations || []), e.delegation];
          if (e.delegated?.length) {
            const names = e.delegated.map(id => getAgent(id)?.name || 'colega').join(', ');
            building.steps.push({ kind: 'done', label: 'Palavra delegada', detail: names });
          }
          if (e.tokenBudget?.message) setAviso(e.tokenBudget.message); // aviso no topo da conversa, antes de estourar
          if (e.warn) building.steps.push({ kind: 'warn', label: e.warn });
          if (e.subtask) { const st = building.steps.find(x => x.kind === 'subtask' && x.key === e.subtask.key); st ? Object.assign(st, e.subtask) : building.steps.push({ kind: 'subtask', ...e.subtask, at: Date.now() }); }
          if (e.memory) building.steps.push({ kind: 'done', label: 'Guardado na memória', detail: e.memory });
          if (e.approval) { building.steps.push({ kind: 'approval', rec: e.approval, status: 'pending' }); setPhase('approval'); }
          if (e.campaign) building.steps.push({ kind: 'campaign', rec: e.campaign });
          if (e.documento) building.steps.push({ kind: 'documento', rec: e.documento });
          if (e.approvalDone) { const st = building.steps.find(x => x.kind === 'approval' && x.rec.id === e.approvalDone.id); if (st) { st.status = e.approvalDone.status; st.rec = { ...st.rec, decidedAt: Date.now() }; } }
          if (e.sent) building.steps.push({ kind: 'done', label: `Mensagem enviada para ${e.sent.to}`, detail: e.sent.priority === 'now' ? 'urgente' : e.sent.priority === 'low' ? 'sem pressa' : 'normal' });
          if (e.artifact) building.steps.push({ kind: 'done', label: `Artefato salvo (v${e.artifact.version})`, detail: e.artifact.title });
          if (e.skill) building.steps.push({ kind: 'done', label: 'Skill guardada', detail: e.skill });
          if (e.routine) building.steps.push({ kind: 'done', label: 'Rotina criada', detail: e.routine });
          if (e.text) { building.content += e.text; setPhase('text'); }
          if (e.stopped) building.stopped = true;
          if (e.truncated) building.truncated = true; // o modelo parou no limite de tamanho
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
      clearTimeout(lateTimer);
      if (ac.retry) { // nada chegou: tira a mensagem local e manda de novo
        setLive(null); setPhase(null);
        setChat(c => ({ ...c, messages: c.messages.filter(x => x.id !== ackId) }));
        setTimeout(() => send(args, use));
        return;
      }
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
      if (queuedRef.current.length) { const next = coalesceSendParts(queuedRef.current); setQueue([]); setTimeout(() => send(next)); }
      else {
        const next = heldRef.current.shift(); setHeld(heldRef.current.length);
        if (next) setTimeout(() => sendTurnRef.current?.(...next));
      }
    }
  }
  sendTurnRef.current = send;
  // Cartões de delegação: estado dos pedidos e respostas que já aparecem dentro do cartão (não viram balão à parte).
  const [liveInbox, setLiveInbox] = useState({}); // status de call_agent chegando ao vivo (antes do fim do turno)
  const deleg = useMemo(() => ({ messages: chat?.messages || [], inbox: { ...chat?.inboxStatus, ...liveInbox }, liveAgentId: live?.agentId || null }), [chat?.messages, chat?.inboxStatus, liveInbox, live?.agentId]);
  const inCard = useMemo(() => new Set((chat?.messages || []).flatMap(m => (m.delegations || []).map(d => d.messageId).filter(Boolean))), [chat?.messages]);

  if (loading) return <div className="page-loading" role="status" aria-live="polite" aria-label="Carregando conversa"><ThinkingOrb state="breathing" size={20} /></div>;
  if (notFound || !agent) return <div className="page"><EmptyState title="Conversa não encontrada" body="Ela pode ter sido apagada." action={<a className="btn" href="#/chats">Ver conversas</a>} /></div>;

  const messages = chat?.messages || [];
  const fixadas = messages.map((m, i) => ({ m, i })).filter(x => x.m.fixada);
  const primeiroNovo = vistoAnterior ? messages.findIndex(m => m.at && m.at > vistoAnterior) : -1;
  const files = S.files.filter(f => f.chatId && f.chatId === chatId);
  const title = chat?.title || 'Nova conversa';
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  // Continuar: pede que a resposta siga de onde parou (vira uma nova mensagem da pessoa, sem apagar a anterior).
  const continuar = () => send({ text: 'Continue de onde você parou.' });
  // Refazer com outro modelo ou mais curta: a mesma pergunta, com a escolha desta vez.
  const refazerCom = o => (o.curta ? send({ text: 'Responda de forma mais curta, mantendo o essencial.' }) : send({ text: lastUser.content }, { ...choice, model: o.modelo }));
  async function fixar(m) {
    try {
      const r = await api(`/api/chats/${chatId}/messages/${m.id}/fixar`, { method: 'POST' });
      setChat(c => ({ ...c, messages: c.messages.map(x => (x.id === m.id ? { ...x, fixada: r.fixada || undefined } : x)) }));
    } catch (e) { toast(e.message, 'error'); }
  }
  async function renomear() {
    const t = await ov.ask({ title: 'Renomear conversa', value: title, action: 'Renomear' });
    if (!t || !chatId) return;
    try {
      await api(`/api/chats/${chatId}`, { method: 'PUT', body: { title: t } });
      setChat(c => ({ ...c, title: t }));
      refresh();
    } catch (e) { toast(e.message, 'error'); }
  }
  const stop = () => { queueRef.current?.cancel(); if (chatId) api(`/api/chats/${chatId}/cancel`, { method: 'POST' }).catch(() => {}); ctrl.current?.abort(); };
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
      // 1:1 é uma conversa só por agente; nova conversa só faz sentido em grupo/projeto
      (isGroup || project) && { label: 'Nova conversa', icon: 'plus', onSelect: () => go(`/p/${projectId}/new?agents=${memberIds.join(',')}`) },
      wide && { label: panel ? 'Recolher painel' : 'Mostrar painel', icon: 'sidebar', hint: 'Ctrl .', onSelect: togglePanel }
    ];
    if (chatId && chat) chatMenu(e, { ...chat, id: chatId, title }, extra);
    else ov.menu(e, extra, 'Nova conversa');
  }

  return (
    <div className={`chat ${showPanel ? 'with-panel' : ''}`} onKeyDown={onChatKey}>
      <div className="chat-main">
        <header className="chat-head" onContextMenu={openMenu}>
          <button type="button" className="icon-btn chat-menu-btn" aria-label="Abrir menu" onClick={() => dispatchEvent(new Event('ripper:open-drawer'))}><Icon name="menu" /></button>
          <div className="chat-who">
            {project && <><a href={`#/p/${project.id}`} className="crumb-link project-crumb"><Icon name="folder" size={15} />{project.name}</a><Icon name="arrowR" size={13} className="crumb-sep" /></>}
            {isGroup
              ? <span className="who-group">
                  <span className="avatar-stack">{members.slice(0, 4).map(a => <AgentAvatar key={a.id} agent={a} size={22} paused={!busy[a.id]} state={busy[a.id] ? 'working' : undefined} />)}</span>
                  <span className="who-names">{members.map((a, i) => <span key={a.id} style={{ color: agentColor(a) }}>{a.name}{i < members.length - 1 ? ', ' : ''}</span>)}</span>
                </span>
              : <span className="who-one"><AgentAvatar agent={agent} size={24} state={live ? 'working' : undefined} paused={!live} /><b>{agent.name}</b><StatusDot status={agent.status} /></span>}
            {chatId && <button type="button" className="chat-title-btn" onClick={renomear} aria-label={`Renomear a conversa: ${title}`} title="Renomear conversa"><span>{title}</span><Icon name="edit" size={12} /></button>}
            {pendAprov > 0 && <span className="chip-aprovacao" role="status">{pendAprov === 1 ? '1 pedido seu' : `${pendAprov} pedidos seus`}</span>}
          </div>
          {messages.length > 0 && <button type="button" className="icon-btn chat-search-btn" aria-label="Buscar na conversa" title="Buscar na conversa (Ctrl F)" aria-expanded={!!search}
            onClick={() => { setSearch(s => s ? null : { q: '', at: 0 }); setTimeout(() => searchRef.current?.focus()); }}><Icon name="search" size={16} /></button>}
        </header>
        {search && (
          <div className="chat-search" role="search">
            <Icon name="search" size={14} />
            <input ref={searchRef} className="chat-search-input" aria-label="Buscar na conversa" placeholder="Buscar na conversa…" value={search.q}
              onChange={e => setSearch({ q: e.target.value, at: 0 })}
              onKeyDown={e => { if (e.key === 'Escape') setSearch(null); else if (e.key === 'Enter' && matches.length) { e.preventDefault(); goHit(e.shiftKey ? -1 : 1); } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && matches.length) { e.preventDefault(); goHit(e.key === 'ArrowDown' ? 1 : -1); } }} />
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
            {messages.length >= 30 && <ResumoConversa messages={messages} />}
            {fixadas.length > 0 && (
              <nav className="fixadas" aria-label="Respostas fixadas">
                <b>Fixadas</b>
                {fixadas.map(({ m, i }) => <button key={m.id || i} type="button" className="link" onClick={() => document.querySelector(`[data-mi="${i}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}>{plain(m.content).slice(0, 70) || 'Resposta'}</button>)}
              </nav>
            )}
            {[...messages.map((m, i) => <div key={i} data-mi={i} className={[i >= animateFrom.current && 'is-new', matches.includes(i) && `search-hit${matches[hit] === i ? ' current' : ''}`].filter(Boolean).join(' ') || undefined}>{i === primeiroNovo && primeiroNovo > 0 && <div className="novas-divider" role="separator"><span>Novo desde a sua última visita</span></div>}{m.via?.type === 'inbox' && inCard.has(m.via.messageId) ? null : m.inbox ? <InboxMessage m={m} from={getAgent(m.inbox.from)} /> : m.role === 'user'
              ? <UserMessage m={m} name={S.settings.name} files={S.files} ack={m === lastUser && ack?.id === m.id ? ack : null} onRetryAck={ack?.retry} onEdit={canEdit && m.id && !/^u\d+$/.test(m.id) ? text => editFrom(m, text) : null} />
              : <>{m.via?.type === 'inbox' && m.via.threadChatId && <ViaLabel m={m} onOpen={setThread} />}<BotMessage m={m} agent={getAgent(m.agentId) || agent} group={isGroup || (!!m.agentId && m.agentId !== agent.id)} models={S.models} allFiles={S.files} deleg={deleg} onFileError={msg => toast(msg, 'error')} onRetry={m === messages.at(-1) && lastUser ? () => send({ text: lastUser.content }) : null} onContinue={m === messages.at(-1) ? continuar : null} onRetryWith={m === messages.at(-1) && lastUser ? refazerCom : null} onPin={m.id && !m.inbox ? () => fixar(m) : null} /></>}</div>),
              live && <div key={messages.length} className="is-new"><BotMessage m={live} agent={getAgent(live.agentId) || agent} group={isGroup} live phase={phase} onStop={stop} models={S.models} deleg={deleg} /></div>]}
          </div>
          {longe && <div className="jump-end-wrap"><button type="button" className="jump-end" onClick={() => { stick.current = true; setLonge(false); setNovas(0); scroller.current?.scrollTo({ top: 1e9, behavior: 'smooth' }); }}>{novas ? `${novas} ${novas === 1 ? 'nova' : 'novas'} · ` : ''}Ir para o fim</button></div>}
        </div>

        <div className="chat-dock">
          {aviso && <p className="aviso-banner" role="status"><Icon name="clock" size={13} />{aviso}<button type="button" className="link" onClick={() => setAviso(null)}>Fechar</button></p>}
          {interrupted && !live && (
            <div className="chat-recovery-banner" role="status">
              <p>Conexão interrompida — retome ou reenvie.</p>
              <button type="button" className="btn sm" onClick={() => send({ resume: true })}>Retomar resposta</button>
            </div>
          )}
          {(held > 0 || phase === 'approval') && <p className="inbox-wait" role="status"><Icon name="clock" size={13} />{phase === 'approval' ? 'Esperando sua aprovação acima. ' : 'Esperando esta resposta terminar. '}{held > 0 ? (held === 1 ? 'Sua mensagem vai em seguida.' : `Suas ${held} mensagens vão em seguida.`) : 'O que você escrever agora vai depois.'}</p>}
          {<WorkspaceBar chat={chat} chatId={chatId} agents={isGroup ? members : [agent]} pending={pendingWs} setPending={setPendingWs} onChanged={c => setChat(x => ({ ...x, ...c }))} />}
          <Composer agent={agent} chatId={chatId} projectId={projectId} streaming={!!live} onSend={queueSend} onStop={stop}
            choice={choice} setChoice={setChoice} group={isGroup} mentions={isGroup ? members : S.agents.filter(a => a.id !== agent.id)}
            placeholder={isGroup ? 'Mensagem para o grupo… use @Nome para chamar alguém' : `Mensagem para ${agent.name}…`} autoFocus draftKey={chatId || 'new-' + memberIds.join('-')} />
          {queued.length > 0 && <div className="queued-list" role="status">
            <p className="inbox-wait queued-note"><Icon name="clock" size={13} />
              {queued.length === 1 ? 'Sua mensagem está na fila' : `${queued.length} mensagens na fila`}: {isGroup ? 'o grupo vai ler' : `${agent.name} vai ler`} depois do passo atual.
              {queued.length > 1 && <button type="button" className="link" onClick={() => setQueue([])}>Cancelar todas</button>}</p>
            <ul>
              {queued.map((p, i) => (
                <li key={i}><span>{(p.text || '').trim().slice(0, 120) || 'Anexo'}</span>
                  <span className="queued-acoes">
                    <button type="button" className="link" aria-label={`Editar a mensagem ${i + 1} da fila`} onClick={() => { setQueue(queuedRef.current.filter((_, j) => j !== i)); window.dispatchEvent(new CustomEvent('ripper:compose', { detail: { text: p.text || '', anexar: true } })); }}>Editar</button>
                    <button type="button" className="link" aria-label={`Interromper a resposta e enviar a mensagem ${i + 1} agora`} onClick={() => { const alvo = queuedRef.current[i]; setQueue(queuedRef.current.filter((_, j) => j !== i)); stop(); setTimeout(() => send(coalesceSendParts([alvo])), 300); }}>Interromper e enviar</button>
                    <button type="button" className="link" aria-label={`Cancelar a mensagem ${i + 1} da fila`} onClick={() => setQueue(queuedRef.current.filter((_, j) => j !== i))}>Cancelar</button>
                  </span></li>
              ))}
            </ul>
          </div>}
          {waiting > 0 && <p className="inbox-wait"><Icon name="clock" size={13} />Aguardando {waiting === 1 ? 'resposta de 1 mensagem' : `respostas de ${waiting} mensagens`} enviadas a colegas…</p>}
          <p className="fine">{isGroup ? 'Agentes' : `O ${agent.name}`} pode{isGroup ? 'm' : ''} errar. Confira o que for importante.</p>
        </div>
      </div>
      {!showPanel && wide && <div className="panel-collapsed-edge"><ResizeHandle side="right" cssVar="panel-w" min={280} max={620} collapsed label="Abrir painel" onExpand={togglePanel} /><button className="panel-reopen" onClick={togglePanel} aria-label="Mostrar painel" title="Mostrar painel (Ctrl .)"><Icon name="sidebar" size={16} style={{ transform: 'scaleX(-1)' }} /></button></div>}
      {pip && !showPanel && getAgent(pip) && <MiniScreen agent={getAgent(pip)} working={!!busy[pip]} onClose={() => setPip(null)} />}
      {thread && <AgentThread chatId={thread} onClose={() => setThread(null)} Text={Markdown} />}
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
