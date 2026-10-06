import { useEffect, useState } from 'react';
import { api, go, useRoute, fmtAgo } from './lib.js';
import { AgentAvatar, Icon } from './ui.jsx';
import { useApp } from './app.jsx';
import { useT } from './i18n/index.jsx';

const KIND = { exec: 'quer rodar um comando', share: 'quer publicar um link', social: 'quer publicar em webhook', whatsapp: 'quer enviar um WhatsApp', email: 'quer enviar um e-mail', github: 'quer publicar no GitHub', agent: 'quer criar um agente', flow: 'terminou um passo do fluxo' };
/** O que o agente está pedindo, em uma frase (a Caixa mostra isso na linha do mascote). */
export const approvalAsk = rec => rec.kind === 'question' ? 'precisa de você' : rec.kind === 'setting' ? 'sugere uma configuração' : KIND[rec.kind] || 'pede aprovação';

/** Cartão de aprovação: mostra exatamente o que vai acontecer e por que precisa do seu ok. */
export function ApprovalCard(props) {
  return props.rec.kind === 'question' ? <QuestionCard {...props} /> : props.rec.kind === 'setting' ? <SettingCard {...props} /> : <DecisionCard {...props} />;
}

/** "Preciso de você": pergunta aberta do agente, com respostas rápidas e campo livre. */
function QuestionCard({ rec, status, compact, onDone }) {
  const { agent, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const a = agent(rec.agentId);
  const st = status || rec.status;
  async function answer(value) {
    if (!value.trim()) return;
    setBusy(true);
    try { await api(`/api/approvals/${rec.id}`, { method: 'POST', body: { answer: value.trim() } }); onDone?.('approved'); }
    catch (e) { toast(e.message, 'error'); onDone?.('expired'); }
    setBusy(false);
  }
  return (
    <div className={`approval question ${st} ${compact ? 'compact' : ''}`} role="group" aria-label={`${a?.name || 'Agente'} precisa de você`}>
      <div className="approval-head">
        <span className="approval-ico"><Icon name="chat" size={15} /></span>
        <span className="approval-title"><b>{a?.name || rec.agentName || 'Agente'}</b> precisa de você</span>
        {compact && rec.chatTitle && <button className="link approval-chat" onClick={() => go(`/c/${rec.chatId}`)}>{rec.chatTitle}</button>}
      </div>
      <p className="question-text">{rec.command}</p>
      {rec.reason && <p className="approval-why question-context">{rec.reason}</p>}
      {st === 'pending' ? <>
        {rec.options?.length > 0 && <div className="question-options">{rec.options.map(o => <button key={o} type="button" className="pill" disabled={busy} onClick={() => answer(o)}>{o}</button>)}</div>}
        <form className="question-answer" onSubmit={e => { e.preventDefault(); answer(text); }}>
          <textarea className="input" rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="Responda com as suas palavras…" aria-label="Sua resposta"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); answer(text); } }} />
          <button className="btn btn-sm btn-primary" disabled={busy || !text.trim()}><Icon name="arrowR" size={14} />Responder</button>
        </form>
      </> : <p className={`approval-result ${st}`}><Icon name={st === 'approved' ? 'check' : 'x'} size={13} />{st === 'approved' ? `Você respondeu: ${rec.answer || ''}` : st === 'expired' ? 'Ficou sem resposta' : 'Cancelada'}</p>}
    </div>
  );
}

/** Interruptor de configuração oferecido pelo agente: um clique liga/desliga, sem ir às Configurações. */
function SettingCard({ rec, status, compact, onDone }) {
  const { agent, toast, refresh } = useApp();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const a = agent(rec.agentId);
  const st = status || rec.status;
  const v = rec.setting || {};
  async function decide(approve) {
    if (approve && v.sensitive && !confirm) { setConfirm(true); return; }
    setBusy(true);
    try { await api(`/api/approvals/${rec.id}`, { method: 'POST', body: { approve } }); onDone?.(approve ? 'approved' : 'denied'); if (approve) setTimeout(refresh, 300); }
    catch (e) { toast(e.message, 'error'); onDone?.('expired'); }
    setBusy(false);
  }
  const on = st === 'approved' ? v.proposed : v.current;
  return (
    <div className={`approval setting-card ${st} ${compact ? 'compact' : ''}`} role="group" aria-label={`${a?.name || 'Agente'} sugere: ${v.label}`}>
      <div className="setting-row">
        <span className="setting-text"><b>{v.label}</b><small>{rec.reason || v.desc}</small></span>
        <button type="button" role="switch" aria-checked={on} className={`setting-switch ${on ? 'on' : ''}`} disabled={busy || st !== 'pending'} onClick={() => decide(true)}
          aria-label={`${v.proposed ? 'Ligar' : 'Desligar'} ${v.label}`}><i /></button>
      </div>
      {st === 'pending' && confirm && <div className="setting-confirm"><span>Tem certeza? Isso muda a segurança do Ripper.</span><button className="btn btn-sm btn-danger" disabled={busy} onClick={() => decide(true)}>{v.proposed ? 'Ligar mesmo assim' : 'Desligar mesmo assim'}</button><button className="btn btn-sm" onClick={() => setConfirm(false)}>Cancelar</button></div>}
      {st === 'pending' && !confirm && <button className="link setting-dismiss" disabled={busy} onClick={() => decide(false)}>Agora não</button>}
      {st !== 'pending' && <p className={`approval-result ${st}`}><Icon name={st === 'approved' ? 'check' : 'x'} size={13} />{st === 'approved' ? (v.proposed ? 'Ligado' : 'Desligado') : st === 'expired' ? 'Ficou sem resposta' : 'Mantido como estava'}</p>}
      {compact && <small className="muted">{a?.name || rec.agentName} sugeriu{rec.chatTitle ? ` em ${rec.chatTitle}` : ''}</small>}
    </div>
  );
}

function DecisionCard({ rec, status, compact, onDone }) {
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
  const label = { approved: 'Aprovado', denied: 'Recusado', expired: 'Expirou sem resposta', cancelled: 'Cancelado' }[st];
  return (
    <div className={`approval ${st} ${compact ? 'compact' : ''}`} role="group" aria-label="Pedido de aprovação">
      <div className="approval-head">
        <span className="approval-ico"><Icon name={rec.kind === 'share' || rec.kind === 'social' ? 'share' : rec.kind === 'whatsapp' ? 'chat' : rec.kind === 'email' ? 'inbox' : rec.kind === 'github' ? 'plug' : rec.kind === 'flow' ? 'retry' : 'terminal'} size={15} /></span>
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
          <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => decide(false)}>Recusar</button>
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
  const t = useT();
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
  // os da conversa aberta aparecem dentro dela; na Caixa, todos já estão na tela
  const list = parts[0] === 'inbox' ? [] : pending.filter(p => p.chatId !== here);
  useEffect(() => { if (list.length) setOpen(true); }, [list.length]);
  if (!list.length) return null;
  return (
    <aside className={`approval-tray ${open ? 'open' : ''}`} aria-label={t('approval.tray.label')}>
      <button className="tray-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="tray-dot" />{list.length === 1 ? t('approval.tray.one', { n: list.length }) : t('approval.tray.many', { n: list.length })}
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
