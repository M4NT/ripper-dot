import { useEffect, useState } from 'react';
import { api, go, fmtAgo } from '../lib.js';
import { useApp } from '../app.jsx';
import { AgentAvatar, Icon, Segmented, EmptyState } from '../ui.jsx';
import { ApprovalCard } from '../approvals.jsx';

const FILTERS = [['all', 'Tudo'], ['approval', 'Aprovações'], ['notice', 'Recados'], ['routine', 'Rotinas'], ['spend', 'Gasto'], ['system', 'Sistema']];

/**
 * Caixa: o que pede a sua atenção, num lugar só. Aprovações (alguém está esperando), recados dos
 * agentes de canal (o que o cliente pediu e o que fazer) e novidades de rotina.
 * Substitui ler a conversa "· Avisos" de cima a baixo.
 */
export default function Inbox() {
  const { refresh } = useApp();
  const [box, setBox] = useState(null);
  const [filter, setFilter] = useState('all');
  const load = () => api('/api/inbox').then(setBox).catch(() => setBox({ items: [], count: 0 }));
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 8000);
    return () => clearInterval(t);
  }, []);
  const settle = async () => { await load(); refresh(); };

  if (!box) return <div className="page"><p className="muted">Carregando…</p></div>;
  const count = k => box.items.filter(i => k === 'all' || i.kind === k).length;
  const items = box.items.filter(i => filter === 'all' || i.kind === filter);
  return (
    <div className="page inbox-page">
      <header className="page-head">
        <div><h1>Caixa</h1><p className="lede">O que os agentes precisam de você: aprovações, recados de clientes e novidades das rotinas.</p></div>
        <a className="btn" href="#/log">Ações externas</a>
      </header>
      <div className="toolbar">
        <Segmented label="Filtrar a caixa" value={filter} onChange={setFilter} items={FILTERS.map(([k, l]) => [k, l, count(k)])} />
      </div>
      {items.length === 0
        ? <EmptyState title="Nada esperando por você" body={filter === 'all' ? 'Quando um agente pedir aprovação, deixar um recado de cliente ou uma rotina trouxer novidade, aparece aqui.' : 'Nada deste tipo agora.'} />
        : <ul className="inbox-list">{items.map(it => (
            <li key={`${it.kind}-${it.id}`} className={`inbox-item ${it.kind} ${it.urgent ? 'urgent' : ''}`}>
              {it.kind === 'approval' && <ApprovalItem it={it} onDone={settle} />}
              {it.kind === 'notice' && <NoticeItem it={it} onDone={settle} />}
              {it.kind === 'routine' && <RoutineItem it={it} onDone={settle} />}
              {it.kind === 'spend' && <SpendItem it={it} onDone={settle} />}
              {it.kind === 'system' && <SystemItem it={it} onDone={settle} />}
            </li>
          ))}</ul>}
    </div>
  );
}

function Who({ it, label }) {
  const { agent } = useApp();
  const a = agent(it.agentId);
  return (
    <div className="inbox-who">
      {a && <AgentAvatar agent={a} size={28} paused />}
      <span><b>{it.agentName}</b> {label}</span>
      <time>{fmtAgo(it.at)}</time>
    </div>
  );
}

function ApprovalItem({ it, onDone }) {
  return <>
    <Who it={it} label="pede sua aprovação" />
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
