import { useEffect, useState } from 'react';
import { api } from './lib.js';
import { Icon, EmptyState } from './ui.jsx';

function ProviderUsageBar({ label, pct, resetAt }) {
  if (pct == null) return null;
  const resetLabel = resetAt ? new Date(resetAt).toLocaleString() : null;
  return (
    <div className="usage-bar-block">
      <div className="usage-bar-head"><span>{label}</span><span className="usage-bar-pct">{pct}%</span></div>
      <div className="usage-bar-track"><div className="usage-bar-fill blue" style={{ width: `${Math.min(100, pct)}%` }} /></div>
      {resetLabel && <small className="muted">Reinício ~{resetLabel}</small>}
    </div>
  );
}

function fmtNum(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function DayChart({ byDay }) {
  if (!byDay?.length) return null;
  const max = Math.max(...byDay.map(d => d.charsTotal || 0), 1);
  return (
    <div className="metering-chart" role="img" aria-label="Volume de caracteres por dia">
      {byDay.map(d => (
        <div key={d.day} className="metering-chart-col" title={`${d.day}: ${d.charsTotal} caracteres, ${d.events} eventos`}>
          <div className="metering-chart-bar" style={{ height: `${Math.max(4, (d.charsTotal / max) * 100)}%` }} />
          <time className="muted small">{d.day.slice(5)}</time>
        </div>
      ))}
    </div>
  );
}

function DataTable({ columns, rows, empty }) {
  if (!rows?.length) return empty ? <EmptyState title="sem dados" body="Nenhum evento de uso na janela selecionada." /> : null;
  return (
    <table className="metering-table">
      <thead>
        <tr>{columns.map(c => <th key={c.key}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.id ?? i}>
            {columns.map(c => <td key={c.key}>{c.render ? c.render(row) : row[c.key]}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Painel Enterprise — medição factual (usage.sqlite). */
export function MeteringUsage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api('/api/metering')
      .then(setData)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const exportCsv = async () => {
    const r = await fetch('/api/metering/export', { credentials: 'include' });
    if (!r.ok) throw new Error('Falha ao exportar CSV');
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ripper-usage-events-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (loading) return <p className="muted" role="status">Carregando medição…</p>;
  if (err) return <p className="form-error" role="alert">{err}</p>;
  if (!data) return null;

  const claude = data.providerUsage?.claudeSubscription;
  const win5 = claude?.windows?.fiveHour;
  const win7 = claude?.windows?.sevenDay;

  return (
    <div className="metering-panel">
      <p className="set-card-desc">
        Contagens locais de eventos e caracteres medidos pelo Ripper (até {data.retention?.maxEvents} eventos em disco).
        Sem estimativas de custo ou tokens do provedor quando não estão no banco.
      </p>

      {!data.hasData ? (
        <EmptyState title="sem dados" body="Envie mensagens com modelos registrados para ver agregados aqui." />
      ) : (
        <>
          <div className="metering-totals">
            <div><b>{data.totals.events}</b><small>eventos</small></div>
            <div><b>{fmtNum(data.totals.charsIn)}</b><small>chars entrada</small></div>
            <div><b>{fmtNum(data.totals.charsOut)}</b><small>chars saída</small></div>
            <div><b>{fmtNum(data.totals.charsTotal)}</b><small>chars total</small></div>
          </div>
          <DayChart byDay={data.byDay} />
          <DataTable
            columns={[
              { key: 'label', label: 'Modelo' },
              { key: 'events', label: 'Eventos' },
              { key: 'charsTotal', label: 'Chars', render: r => fmtNum(r.charsTotal) }
            ]}
            rows={data.byModel}
          />
          <h4 className="metering-subhead">Roteamento (Julia / heurística)</h4>
          <DataTable
            columns={[
              { key: 'label', label: 'Origem' },
              { key: 'events', label: 'Eventos' },
              { key: 'charsTotal', label: 'Chars', render: r => fmtNum(r.charsTotal) }
            ]}
            rows={data.byAgent}
          />
        </>
      )}

      {data.providerUsage?.available && (win5?.pct != null || win7?.pct != null) && (
        <section className="metering-provider">
          <h4>Claude Pro/Max (OAuth)</h4>
          <p className="muted small">Leitura real do endpoint de uso quando logado com Claude Code — percentuais do provedor, não valores em dólar.</p>
          {win5?.pct != null && <ProviderUsageBar label="Janela 5 h" pct={win5.pct} resetAt={win5.resetAt} />}
          {win7?.pct != null && <ProviderUsageBar label="Janela 7 dias" pct={win7.pct} resetAt={win7.resetAt} />}
        </section>
      )}

      <div className="set-actions">
        <button type="button" className="btn" onClick={() => exportCsv().catch(e => setErr(e.message))}>
          <Icon name="download" size={16} />Exportar eventos (CSV)
        </button>
      </div>
    </div>
  );
}
