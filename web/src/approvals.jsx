import { useEffect, useState } from 'react';
import { api, go, useRoute, fmtAgo } from './lib.js';
import { AgentAvatar, Icon } from './ui.jsx';
import { useApp } from './app.jsx';

const KIND = { exec: 'quer rodar um comando', share: 'quer publicar um link' };

/** Cartão de aprovação: mostra exatamente o que vai acontecer e por que precisa do seu ok. */
export function ApprovalCard({ rec, status, compact, onDone }) {
  const { agent, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const a = agent(rec.agentId);
  const st = status || rec.status;
  async function decide(approve, remember = false) {
    setBusy(true);
    try { await api(`/api/approvals/${rec.id}`, { method: 'POST', body: { approve, remember } }); onDone?.(approve ? 'approved' : 'denied'); }
    catch (e) { toast(e.message, 'error'); onDone?.('expired'); }
    setBusy(false);
  }
  const label = { approved: 'Aprovado', denied: 'Negado', expired: 'Expirou sem resposta', cancelled: 'Cancelado' }[st];
  return (
    <div className={`approval ${st} ${compact ? 'compact' : ''}`} role="group" aria-label="Pedido de aprovação">
      <div className="approval-head">
        <span className="approval-ico"><Icon name={rec.kind === 'share' ? 'share' : 'terminal'} size={15} /></span>
        <span className="approval-title"><b>{a?.name || rec.agentName || 'Agente'}</b> {KIND[rec.kind] || 'pede aprovação'}</span>
        {compact && rec.chatTitle && <button className="link approval-chat" onClick={() => go(`/c/${rec.chatId}`)}>{rec.chatTitle}</button>}
      </div>
      <pre className="approval-cmd"><code>{rec.command}</code></pre>
      <p className="approval-why"><Icon name="x" size={12} className="why-ico" />Por que pedir: {rec.reason}</p>
      {st === 'pending' ? (
        <div className="approval-actions">
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => decide(true)}><Icon name="check" size={14} />Aprovar</button>
          <button className="btn btn-sm" disabled={busy} onClick={() => decide(true, true)} title="Não pergunta de novo por este mesmo comando nesta conversa">Aprovar sempre aqui</button>
          <div className="grow" />
          <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => decide(false)}>Negar</button>
        </div>
      ) : <p className={`approval-result ${st}`}><Icon name={st === 'approved' ? 'check' : 'x'} size={13} />{label}</p>}
    </div>
  );
}

/**
 * Bandeja global: pedidos de outras conversas e de rotinas (que rodam sem ninguém olhando).
 * Consulta o servidor a cada poucos segundos enquanto a aba está visível.
 */
/** Histórico recente de aprovações (decisões já tomadas). */
export function ApprovalHistory({ limit = 20 }) {
  const { agent } = useApp();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api('/api/approvals').then(r => setRows((r.recent || []).slice(0, limit))).catch(() => setRows([]));
  }, [limit]);
  if (rows === null) return <p className="muted">Carregando histórico…</p>;
  if (!rows.length) return <p className="muted">Nenhuma decisão registrada ainda.</p>;
  return (
    <ul className="rows flat approval-history">
      {rows.map(rec => (
        <li key={rec.id} className="row-item">
          <ApprovalCard rec={rec} status={rec.status} compact />
          <small className="muted">{fmtAgo(rec.decidedAt || rec.createdAt)}</small>
        </li>
      ))}
    </ul>
  );
}

export function ApprovalTray() {
  const { parts } = useRoute();
  const [pending, setPending] = useState([]);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    let alive = true, t;
    const load = async () => {
      if (document.visibilityState === 'visible') { try { const r = await api('/api/approvals'); if (alive) setPending(r.pending); } catch {} }
      t = setTimeout(load, 4000);
    };
    load();
    return () => { alive = false; clearTimeout(t); };
  }, []);
  const here = parts[0] === 'c' ? parts[1] : null;
  const list = pending.filter(p => p.chatId !== here); // os da conversa aberta aparecem dentro dela
  useEffect(() => { if (list.length) setOpen(true); }, [list.length]);
  if (!list.length) return null;
  return (
    <aside className={`approval-tray ${open ? 'open' : ''}`} aria-label="Aprovações pendentes">
      <button className="tray-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="tray-dot" />{list.length} {list.length === 1 ? 'pedido aguardando' : 'pedidos aguardando'} sua aprovação
        <Icon name="down" size={14} className={open ? '' : 'flip'} />
      </button>
      {open && <div className="tray-list">
        {list.map(p => (
          <div key={p.id} className="tray-item">
            <ApprovalCard rec={p} compact onDone={() => setPending(xs => xs.filter(x => x.id !== p.id))} />
            <small className="muted">{fmtAgo(p.createdAt)}</small>
          </div>
        ))}
      </div>}
    </aside>
  );
}
