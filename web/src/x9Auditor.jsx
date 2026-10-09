import { useState } from 'react';
import { api } from './lib.js';
import { Icon } from './ui.jsx';
import './styles/telas/x9Auditor.css';

const SEV_CLASS = { critical: 'tag-warn', high: 'tag-warn', medium: 'tag', low: 'muted', info: 'muted' };

export default function X9AuditorCard({ compact }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  async function runScan() {
    setLoading(true);
    setErr(null);
    try {
      const data = await api('/api/x9/scan', { method: 'POST', body: {} });
      setResult(data);
    } catch (e) {
      setErr(e.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const findings = result?.findings || [];

  return (
    <div className={compact ? 'x9-compact' : 'x9-panel'}>
      <p className="muted">
        Checklist determinístico sobre settings reais, sandbox/computador, autonomia e APIs disponíveis. Somente leitura — nada é alterado automaticamente.
      </p>
      <div className="set-actions">
        <button type="button" className="btn btn-primary" disabled={loading} onClick={runScan}>
          {loading ? 'Analisando…' : 'Executar varredura X9'}
        </button>
        <a className="btn" href="#/explore">Criar agente a partir do template X9</a>
      </div>
      {err && <p className="form-error">{err}</p>}
      {result && (
        <div className="x9-results">
          <p className="side-label">
            {findings.length} achado(s)
            {result.summary?.bySeverity && Object.keys(result.summary.bySeverity).length > 0 && (
              <small className="muted"> · {Object.entries(result.summary.bySeverity).map(([k, v]) => `${k}: ${v}`).join(', ')}</small>
            )}
          </p>
          {findings.length === 0 ? (
            <p className="muted">Nenhum risco listado pelo checklist com a configuração atual.</p>
          ) : (
            <ul className="x9-findings">
              {findings.map(f => (
                <li key={f.code} className={`x9-finding sev-${f.severity}`}>
                  <span className={`tag ${SEV_CLASS[f.severity] || ''}`}>{f.severity}</span>
                  <code>{f.code}</code>
                  <p>{f.message}</p>
                  {f.remediationSuggestion && <small className="muted">Sugestão: {f.remediationSuggestion}</small>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function X9MarketplaceTeaser() {
  return (
    <a href="#/settings/security" className="market-teaser x9-teaser">
      <Icon name="key" size={20} />
      <span><b>X9 — Auditor</b><small>Varredura de conformidade integrada (modo empresa)</small></span>
      <Icon name="arrowR" size={16} />
    </a>
  );
}
