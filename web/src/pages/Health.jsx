import { useEffect, useState } from 'react';
import { api } from '../lib.js';
import { useApp } from '../app.jsx';
import { Icon } from '../ui.jsx';

/** Painel de saúde: tudo que o Ripper precisa para funcionar, numa tela. */
export default function Health({ onClose }) {
  const { toast } = useApp();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api('/api/health/detalhado').then(setData, e => toast(e.message, 'error'));
  useEffect(() => { load(); const t = setInterval(() => document.visibilityState === 'visible' && load(), 15_000); return () => clearInterval(t); }, []);
  async function report() {
    setBusy(true);
    try {
      const { text } = await api('/api/health/relatorio');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      a.download = `ripper-relatorio-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click(); URL.revokeObjectURL(a.href);
      toast('Relatório baixado, sem dados pessoais. Envie para o suporte.');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }
  return (
    <div className="hub-settings health-page">
      <button className="icon-btn hub-close" aria-label="Fechar" onClick={onClose}><Icon name="x" /></button>
      <h1>Saúde do Ripper</h1>
      <p className="muted">Atualiza sozinho a cada 15 segundos.</p>
      {!data ? <p className="muted">Carregando…</p> : (
        <ul className="health-list">
          {data.items.map(i => (
            <li key={i.label}>
              <i className={`dot health-${i.status}`} aria-hidden />
              <b>{i.label}</b>
              <small>{i.detail}</small>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn" disabled={busy} onClick={report}><Icon name="download" size={16} />{busy ? 'Gerando…' : 'Baixar relatório de erro'}</button>
    </div>
  );
}
