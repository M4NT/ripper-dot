import { useEffect, useState } from 'react';
import { Icon } from './ui.jsx';

const SIM_MS = 4000;

/** Campanha de e-mail montada pelo agente, em DEMONSTRAÇÃO: o disparo é só visual, nada é enviado. */
export default function CampaignCard({ rec }) {
  const [sent, setSent] = useState(null); // null = parado; número = simulando; total = concluído
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
      <div className="campaign-head">
        <span className="campaign-ico"><Icon name="inbox" size={15} /></span>
        <b>Campanha de e-mail</b>
        <span className="tag">demonstração</span>
      </div>
      <div className="campaign-mail">
        <b>{rec.subject}</b>
        {rec.preview && <small className="muted">{rec.preview}</small>}
        {rec.body && <p>{rec.body.length > 280 ? rec.body.slice(0, 280) + '…' : rec.body}</p>}
      </div>
      <p className="campaign-meta muted small">{rec.recipients.toLocaleString('pt-BR')} destinatários{rec.audience ? ` · ${rec.audience}` : ''} · descadastro incluso</p>
      {sent === null ? (
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setSent(0)}><Icon name="check" size={14} />Simular envio</button>
      ) : (
        <div className="campaign-progress" aria-live="polite">
          <div className="campaign-bar"><i style={{ width: `${(100 * sent) / rec.recipients}%` }} /></div>
          <small>{done ? 'Simulação concluída' : 'Simulando'} · {sent.toLocaleString('pt-BR')} de {rec.recipients.toLocaleString('pt-BR')}</small>
        </div>
      )}
      <p className="campaign-note small">Modo demonstração: nenhum e-mail foi enviado. O disparo real precisa ser liberado antes.</p>
    </div>
  );
}
