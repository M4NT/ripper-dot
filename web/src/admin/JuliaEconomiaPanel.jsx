import { useEffect, useState } from 'react';
import { api } from '../lib.js';
import { EmptyState } from '../ui.jsx';

function fmtTok(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

function fmtChars(n) {
  if (n == null) return '—';
  return n.toLocaleString('pt-BR');
}

function CascadeTable({ rows }) {
  if (!rows?.length) return null;
  return (
    <table className="metering-table">
      <thead>
        <tr><th>Quando</th><th>Decisão</th><th>Chars medidos</th></tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.id}>
            <td className="mono small">{row.at ? new Date(row.at).toLocaleString('pt-BR') : '—'}</td>
            <td>{row.decision || row.reason || '—'}</td>
            <td className="mono">{row.savedChars != null ? fmtChars(row.savedChars) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Economia Julia (medida) — somente Admin; sem US$ ou % inventados. */
export default function JuliaEconomiaPanel() {
  const [tokenRoi, setTokenRoi] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/api/usage/token-roi')
      .then(setTokenRoi)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="muted">Carregando economia Julia…</p>;
  if (err) return <p className="form-error">{err}</p>;
  if (!tokenRoi) return null;

  if (!tokenRoi.available) {
    return <EmptyState title="sem dados" body={tokenRoi.emptyLabel || 'Sem telemetria Julia ou eventos de uso registrados ainda.'} />;
  }

  return (
    <div className="admin-uso-section">
      {tokenRoi.usageEvents && (
        <p className="small">
          {tokenRoi.usageEvents.events} eventos de uso · ~{fmtTok(tokenRoi.usageEvents.estTokens)} tokens medidos
          {tokenRoi.usageEvents.routedByJulia > 0 && ` · ${tokenRoi.usageEvents.routedByJulia} com roteamento Julia`}
          {tokenRoi.usageEvents.routedByHeuristic > 0 && ` · ${tokenRoi.usageEvents.routedByHeuristic} heurística`}
        </p>
      )}
      {tokenRoi.semanticCache?.present && tokenRoi.semanticCache.total > 0 && (
        <p className="small">
          Cache semântico: {tokenRoi.semanticCache.hits} acertos, {tokenRoi.semanticCache.misses} falhas
          {tokenRoi.semanticCache.savedChars?.sum > 0 && (
            <> · {fmtChars(tokenRoi.semanticCache.savedChars.sum)} caracteres em acertos (~{fmtTok(tokenRoi.semanticCache.estTokensSaved)} tokens)</>
          )}
        </p>
      )}
      {tokenRoi.semanticCache?.present && !tokenRoi.semanticCache.total && (
        <p className="muted small">Cache semântico: {tokenRoi.semanticCache.emptyLabel || 'sem dados'}</p>
      )}
      {tokenRoi.cascade?.present && tokenRoi.cascade.total > 0 && (
        <>
          <p className="small">
            Cascata: {tokenRoi.cascade.total} decisões
            {tokenRoi.cascade.savedChars?.sum > 0 && (
              <> · {fmtChars(tokenRoi.cascade.savedChars.sum)} caracteres medidos em economia</>
            )}
          </p>
          <CascadeTable rows={tokenRoi.cascade.recent} />
        </>
      )}
      {tokenRoi.cascade?.present && !tokenRoi.cascade.total && (
        <p className="muted small">Cascata: {tokenRoi.cascade.emptyLabel || 'sem dados'}</p>
      )}
      {tokenRoi.juliaDecisions && (
        <p className="small muted">
          Julia: {tokenRoi.juliaDecisions.answered} decisões OK
          {tokenRoi.juliaDecisions.avoidedPromptChars?.sum > 0 && (
            <> · ~{fmtChars(tokenRoi.juliaDecisions.avoidedPromptChars.sum)} caracteres de triagem medidos</>
          )}
        </p>
      )}
      <p className="muted small">{tokenRoi.note || 'Sem estimativa de economia em US$ — só eventos medidos nesta instalação.'}</p>
    </div>
  );
}
