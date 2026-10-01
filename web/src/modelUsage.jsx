import { useEffect, useState } from 'react';
import { useApp } from './app.jsx';
import { api, go } from './lib.js';
import { Icon, Menu } from './ui.jsx';

function fmtTok(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

function UsageBar({ pct, tone = 'blue', label, resetLabel, sublabel }) {
  if (pct == null) return null;
  return (
    <div className="usage-bar-block">
      <div className="usage-bar-head"><span>{label}</span><span className="usage-bar-pct">{pct}%</span></div>
      <div className="usage-bar-track"><div className={`usage-bar-fill ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
      {sublabel && <small className="muted">{sublabel}</small>}
      {resetLabel && <small className="muted">{resetLabel}</small>}
    </div>
  );
}

function ContextRing({ pct, size = 36 }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const show = pct != null && pct > 0;
  const off = show ? c * (1 - Math.min(1, pct / 100)) : c;
  return (
    <svg className="usage-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="3" />
      {show && (
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      )}
    </svg>
  );
}

function SegmentedBar({ categories }) {
  const withPct = categories.filter(c => c.pct != null && c.pct > 0);
  const total = withPct.reduce((n, c) => n + (c.pct || 0), 0) || 1;
  return (
    <div className="usage-seg-bar">
      {withPct.map(c => (
        <span key={c.id} style={{ width: `${(c.pct / total) * 100}%`, background: c.color }} title={c.label} />
      ))}
    </div>
  );
}

function contractFromState(S) {
  const c = S?.usageContract;
  if (c?.accountUsage && c?.providerSnapshot) {
    return {
      account: c.accountUsage,
      provider: c.providerSnapshot,
      context: c.contextWindow,
      tokenBudget: c.accountUsage?.tokenBudget || S?.limits?.tokenBudget
    };
  }
  const lim = S?.limits;
  if (!lim) return null;
  return {
    account: {
      localUsage: lim.localUsage,
      ripperQuota: lim.ripperQuota,
      emptyLabel: lim.localUsage?.totalRecordedEvents ? null : 'sem dados'
    },
    provider: {
      claudeSubscription: lim.claudeSubscription,
      emptyLabel: lim.claudeSubscription?.available ? null : 'sem dados'
    },
    context: { available: false, emptyLabel: 'sem dados' },
    tokenBudget: lim.tokenBudget
  };
}

/** Popover enxuto no chat: contexto + resumo + link para Admin → Uso. */
export default function ModelUsage({ chatId }) {
  const { S, refresh } = useApp();
  const [ctxExpanded, setCtxExpanded] = useState(false);
  const [bundle, setBundle] = useState(() => contractFromState(S));
  const [loadError, setLoadError] = useState(null);
  const [compactBusy, setCompactBusy] = useState(false);

  useEffect(() => { setBundle(contractFromState(S)); }, [S]);

  async function loadDetail(open) {
    if (!open) return;
    setLoadError(null);
    try {
      const q = chatId ? `?chatId=${encodeURIComponent(chatId)}` : '';
      const data = await api('/api/usage' + q);
      setBundle({
        account: data.accountUsage,
        provider: data.providerSnapshot,
        context: data.contextWindow,
        tokenBudget: data.tokenBudget || data.accountUsage?.tokenBudget
      });
    } catch (e) {
      setLoadError(e.message || 'Falha ao carregar uso');
      setBundle(contractFromState(S));
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

  const account = bundle?.account;
  const provider = bundle?.provider;
  const ctx = bundle?.context;
  const tokenBudget = bundle?.tokenBudget;
  const claudeSub = provider?.claudeSubscription;
  const claudeWin = claudeSub?.available ? claudeSub.windows : null;
  const ctxAvailable = ctx?.available === true;
  const ctxPct = ctxAvailable ? ctx.pct : null;
  const r5 = account?.ripperQuota?.rolling5h;
  const wk = account?.ripperQuota?.weekly;

  const localLine = account?.localUsage?.totalRecordedEvents
    ? `${account.localUsage.totalRecordedEvents} eventos locais · ~${fmtTok(account.localUsage.chars5h / 4)} tokens (5 h)`
    : (account?.emptyLabel || 'sem dados');

  return (
    <Menu align="up" className="usage-menu" onOpenChange={loadDetail} trigger={({ toggle, open }) => (
      <button type="button" className="usage-btn" aria-expanded={open} aria-label="Uso e limites" onClick={toggle} title="Uso e limites">
        <ContextRing pct={ctxPct} size={30} />
      </button>
    )}>
      <div className="usage-pop usage-account usage-pop-compact" role="dialog" aria-label="Uso resumido">
        {loadError && <p className="muted small usage-hint">{loadError}</p>}

        <button type="button" className="usage-ctx-summary" onClick={() => setCtxExpanded(v => !v)} aria-expanded={ctxExpanded}>
          <span>
            <b>Janela de contexto</b>
            {ctxAvailable
              ? <span className="mono"> {fmtTok(ctx.usedTokens)} / {fmtTok(ctx.limitTokens ?? 1_000_000)} ({ctxPct}%)</span>
              : <span className="muted small"> — {ctx?.emptyLabel || 'sem dados'}</span>}
          </span>
          <Icon name="down" size={14} className={ctxExpanded ? 'open' : ''} />
        </button>
        {ctxExpanded && ctxAvailable && (
          <div className="usage-ctx-detail">
            <SegmentedBar categories={ctx.categories || []} />
            <div className="usage-ctx-foot">
              <button type="button" className="btn btn-sm" disabled={!chatId || compactBusy || !ctx.compact?.canCompact} onClick={compactSession}>
                {compactBusy ? 'Compactando…' : 'Compactar sessão'}
              </button>
            </div>
          </div>
        )}

        <p className="pop-label">Resumo</p>
        <p className="small">{localLine}</p>

        {claudeWin?.fiveHour?.pct != null && (
          <UsageBar label="Claude 5 h" pct={claudeWin.fiveHour.pct} resetLabel={claudeWin.fiveHour.resetLabel} />
        )}
        {claudeWin?.sevenDay?.pct != null && (
          <UsageBar label="Claude 7 d" pct={claudeWin.sevenDay.pct} resetLabel={claudeWin.sevenDay.resetLabel} />
        )}
        {r5?.configured && r5.pct != null && (
          <UsageBar label="Cota Ripper 5 h" pct={r5.pct} tone={r5.pct >= 100 ? 'red' : 'blue'} resetLabel={r5.resetLabel} />
        )}
        {wk?.configured && wk.pct != null && (
          <UsageBar label="Cota Ripper semanal" pct={wk.pct} tone={wk.pct >= 90 ? 'orange' : 'blue'} resetLabel={wk.resetLabel} />
        )}

        {tokenBudget?.enabled && tokenBudget.scopes?.[0]?.pct != null && (
          <UsageBar
            label="Orçamento configurado"
            pct={tokenBudget.scopes[0].pct}
            tone={tokenBudget.scopes[0].exceeded ? 'red' : 'blue'}
            sublabel={`${tokenBudget.scopes[0].usedTokens} / ${tokenBudget.scopes[0].limitTokens} tokens`}
          />
        )}

        <button type="button" className="btn btn-sm usage-admin-link" onClick={() => go('/admin/uso')}>
          Medição, economia Julia e orçamento → Uso (admin)
        </button>
        <p className="muted small usage-hint">Detalhes, CSV e limites completos ficam no Centro admin.</p>
      </div>
    </Menu>
  );
}
