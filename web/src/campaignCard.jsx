import { useEffect, useState } from 'react';
import { Icon } from './ui.jsx';
import { api } from './lib.js';

const SIM_MS = 4000;
const LIVE = new Set(['aguardando aprovação', 'enviando', 'parando']);

/** Campanha de e-mail montada pelo agente. Com lista e e-mail conectado é de verdade; senão é demonstração (nada sai). */
export default function CampaignCard({ rec }) {
  return rec.demo === false ? <RealCampaign rec={rec} /> : <DemoCampaign rec={rec} />;
}

function Head({ demo }) {
  return (
    <div className="campaign-head">
      <span className="campaign-ico"><Icon name="inbox" size={15} /></span>
      <b>Campanha de e-mail</b>
      {demo && <span className="tag">demonstração</span>}
    </div>
  );
}

function Mail({ rec }) {
  return (
    <div className="campaign-mail">
      <b>{rec.subject}</b>
      {rec.preview && <small className="muted">{rec.preview}</small>}
      {rec.body && <p>{rec.body.length > 280 ? rec.body.slice(0, 280) + '…' : rec.body}</p>}
    </div>
  );
}

function Bar({ done, total, label }) {
  return (
    <div className="campaign-progress" aria-live="polite">
      <div className="campaign-bar"><i style={{ width: `${(100 * done) / Math.max(1, total)}%` }} /></div>
      <small>{label}</small>
    </div>
  );
}

/** De verdade: acompanha o envio no servidor (um e-mail por vez) e deixa parar. */
function RealCampaign({ rec }) {
  const [c, setC] = useState(null);
  useEffect(() => {
    let on = true, t;
    const tick = () => api(`/api/campaigns/${rec.campaignId}`).then(x => { if (!on) return; setC(x); if (LIVE.has(x.status)) t = setTimeout(tick, 2500); }).catch(() => {});
    tick();
    return () => { on = false; clearTimeout(t); };
  }, [rec.campaignId]);
  const stop = () => api(`/api/campaigns/${rec.campaignId}/stop`, { method: 'POST' }).then(setC).catch(() => {});
  const total = c?.total ?? rec.recipients, done = (c?.sent || 0) + (c?.failed || 0);
  const label = !c ? 'Carregando…'
    : c.status === 'aguardando aprovação' ? 'Esperando a sua aprovação'
    : c.status === 'recusada' ? 'Você não aprovou: nada foi enviado'
    : `${{ enviando: 'Enviando', parando: 'Parando', parada: 'Envio parado', 'concluída': 'Envio concluído', falhou: 'Falhou' }[c.status] || c.status} · ${c.sent} de ${total} enviados${c.failed ? ` · ${c.failed} falharam` : ''}`;
  return (
    <div className="campaign" role="group" aria-label="Campanha de e-mail">
      <Head demo={false} />
      <Mail rec={rec} />
      <p className="campaign-meta muted small">{total.toLocaleString('pt-BR')} contatos da lista {rec.list}{rec.audience ? ` · ${rec.audience}` : ''} · descadastro no rodapé</p>
      <Bar done={done} total={total} label={label} />
      {c?.status === 'enviando' && <button type="button" className="btn btn-sm" onClick={stop}><Icon name="x" size={14} />Parar envio</button>}
      {c?.errors?.length > 0 && <p className="campaign-note small">{c.errors[0]}</p>}
    </div>
  );
}

/** Demonstração: o disparo é só visual, nada é enviado. */
function DemoCampaign({ rec }) {
  const [sent, setSent] = useState(null);
  useEffect(() => {
    if (sent === null || sent >= rec.recipients) return;
    const t0 = performance.now(), from = sent;
    let raf = requestAnimationFrame(function step(now) {
      const k = Math.min(1, (now - t0) / SIM_MS);
      setSent(Math.round(from + (rec.recipients - from) * (1 - (1 - k) ** 2)));
      if (k < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [sent === null]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = sent !== null && sent >= rec.recipients;
  return (
    <div className="campaign" role="group" aria-label="Campanha de e-mail (demonstração)">
      <Head demo />
      <Mail rec={rec} />
      <p className="campaign-meta muted small">{rec.recipients.toLocaleString('pt-BR')} destinatários{rec.audience ? ` · ${rec.audience}` : ''} · descadastro incluso</p>
      {sent === null
        ? <button type="button" className="btn btn-sm btn-primary" onClick={() => setSent(0)}><Icon name="check" size={14} />Simular envio</button>
        : <Bar done={sent} total={rec.recipients} label={`${done ? 'Simulação concluída' : 'Simulando'} · ${sent.toLocaleString('pt-BR')} de ${rec.recipients.toLocaleString('pt-BR')}`} />}
      <p className="campaign-note small">Modo demonstração: nenhum e-mail foi enviado. Para enviar de verdade, anexe a lista de contatos e conecte um e-mail.</p>
    </div>
  );
}
