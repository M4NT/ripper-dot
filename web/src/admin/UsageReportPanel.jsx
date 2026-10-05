import { useEffect, useState } from 'react';
import { api } from '../lib.js';

const iso = d => d.toISOString().slice(0, 10);
const daysAgo = n => iso(new Date(Date.now() - n * 86400_000));
const PRESETS = [['7', 'Últimos 7 dias'], ['30', '30 dias'], ['90', '90 dias'], ['custom', 'Personalizado']];
const GROUPS = [['day', 'Por dia'], ['agent', 'Por agente'], ['model', 'Por modelo']];
const nf = new Intl.NumberFormat('pt-BR');
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const usd = v => `US$ ${v.toFixed(v < 1 ? 4 : 2)}`;

/** Uso por período: gráfico de barras (tokens estimados), tabela com totais e CSV. */
export default function UsageReportPanel() {
  const [preset, setPreset] = useState('30');
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(iso(new Date()));
  const [group, setGroup] = useState('day');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const pick = p => {
    setPreset(p);
    if (p !== 'custom') { setFrom(daysAgo(Number(p) - 1)); setTo(iso(new Date())); }
  };
  const qs = new URLSearchParams({ from, to, group }).toString();

  useEffect(() => {
    if (!from || !to) return;
    let off = false;
    setErr('');
    api(`/api/admin/usage?${qs}`).then(d => { if (!off) setData(d); }).catch(e => { if (!off) { setErr(e.message); setData(null); } });
    return () => { off = true; };
  }, [qs]);

  const exportCsv = async () => {
    try {
      const r = await fetch(`/api/admin/usage.csv?${qs}`, { credentials: 'include' });
      if (!r.ok) throw new Error('Falha ao exportar CSV.');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await r.blob());
      a.download = `ripper-uso-${from}-${to}-${group}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { setErr(e.message); }
  };

  const rows = data?.rows || [];
  const tok = r => r.tokensIn + r.tokensOut;
  const max = Math.max(1, ...rows.map(tok));
  const empty = data && data.totals.requests === 0;
  const keyHead = GROUPS.find(g => g[0] === group)[1].replace('Por ', '');

  return (
    <div className="metering-panel">
      <div className="usage-report-filters">
        <div className="seg" role="group" aria-label="Período">
          {PRESETS.map(([v, l]) => <button key={v} type="button" className={preset === v ? 'on' : ''} aria-pressed={preset === v} onClick={() => pick(v)}>{l}</button>)}
        </div>
        {preset === 'custom' && (
          <div className="usage-report-dates">
            <label>De <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></label>
            <label>Até <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></label>
          </div>
        )}
        <div className="seg" role="group" aria-label="Agrupar">
          {GROUPS.map(([v, l]) => <button key={v} type="button" className={group === v ? 'on' : ''} aria-pressed={group === v} onClick={() => setGroup(v)}>{l}</button>)}
        </div>
        <button type="button" className="btn btn-sm" onClick={exportCsv} disabled={!data}>Exportar CSV</button>
      </div>

      {err && <p className="form-error" role="alert">{err}</p>}
      {!data && !err && <p className="muted" role="status">Carregando…</p>}
      {empty && <p className="muted">Nenhum uso registrado neste período.</p>}

      {data && !empty && (
        <>
          <div className="usage-chart-box">
            <div className="usage-chart" role="img" aria-label={`Tokens estimados ${keyHead === 'dia' ? 'por dia' : `por ${keyHead}`}: total ${nf.format(tok(data.totals))}. Detalhes na tabela abaixo.`}>
              {rows.map(r => (
                <div key={r.key} className="usage-chart-col" title={`${r.label}: ${nf.format(tok(r))} tokens`}>
                  <span className="usage-chart-val">{compact.format(tok(r))}</span>
                  <span className="usage-chart-bar" style={{ height: `calc(${tok(r) / max} * (100% - 44px))` }} />
                  <span className="usage-chart-key">{group === 'day' ? r.key.slice(5).split('-').reverse().join('/') : r.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="usage-table-box">
            <table className="metering-table">
              <thead><tr><th scope="col">{keyHead[0].toUpperCase() + keyHead.slice(1)}</th><th scope="col">Respostas</th><th scope="col">Tokens entrada</th><th scope="col">Tokens saída</th><th scope="col">Custo</th></tr></thead>
              <tbody>
                {rows.map(r => <tr key={r.key}><td>{r.label}</td><td>{nf.format(r.requests)}</td><td>{nf.format(r.tokensIn)}</td><td>{nf.format(r.tokensOut)}</td><td>{usd(r.costUsd)}</td></tr>)}
              </tbody>
              <tfoot><tr><th scope="row">Total</th><td>{nf.format(data.totals.requests)}</td><td>{nf.format(data.totals.tokensIn)}</td><td>{nf.format(data.totals.tokensOut)}</td><td>{usd(data.totals.costUsd)}</td></tr></tfoot>
            </table>
          </div>
          {data.totals.costEstimated && <p className="muted small">Tokens e custo são estimados (~4 caracteres por token, preços do catálogo). Datas em UTC.</p>}
        </>
      )}
    </div>
  );
}
