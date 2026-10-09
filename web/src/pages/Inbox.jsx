import { useEffect, useRef, useState } from 'react';
import { api, go, fmtAgo } from '../lib.js';
import { useApp } from '../app.jsx';
import { AgentAvatar, Icon, Segmented, EmptyState } from '../ui.jsx';
import ErrorNote from '../errorNote.jsx';
import { ApprovalCard, approvalAsk } from '../approvals.jsx';
import '../styles/telas/pages/Inbox.css';

const FILTERS = [['all', 'Tudo'], ['approval', 'Aprovações'], ['notice', 'Recados'], ['routine', 'Rotinas'], ['spend', 'Gasto'], ['system', 'Sistema']];

/**
 * Caixa: o que pede a sua atenção, num lugar só. Aprovações (alguém está esperando), recados dos
 * agentes de canal (o que o cliente pediu e o que fazer) e novidades de rotina.
 * Substitui ler a conversa "· Avisos" de cima a baixo.
 */
// Aprovação que dá para decidir com sim/não (pergunta aberta pede texto, fica fora do lote)
const decidable = it => it.kind === 'approval' && it.approval?.kind !== 'question' && it.approval?.status === 'pending';
const typing = el => el?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"], dialog');

export default function Inbox() {
  const { refresh, toast } = useApp();
  const [box, setBox] = useState(null);
  const [filter, setFilter] = useState('all');
  const [sel, setSel] = useState(() => new Set());
  const [cur, setCur] = useState(-1);
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);
  const load = () => api('/api/inbox').then(setBox).catch(() => setBox({ items: [], count: 0 }));
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 8000);
    return () => clearInterval(t);
  }, []);
  const settle = async () => { await load(); refresh(); };

  const items = box ? box.items.filter(i => filter === 'all' || i.kind === filter) : [];
  const pend = items.filter(decidable);
  // a seleção só vale para o que ainda está pendente na tela
  const chosen = pend.filter(it => sel.has(it.id));
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function decideMany(list, approve) {
    if (!list.length || busy) return;
    setBusy(true);
    const r = await Promise.allSettled(list.map(it => api(`/api/approvals/${it.approval.id}`, { method: 'POST', body: { approve } })));
    const ok = r.filter(x => x.status === 'fulfilled').length;
    if (ok === list.length) toast(`${ok} ${approve ? (ok === 1 ? 'aprovada' : 'aprovadas') : (ok === 1 ? 'recusada' : 'recusadas')}`);
    else toast(`${ok} de ${list.length} decididas; as outras já tinham expirado`, 'error');
    setSel(new Set()); setBusy(false); settle();
  }

  // Atalhos: J/K navegam, X marca, A aprova, R recusa (a seleção, ou o item em foco)
  const keys = useRef();
  keys.current = e => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || document.querySelector('.hub-overlay, dialog[open]')) return;
    const k = e.key.toLowerCase();
    if (k === 'j' || k === 'k') {
      if (!items.length) return;
      e.preventDefault();
      const n = Math.max(0, Math.min(items.length - 1, cur + (k === 'j' ? 1 : -1)));
      setCur(n);
      listRef.current?.children[n]?.focus();
    } else if (k === 'x' && items[cur] && decidable(items[cur])) { e.preventDefault(); toggle(items[cur].id); }
    else if (k === 'a' || k === 'r') {
      const list = chosen.length ? chosen : items[cur] && decidable(items[cur]) ? [items[cur]] : [];
      if (list.length) { e.preventDefault(); decideMany(list, k === 'a'); }
    }
  };
  useEffect(() => { const f = e => keys.current(e); addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, []);

  if (!box) return <div className="page v2"><p className="muted">Carregando…</p></div>;
  const count = k => box.items.filter(i => k === 'all' || i.kind === k).length;
  return (
    <div className="page v2 inbox-page">
      <header className="page-head">
        <div><h1>Caixa</h1><p className="lede">O que os agentes precisam de você: aprovações, recados de clientes e novidades das rotinas.</p></div>
        <div className="row"><a className="btn" href="#/outbox" title="Mensagens, e-mails e publicações que falharam e vão tentar de novo">Fila de envios</a><a className="btn" href="#/log">Ações externas</a></div>
      </header>
      <div className="toolbar">
        {/* só os filtros que têm algo (e o selecionado): sete abas com 0 eram ruído */}
        <Segmented label="Filtrar a caixa" value={filter} onChange={f => { setFilter(f); setCur(-1); }} items={FILTERS.filter(([k]) => k === 'all' || k === filter || count(k) > 0).map(([k, l]) => [k, l, count(k)])} />
      </div>
      {pend.length > 1 && (
        <div className={`bulk-approvals ${chosen.length ? 'on' : ''}`} role="toolbar" aria-label="Aprovações em lote">
          <label className="bulk-all"><input type="checkbox" checked={chosen.length === pend.length} ref={el => { if (el) el.indeterminate = chosen.length > 0 && chosen.length < pend.length; }}
            onChange={e => setSel(new Set(e.target.checked ? pend.map(it => it.id) : []))} />
            <span>{chosen.length ? `${chosen.length} de ${pend.length} selecionadas` : `Selecionar as ${pend.length} aprovações`}</span></label>
          {chosen.length > 0 && <div className="bulk-approvals-actions">
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => decideMany(chosen, true)}><Icon name="check" size={14} />Aprovar {chosen.length}</button>
            <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => decideMany(chosen, false)}>Recusar {chosen.length}</button>
          </div>}
        </div>
      )}
      {items.length === 0
        ? <EmptyState title="Nada esperando por você" body={filter === 'all' ? 'Quando um agente pedir aprovação, deixar um recado de cliente ou uma rotina trouxer novidade, aparece aqui.' : 'Nada deste tipo agora.'} />
        : <ul className="inbox-list" ref={listRef}>{items.map((it, i) => (
            <li key={`${it.kind}-${it.id}`} tabIndex={-1} onFocus={e => e.target === e.currentTarget && setCur(i)} aria-current={i === cur || undefined}
              className={`inbox-item ${it.kind} ${it.urgent ? 'urgent' : ''} ${decidable(it) && sel.has(it.id) ? 'selected' : ''}`}>
              {it.kind === 'approval' && <ApprovalItem it={it} onDone={settle} picked={decidable(it) ? sel.has(it.id) : null} onPick={() => toggle(it.id)} />}
              {it.kind === 'notice' && <NoticeItem it={it} onDone={settle} />}
              {it.kind === 'routine' && <RoutineItem it={it} onDone={settle} />}
              {it.kind === 'spend' && <SpendItem it={it} onDone={settle} />}
              {it.kind === 'system' && <SystemItem it={it} onDone={settle} />}
            </li>
          ))}</ul>}
      {items.length > 0 && <p className="inbox-keys" aria-hidden="true"><kbd>J</kbd><kbd>K</kbd> navegar · <kbd>X</kbd> marcar · <kbd>A</kbd> aprovar · <kbd>R</kbd> recusar</p>}
    </div>
  );
}

function Who({ it, label, picked, onPick }) {
  const { agent } = useApp();
  const a = agent(it.agentId);
  return (
    <div className="inbox-who">
      {picked != null && <input type="checkbox" className="inbox-pick" checked={picked} onChange={onPick} aria-label={`Selecionar o pedido de ${it.agentName}`} />}
      {a && <AgentAvatar agent={a} size={28} paused />}
      <span><b>{it.approval?.kind === 'documento' ? 'Cartão de compra' : it.agentName}</b> {label}</span>
      <time>{fmtAgo(it.at)}</time>
    </div>
  );
}

function ApprovalItem({ it, onDone, picked, onPick }) {
  return <>
    <Who it={it} label={approvalAsk(it.approval)} picked={picked} onPick={onPick} />
    <ApprovalCard rec={it.approval} onDone={onDone} />
  </>;
}

function NoticeItem({ it, onDone }) {
  const { toast } = useApp();
  const [history, setHistory] = useState(null);
  const done = async () => { await api(`/api/inbox/notice/${it.id}/done`, { method: 'POST' }); toast('Recado resolvido'); onDone(); };
  const toggleHistory = async () => {
    if (history) return setHistory(null);
    try { setHistory((await api(`/api/whatsapp-web/history/${it.phone}`)).messages); }
    catch (e) { toast(e.message, 'error'); }
  };
  return <>
    <Who it={it} label={<>recebeu um recado de <b>{it.contact}</b></>} />
    <p className="inbox-summary">{it.summary}</p>
    {it.action && <p className="inbox-action"><Icon name="arrowR" size={14} />{it.action}</p>}
    {history && (
      <ol className="inbox-thread" aria-label="Conversa no WhatsApp">
        {history.length === 0 ? <li className="muted">Sem mensagens guardadas deste contato.</li> : history.map((m, i) => (
          <li key={i} className={m.fromMe ? 'me' : ''}><span>{m.text}</span><time>{fmtAgo(m.at)}</time></li>
        ))}
      </ol>
    )}
    <div className="inbox-actions">
      <button type="button" className="btn btn-sm btn-primary" onClick={() => go(`/c/${it.chatId}`)}><Icon name="chat" size={14} />Responder ao {it.agentName}</button>
      {it.phone && <button type="button" className="btn btn-sm" onClick={toggleHistory} aria-expanded={!!history}>{history ? 'Esconder conversa' : 'Ver conversa no WhatsApp'}</button>}
      <button type="button" className="btn btn-sm" onClick={done}><Icon name="check" size={14} />Resolvido</button>
    </div>
  </>;
}

function SystemItem({ it, onDone }) {
  const ok = async () => { await api(`/api/inbox/system/${it.id}/done`, { method: 'POST' }); onDone(); };
  return <>
    <div className="inbox-who"><Icon name={it.quiet ? 'inbox' : 'bolt'} size={18} /><span><b>{it.title}</b><span className={`tag ${it.quiet ? '' : 'warn '}inbox-urgent`}>{it.quiet ? 'resumo' : 'sistema'}</span></span><time>{fmtAgo(it.at)}</time></div>
    <p className="inbox-summary">{it.body}</p>
    {it.error && <ErrorNote raw={it.error} compact />}
    <div className="inbox-actions">
      {it.href && <button type="button" className="btn btn-sm" onClick={() => go(it.href)}>{it.hrefLabel || 'Abrir'}</button>}
      <button type="button" className="btn btn-sm btn-primary" onClick={ok}>Entendi</button>
    </div>
  </>;
}

function SpendItem({ it, onDone }) {
  const ok = async () => { await api(`/api/inbox/spend/${it.id}/done`, { method: 'POST' }); onDone(); };
  const usd = `US$ ${it.limitUsd.toFixed(2).replace('.', ',')}`;
  return <>
    <Who it={it} label={<>bateu o limite de uso pago<span className="tag warn inbox-urgent">gasto</span></>} />
    <p className="inbox-summary">{it.which === 'total'
      ? `Os agentes juntos gastaram ${usd} hoje em modelos pagos. Até amanhã, nenhum agente usa modelo pago: as respostas seguem pela assinatura.`
      : `${it.agentName} gastou ${usd} hoje em modelos pagos. Até amanhã ele não usa modelo pago: as respostas seguem pela assinatura.`}</p>
    <div className="inbox-actions">
      <button type="button" className="btn btn-sm" onClick={() => go('/settings/models')}>Ajustar limite</button>
      <button type="button" className="btn btn-sm btn-primary" onClick={ok}>Entendi</button>
    </div>
  </>;
}

function RoutineItem({ it, onDone }) {
  const archive = async () => { await api(`/api/inbox/routine/${it.id}/done`, { method: 'POST' }); onDone(); };
  return <>
    <Who it={it} label={<>trouxe novidade de <b>{it.title}</b>{it.urgent && <span className="tag warn inbox-urgent">urgente</span>}</>} />
    <p className={`inbox-summary ${it.failed ? 'is-error' : ''}`}>{it.failed ? 'A rotina falhou nesta execução.' : it.preview}</p>
    <div className="inbox-actions">
      <button type="button" className="btn btn-sm btn-primary" onClick={() => go(`/c/${it.chatId}`)}>Abrir</button>
      <button type="button" className="btn btn-sm" onClick={archive}>Arquivar</button>
    </div>
  </>;
}
