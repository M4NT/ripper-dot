import { useEffect, useState } from 'react';
import { useApp } from './app.jsx';
import { api } from './lib.js';
import { Icon, Menu } from './ui.jsx';

function fmtTok(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

function UsageBar({ pct, tone = 'blue', label, resetLabel }) {
  return (
    <div className="usage-bar-block">
      <div className="usage-bar-head"><span>{label}</span><span className="usage-bar-pct">{pct}%</span></div>
      <div className="usage-bar-track"><div className={`usage-bar-fill ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
      {resetLabel && <small className="muted">{resetLabel}</small>}
    </div>
  );
}

function ContextRing({ pct, size = 36 }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(1, pct / 100));
  return (
    <svg className="usage-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="3" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent, #4f8ff7)" strokeWidth="3" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}

function SegmentedBar({ categories }) {
  const total = categories.reduce((n, c) => n + (c.pct || 0), 0) || 1;
  return (
    <div className="usage-seg-bar">
      {categories.filter(c => c.pct > 0).map(c => (
        <span key={c.id} style={{ width: `${(c.pct / total) * 100}%`, background: c.color }} title={c.label} />
      ))}
    </div>
  );
}

/** Popover de uso da conta + janela de contexto (dados do servidor). */
export default function ModelUsage({ chatId }) {
  const { S, refresh } = useApp();
  const [expanded, setExpanded] = useState(false);
  const [ctxExpanded, setCtxExpanded] = useState(false);
  const [ctx, setCtx] = useState(null);
  const [limits, setLimits] = useState(S.limits);
  const [compactBusy, setCompactBusy] = useState(false);

  useEffect(() => { setLimits(S.limits); }, [S.limits]);

  async function loadDetail(open) {
    if (!open) return;
    try {
      const [lim, context] = await Promise.all([
        api('/api/usage/limits'),
        api('/api/usage/context' + (chatId ? `?chatId=${encodeURIComponent(chatId)}` : ''))
      ]);
      setLimits(lim);
      setCtx(context);
    } catch {
      setLimits(S.limits);
    }
  }

  async function compactSession() {
    if (!chatId) return;
    setCompactBusy(true);
    try {
      await api('/api/usage/compact', { method: 'POST', body: { chatId } });
      await refresh();
      await loadDetail(true);
    } finally {
      setCompactBusy(false);
    }
  }

  const lim = limits || S.limits;
  const ctxPct = ctx?.pct ?? 0;
  const ctxUsed = ctx?.usedTokens ?? 0;
  const ctxLimit = ctx?.limitTokens ?? 1_000_000;

  return (
    <Menu align="up" className="usage-menu" onOpenChange={loadDetail} trigger={({ toggle, open }) => (
      <button type="button" className="usage-btn" aria-expanded={open} aria-label="Uso e limites da conta" onClick={toggle} title="Uso e limites">
        <ContextRing pct={ctxPct || (lim?.rolling5h?.pct ?? 0)} size={30} />
      </button>
    )}>
      <div className="usage-pop usage-account" role="dialog" aria-label="Uso da conta">
        <button type="button" className="usage-ctx-summary" onClick={() => setCtxExpanded(v => !v)} aria-expanded={ctxExpanded}>
          <span><b>Janela de contexto</b> <span className="mono">{fmtTok(ctxUsed)} / {fmtTok(ctxLimit)} ({ctxPct || 0}%)</span></span>
          <Icon name="down" size={14} className={ctxExpanded ? 'open' : ''} />
        </button>
        {(ctxExpanded || ctx) && ctx && (
          <div className="usage-ctx-detail">
            <SegmentedBar categories={ctx.categories} />
            <ul className="usage-ctx-list">
              {ctx.categories.map(c => (
                <li key={c.id}><span className="usage-swatch" style={{ background: c.color }} />{c.label}<span className="grow" /><span className="mono">{fmtTok(c.tokens)}</span><span className="usage-ctx-pct">{c.pct != null ? `${c.pct}%` : '—'}</span></li>
              ))}
            </ul>
            <div className="usage-ctx-foot">
              <small className="muted">{ctx.untilCompactLabel || '—'}</small>
              <button type="button" className="btn btn-sm" disabled={!chatId || compactBusy} onClick={compactSession} title={chatId ? 'Remove mensagens antigas desta conversa' : 'Abra uma conversa para compactar'}>
                {compactBusy ? 'Compactando…' : 'Compactar sessão'}
              </button>
            </div>
            {ctx.estimate && <p className="muted small">Estimativa local de tokens; não é contagem exata do provedor.</p>}
          </div>
        )}

        <p className="pop-label">Limites de uso do plano · {lim?.plan || 'Pro'}</p>
        {lim && <>
          <UsageBar label="Limite de 5 horas" pct={lim.rolling5h.pct} tone={lim.rolling5h.pct >= 100 ? 'red' : lim.rolling5h.pct >= 80 ? 'orange' : 'blue'} resetLabel={lim.rolling5h.resetLabel} />
          <UsageBar label="Semanal · todos os modelos" pct={lim.weekly.pct} tone={lim.weekly.pct >= 90 ? 'orange' : 'blue'} resetLabel={lim.weekly.resetLabel} />
        </>}

        {lim?.cloudCredits && (
          <div className="usage-cloud">
            <p className="usage-cloud-head"><Icon name="globe" size={14} /> Créditos de sessão na nuvem</p>
            <UsageBar label={`US$ ${lim.cloudCredits.remainingUsd} de US$ ${lim.cloudCredits.totalUsd} restantes`} pct={lim.cloudCredits.pctRemaining} tone="blue" />
          </div>
        )}

        {lim?.juliaSavings && (
          <section className="usage-julia">
            <p className="pop-label">Economia Ripper / Julia-1 <span className="tag">estimativa</span></p>
            <p className="small">~{fmtTok(lim.juliaSavings.tokensAvoidedEst)} tokens e ~US$ {lim.juliaSavings.usdAvoidedEst} evitados vs. modelo frontier ({lim.juliaSavings.routedRequests} rotas).</p>
            <p className="muted small">{lim.juliaSavings.note}</p>
          </section>
        )}

        <button type="button" className="link-btn usage-more" onClick={() => setExpanded(v => !v)}>{expanded ? 'Ocultar detalhamento' : 'Ver detalhamento'}</button>
        {expanded && lim?.byModel && (
          <ul className="usage-list">
            {Object.entries(lim.byModel).filter(([k]) => k !== 'auto').map(([k, r]) => (
              <li key={k}><span><b>{r.label}</b><small>{r.sharePct}% do uso local · {r.requests || 0} respostas</small></span></li>
            ))}
          </ul>
        )}
        {lim?.source && <p className="muted small usage-hint">Fonte: {lim.source}. Faturamento real dos provedores: {lim.live?.providerBilling ? 'ligado' : 'indisponível nesta instalação'}.</p>}
      </div>
    </Menu>
  );
}
