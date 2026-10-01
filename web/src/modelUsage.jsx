import { useEffect, useState } from 'react';
import { useApp } from './app.jsx';
import { api } from './lib.js';
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

function p95Label(latency) {
  return latency?.p95 != null ? ` · p95 ${latency.p95} ms` : '';
}

function juliaFallbackLines(byReason) {
  if (!byReason || typeof byReason !== 'object') return [];
  return Object.entries(byReason).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
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
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent, #4f8ff7)" strokeWidth="3" strokeLinecap="round"
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
      limits: S.limits,
      tokenRoi: c.tokenRoi
    };
  }
  const lim = S?.limits;
  if (!lim) return null;
  return {
    account: {
      available: Boolean(lim.localUsage?.totalRecordedEvents || lim.ripperQuota?.rolling5h?.configured || lim.juliaRouting),
      localUsage: lim.localUsage,
      ripperQuota: lim.ripperQuota,
      cloudCredits: lim.cloudCredits,
      byModel: lim.byModel,
      juliaRouting: lim.juliaRouting,
      emptyLabel: lim.localUsage?.totalRecordedEvents ? null : 'sem dados'
    },
    provider: {
      available: Boolean(lim.claudeSubscription?.available || lim.providers?.length),
      claudeSubscription: lim.claudeSubscription,
      signals: lim.providers || [],
      notes: lim.notes,
      emptyLabel: lim.claudeSubscription?.available ? null : 'sem dados'
    },
    context: { available: false, emptyLabel: 'sem dados' },
    limits: lim,
    tokenRoi: null
  };
}

function fmtChars(n) {
  if (n == null) return '—';
  return n.toLocaleString('pt-BR');
}

function CascadeTable({ rows }) {
  if (!rows?.length) return <p className="muted small">Nenhuma decisão de cascata registrada.</p>;
  return (
    <table className="usage-roi-table small">
      <thead>
        <tr><th>Quando</th><th>Decisão</th><th>Chars</th><th>Tiers</th></tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={`${row.at}-${i}`}>
            <td className="mono">{row.at ? new Date(row.at).toLocaleString('pt-BR') : '—'}</td>
            <td>{row.decision || '—'}{row.ok === false && row.reason ? ` (${row.reason})` : ''}</td>
            <td className="mono">{row.savedChars != null ? fmtChars(row.savedChars) : '—'}</td>
            <td className="muted">{row.tierFrom || row.tierTo ? `${row.tierFrom || '?'} → ${row.tierTo || '?'}` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Popover de uso da conta + janela de contexto (somente dados reais ou configurados). */
export default function ModelUsage({ chatId }) {
  const { S, refresh } = useApp();
  const [expanded, setExpanded] = useState(false);
  const [ctxExpanded, setCtxExpanded] = useState(false);
  const [bundle, setBundle] = useState(() => contractFromState(S));
  const [loadError, setLoadError] = useState(null);
  const [compactBusy, setCompactBusy] = useState(false);
  const [roiExpanded, setRoiExpanded] = useState(false);

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
        limits: data.limits,
        tokenRoi: data.tokenRoi
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
  const lim = bundle?.limits || S?.limits;
  const tokenRoi = bundle?.tokenRoi;

  const r5 = account?.ripperQuota?.rolling5h;
  const wk = account?.ripperQuota?.weekly;
  const hasRipperQuota = r5?.configured || wk?.configured;
  const claudeSub = provider?.claudeSubscription;
  const claudeWin = claudeSub?.available ? claudeSub.windows : null;
  const ctxAvailable = ctx?.available === true;
  const ctxPct = ctxAvailable ? ctx.pct : null;
  const ctxUsed = ctx?.usedTokens;
  const ctxLimit = ctx?.limitTokens ?? 1_000_000;
  const ringPct = ctxPct;

  return (
    <Menu align="up" className="usage-menu" onOpenChange={loadDetail} trigger={({ toggle, open }) => (
      <button type="button" className="usage-btn" aria-expanded={open} aria-label="Uso e limites" onClick={toggle} title="Uso e limites">
        <ContextRing pct={ringPct} size={30} />
      </button>
    )}>
      <div className="usage-pop usage-account" role="dialog" aria-label="Uso da conta">
        {loadError && <p className="muted small usage-hint">{loadError}</p>}

        <button type="button" className="usage-ctx-summary" onClick={() => setCtxExpanded(v => !v)} aria-expanded={ctxExpanded}>
          <span>
            <b>Janela de contexto</b>
            {ctxAvailable
              ? <span className="mono"> {fmtTok(ctxUsed)} / {fmtTok(ctxLimit)} ({ctxPct}%)</span>
              : <span className="muted small"> — {ctx?.emptyLabel || 'sem dados'}</span>}
          </span>
          <Icon name="down" size={14} className={ctxExpanded ? 'open' : ''} />
        </button>
        {(ctxExpanded || ctx) && ctxAvailable && (
          <div className="usage-ctx-detail">
            <SegmentedBar categories={ctx.categories || []} />
            <ul className="usage-ctx-list">
              {(ctx.categories || []).map(c => (
                <li key={c.id}><span className="usage-swatch" style={{ background: c.color }} />{c.label}<span className="grow" /><span className="mono">{fmtTok(c.tokens)}</span><span className="usage-ctx-pct">{c.pct != null ? `${c.pct}%` : '—'}</span></li>
              ))}
            </ul>
            <div className="usage-ctx-foot">
              <small className="muted">{ctx.compact?.messageCount ? `${ctx.compact.messageCount} mensagens` : '—'}</small>
              <button type="button" className="btn btn-sm" disabled={!chatId || compactBusy || !ctx.compact?.canCompact} onClick={compactSession} title={chatId ? 'Remove mensagens antigas desta conversa' : 'Abra uma conversa para compactar'}>
                {compactBusy ? 'Compactando…' : 'Compactar sessão'}
              </button>
            </div>
            {ctx.unmeasuredNote && <p className="muted small">{ctx.unmeasuredNote}</p>}
            {ctx.note && <p className="muted small">{ctx.note}</p>}
          </div>
        )}
        {(ctxExpanded || ctx) && ctx && !ctxAvailable && (
          <p className="muted small usage-hint">Sem medição de contexto ainda. O Ripper não inventa categorias de tokens do provedor.</p>
        )}

        <p className="pop-label">Uso registrado nesta instalação</p>
        {account?.localUsage && (
          <p className="small">
            {account.localUsage.totalRecordedEvents
              ? `${account.localUsage.totalRecordedEvents} eventos · ~${fmtTok(account.localUsage.chars5h / 4)} tokens (5 h) · ~${fmtTok(account.localUsage.chars7d / 4)} tokens (7 d)`
              : (account.emptyLabel || 'sem dados')}
          </p>
        )}

        {claudeSub?.mode === 'subscription' && (
          <section className="usage-julia">
            <p className="pop-label">
              Claude Pro/Max{claudeSub.subscriptionType ? ` (${claudeSub.subscriptionType})` : ''}
              {claudeSub.fragile && <span className="muted small"> · endpoint OAuth (frágil)</span>}
            </p>
            {claudeWin?.fiveHour?.pct != null && (
              <UsageBar
                label="Janela de 5 horas (assinatura)"
                pct={claudeWin.fiveHour.pct}
                tone={claudeWin.fiveHour.pct >= 100 ? 'red' : claudeWin.fiveHour.pct >= 80 ? 'orange' : 'blue'}
                resetLabel={claudeWin.fiveHour.resetLabel}
              />
            )}
            {claudeWin?.sevenDay?.pct != null && (
              <UsageBar
                label="Semanal (assinatura)"
                pct={claudeWin.sevenDay.pct}
                tone={claudeWin.sevenDay.pct >= 90 ? 'orange' : 'blue'}
                resetLabel={claudeWin.sevenDay.resetLabel}
              />
            )}
            {claudeWin?.sevenDayOpus?.pct != null && (
              <UsageBar
                label="Semanal Opus"
                pct={claudeWin.sevenDayOpus.pct}
                tone="blue"
                resetLabel={claudeWin.sevenDayOpus.resetLabel}
              />
            )}
            {claudeSub.available && claudeWin?.extraUsage?.enabled && claudeWin.extraUsage.usedCreditsCents != null && (
              <p className="small">
                Uso extra: US$ {(claudeWin.extraUsage.usedCreditsCents / 100).toFixed(2)}
                {claudeWin.extraUsage.monthlyLimitCents != null && claudeWin.extraUsage.monthlyLimitCents > 0
                  ? ` de US$ ${(claudeWin.extraUsage.monthlyLimitCents / 100).toFixed(2)} (limite mensal)`
                  : ''}
              </p>
            )}
            {!claudeSub.available && claudeSub.hint && (
              <p className="muted small usage-hint">{claudeSub.hint}</p>
            )}
            {claudeSub.available && claudeWin?.fiveHour?.pct == null && claudeWin?.sevenDay?.pct == null && (
              <p className="muted small usage-hint">Login detectado, mas sem percentuais nesta leitura.</p>
            )}
          </section>
        )}
        {claudeSub?.mode === 'api_key' && (
          <p className="muted small usage-hint">{claudeSub.hint}</p>
        )}
        {provider?.available === false && !claudeSub?.hint && provider?.emptyLabel && (
          <p className="muted small usage-hint">Provedor: {provider.emptyLabel}</p>
        )}

        {hasRipperQuota ? (
          <>
            <p className="pop-label muted small">Cotas Ripper (configuradas no servidor)</p>
            {r5?.configured && (
              <UsageBar
                label="Janela de 5 horas (caracteres)"
                pct={r5.pct}
                tone={r5.pct >= 100 ? 'red' : r5.pct >= 80 ? 'orange' : 'blue'}
                resetLabel={r5.resetLabel}
                sublabel={`${r5.usedChars.toLocaleString('pt-BR')} / ${r5.limitChars.toLocaleString('pt-BR')} caracteres`}
              />
            )}
            {wk?.configured && (
              <UsageBar
                label="Semanal (caracteres)"
                pct={wk.pct}
                tone={wk.pct >= 90 ? 'orange' : 'blue'}
                resetLabel={wk.resetLabel}
                sublabel={`${wk.usedChars.toLocaleString('pt-BR')} / ${wk.limitChars.toLocaleString('pt-BR')} caracteres`}
              />
            )}
          </>
        ) : !claudeSub?.available && claudeSub?.mode !== 'api_key' ? (
          <p className="muted small usage-hint">Sem cotas Ripper configuradas. Cotas Pro/Max aparecem com login do Claude Code; defina RIPPER_LIMIT_* para limites locais.</p>
        ) : null}

        {(provider?.signals?.length > 0) && (
          <section className="usage-julia">
            <p className="pop-label">Último bloqueio de cota (provedor)</p>
            <ul className="usage-list">
              {provider.signals.map(p => (
                <li key={p.id}>
                  <span><b>{p.id}</b><small>{p.message?.slice(0, 120)}{(p.message?.length > 120) ? '…' : ''}</small></span>
                  {p.resetLabel && <span className="muted small">{p.resetLabel}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {account?.cloudCredits?.configured && account.cloudCredits.remainingUsd != null && account.cloudCredits.pctRemaining != null && (
          <div className="usage-cloud">
            <p className="usage-cloud-head"><Icon name="globe" size={14} /> Créditos na nuvem (configurados)</p>
            <UsageBar
              label={`US$ ${account.cloudCredits.remainingUsd} de US$ ${account.cloudCredits.totalUsd} restantes`}
              pct={account.cloudCredits.pctRemaining}
              tone="blue"
            />
          </div>
        )}

        <section className="usage-julia">
          <button type="button" className="usage-ctx-summary" onClick={() => setRoiExpanded(v => !v)} aria-expanded={roiExpanded}>
            <span><b>Token ROI (economia Julia)</b></span>
            <Icon name="down" size={14} className={roiExpanded ? 'open' : ''} />
          </button>
          {roiExpanded && (
            <div className="usage-roi-detail">
              {!tokenRoi?.available && (
                <p className="muted small">{tokenRoi?.emptyLabel || 'sem dados'}</p>
              )}
              {tokenRoi?.usageEvents && (
                <p className="small">
                  {tokenRoi.usageEvents.events} eventos de uso · ~{fmtTok(tokenRoi.usageEvents.estTokens)} tokens medidos
                  {tokenRoi.usageEvents.routedByJulia > 0 && ` · ${tokenRoi.usageEvents.routedByJulia} com roteamento Julia`}
                  {tokenRoi.usageEvents.routedByHeuristic > 0 && ` · ${tokenRoi.usageEvents.routedByHeuristic} heurística`}
                </p>
              )}
              {tokenRoi?.semanticCache?.present && tokenRoi.semanticCache.total > 0 && (
                <p className="small">
                  Cache semântico: {tokenRoi.semanticCache.hits} acertos, {tokenRoi.semanticCache.misses} falhas
                  {tokenRoi.semanticCache.savedChars?.sum > 0 && (
                    <> · {fmtChars(tokenRoi.semanticCache.savedChars.sum)} caracteres em acertos (~{fmtTok(tokenRoi.semanticCache.estTokensSaved)} tokens)</>
                  )}
                </p>
              )}
              {tokenRoi?.semanticCache?.present && !tokenRoi.semanticCache.total && (
                <p className="muted small">Cache semântico: {tokenRoi.semanticCache.emptyLabel || 'sem dados'}</p>
              )}
              {tokenRoi?.cascade?.present && tokenRoi.cascade.total > 0 && (
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
              {tokenRoi?.cascade?.present && !tokenRoi.cascade.total && (
                <p className="muted small">Cascata: {tokenRoi.cascade.emptyLabel || 'sem dados'}</p>
              )}
              {tokenRoi?.juliaDecisions && (
                <p className="small muted">
                  Julia: {tokenRoi.juliaDecisions.answered} decisões OK
                  {tokenRoi.juliaDecisions.avoidedPromptChars?.sum > 0 && (
                    <> · ~{fmtChars(tokenRoi.juliaDecisions.avoidedPromptChars.sum)} caracteres de triagem medidos</>
                  )}
                </p>
              )}
              <p className="muted small usage-hint">{tokenRoi?.note || 'Sem estimativa de economia em US$ — só eventos medidos nesta instalação.'}</p>
            </div>
          )}
        </section>

        {account?.juliaRouting && (
          <section className="usage-julia">
            <p className="pop-label">Julia 1 (telemetria local)</p>
            {account.juliaRouting.decisions != null ? (
              <>
                <p className="small">
                  {account.juliaRouting.answered} decisões pela Julia · {account.juliaRouting.fallbacks} reservas (heurística/regra)
                  {account.juliaRouting.latencyMs?.p50 != null && (
                    <> · latência p50 {account.juliaRouting.latencyMs.p50} ms{p95Label(account.juliaRouting.latencyMs)}</>
                  )}
                </p>
                {account.juliaRouting.avoidedPromptChars?.sum > 0 && (
                  <p className="small muted">
                    ~{account.juliaRouting.avoidedPromptChars.sum.toLocaleString('pt-BR')} caracteres de prompt de triagem medidos ({account.juliaRouting.avoidedPromptChars.eventsWithMeasurement} eventos) — não é custo em US$.
                  </p>
                )}
                {juliaFallbackLines(account.juliaRouting.fallbacksByReason).length > 0 && (
                  <ul className="usage-list">
                    {juliaFallbackLines(account.juliaRouting.fallbacksByReason).map(([reason, n]) => (
                      <li key={reason}><span><b>{reason}</b><small>{n} fallback{n === 1 ? '' : 's'}</small></span></li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="muted small">Sem decisões Julia registradas ainda.</p>
            )}
            {account.juliaRouting.usageRoutedByJulia > 0 && (
              <p className="muted small">{account.juliaRouting.usageRoutedByJulia} respostas do modelo grande com roteamento Julia/heurística (uso local).</p>
            )}
            <p className="muted small usage-hint">Sem estimativa de economia em US$ — só eventos medidos nesta instalação.</p>
          </section>
        )}

        <button type="button" className="link-btn usage-more" onClick={() => setExpanded(v => !v)}>{expanded ? 'Ocultar detalhamento' : 'Ver detalhamento por modelo'}</button>
        {expanded && account?.byModel && (
          <ul className="usage-list">
            {Object.entries(account.byModel).filter(([k, r]) => k !== 'auto' && (r.requests || r.charsIn || r.charsOut)).map(([k, r]) => (
              <li key={k}>
                <span>
                  <b>{r.label}</b>
                  <small>
                    {r.sharePct != null ? `${r.sharePct}% do uso local · ` : ''}
                    {r.requests || 0} respostas · {r.charsIn + r.charsOut} caracteres
                  </small>
                </span>
              </li>
            ))}
          </ul>
        )}
        {expanded && account?.localUsage?.totalRecordedEvents === 0 && (
          <p className="muted small">Sem uso por modelo ainda.</p>
        )}

        {(provider?.notes?.providerBilling || lim?.notes?.providerBilling) && (
          <p className="muted small usage-hint">{provider?.notes?.providerBilling || lim?.notes?.providerBilling}</p>
        )}
      </div>
    </Menu>
  );
}
