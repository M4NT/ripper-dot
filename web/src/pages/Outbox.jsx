import { useEffect, useState } from 'react';
import { api, fmtAgo } from '../lib.js';
import { useApp } from '../app.jsx';
import { Icon, EmptyState, Segmented } from '../ui.jsx';
import '../styles/telas/pages/Outbox.css';

const KIND = { 'wa-qr': ['WhatsApp', 'chat'], 'wa-meta': ['WhatsApp (oficial)', 'chat'], email: ['E-mail', 'inbox'], webhook: ['Publicação', 'share'] };

/** Fila de envios: o que falhou por problema temporário (sai sozinho) e o que não saiu (você decide). */
export default function Outbox() {
  const { agent, toast, refresh } = useApp();
  const [data, setData] = useState(null);
  const [view, setView] = useState('all');
  const load = () => api('/api/outbox').then(setData, () => setData({ items: [], counts: {} }));
  useEffect(() => { load(); const t = setInterval(() => document.visibilityState === 'visible' && load(), 10_000); return () => clearInterval(t); }, []);
  async function act(it, what) {
    try { await api(`/api/outbox/${it.id}/${what}`, { method: 'POST' }); toast(what === 'retry' ? 'Vai sair na próxima rodada (até 30s)' : 'Descartado'); load(); refresh(); }
    catch (e) { toast(e.message, 'error'); }
  }
  if (!data) return <div className="page narrow"><p className="muted">Carregando…</p></div>;
  const items = data.items.filter(i => view === 'all' || i.status === view);
  return (
    <div className="page narrow">
      <header className="page-head"><div><h1>Fila de envios</h1><p className="lede">WhatsApp, e-mails e publicações que não saíram de primeira. Falha passageira (rede, servidor fora) tenta de novo sozinha: em 1, 5, 15 minutos, 1 e 4 horas. Se não der, fica aqui para você decidir.</p></div></header>
      {data.items.length > 0 && <div className="toolbar"><Segmented label="Mostrar" value={view} onChange={setView} items={[['all', 'Tudo', data.items.length], ['pending', 'Na fila', data.counts.pending || 0], ['dead', 'Não saíram', data.counts.dead || 0]]} /></div>}
      {!items.length ? <EmptyState title="Nada pendente" body="Quando um envio falhar por queda de rede ou servidor fora do ar, ele aparece aqui e sai sozinho quando voltar." />
        : <ul className="rows">{items.map(it => {
          const [label, ico] = KIND[it.kind] || [it.kind, 'share'];
          return (
            <li key={it.id} className={`row-item outbox-row ${it.status}`}>
              <span className="thumb file-ico"><Icon name={ico} size={18} /></span>
              <div className="row-main">
                <b>{label} → {it.target || '—'}</b>
                <small>{it.status === 'dead' ? 'Não saiu' : `Próxima tentativa ${it.nextAt <= Date.now() ? 'agora' : fmtAgo(2 * Date.now() - it.nextAt).replace('há ', 'em ')}`} · {it.attempts} {it.attempts === 1 ? 'tentativa' : 'tentativas'} · {agent(it.agentId)?.name || 'sistema'} · {fmtAgo(it.createdAt)}</small>
                {(it.subject || it.text) && <span className="lib-snippet">{it.subject ? `${it.subject} — ` : ''}{it.text}</span>}
                {it.lastError && <small className="outbox-err">{it.lastError}</small>}
              </div>
              <div className="row">
                <button type="button" className="btn btn-sm" onClick={() => act(it, 'retry')}><Icon name="retry" size={14} />{it.status === 'dead' ? 'Reenviar' : 'Tentar agora'}</button>
                <button type="button" className="icon-btn sm" aria-label="Descartar este envio" onClick={() => act(it, 'discard')}><Icon name="trash" size={16} /></button>
              </div>
            </li>
          );
        })}</ul>}
    </div>
  );
}
