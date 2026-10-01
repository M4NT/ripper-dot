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
  const withPct = categories.filter(c => c.pct > 0);
  const total = withPct.reduce((n, c) => n + (c.pct || 0), 0) || 1;
  return (
    <div className="usage-seg-bar">
      {withPct.map(c => (
        <span key={c.id} style={{ width: `${(c.pct / total) * 100}%`, background: c.color }} title={c.label} />
      ))}
    </div>
  );
}

/** Popover de uso da conta + janela de contexto (somente dados reais ou configurados). */
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
  const r5 = lim?.ripperQuota?.rolling5h;
  const wk = lim?.ripperQuota?.weekly;
  const hasRipperQuota = r5?.configured || wk?.configured;
  const claudeSub = lim?.claudeSubscription;
  const claudeWin = claudeSub?.available ? claudeSub.windows : null;
  const ctxPct = ctx?.hasData ? ctx.pct : null;
  const ctxUsed = ctx?.usedTokens;
  const ctxLimit = ctx?.limitTokens ?? 1_000_000;
  const ringPct = ctxPct ?? (claudeWin?.fiveHour?.pct != null ? claudeWin.fiveHour.pct : null) ?? (r5?.configured ? r5.pct : null);

  return (
    <Menu align="up" className="usage-menu" onOpenChange={loadDetail} trigger={({ toggle, open }) => (
      <button type="button" className="usage-btn" aria-expanded={open} aria-label="Uso e limites" onClick={toggle} title="Uso e limites">
        <ContextRing pct={ringPct} size={30} />
      </button>
    )}>
      <div className="usage-pop usage-account" role="dialog" aria-label="Uso da conta">
        <button type="button" className="usage-ctx-summary" onClick={() => setCtxExpanded(v => !v)} aria-expanded={ctxExpanded}>
          <span>
            <b>Janela de contexto</b>
            {ctx?.hasData
              ? <span className="mono"> {fmtTok(ctxUsed)} / {fmtTok(ctxLimit)} ({ctxPct}%)</span>
              : <span className="muted small"> — abra uma conversa ou envie mensagens para medir</span>}
          </span>
          <Icon name="down" size={14} className={ctxExpanded ? 'open' : ''} />
        </button>
        {(ctxExpanded || ctx) && ctx?.hasData && (
          <div className="usage-ctx-detail">
            <SegmentedBar categories={ctx.categories.filter(c => c.id !== 'unmeasured')} />
            <ul className="usage-ctx-list">
              {ctx.categories.filter(c => c.id !== 'unmeasured').map(c => (
                <li key={c.id}><span className="usage-swatch" style={{ background: c.color }} />{c.label}<span className="grow" /><span className="mono">{fmtTok(c.tokens)}</span><span className="usage-ctx-pct">{c.pct != null ? `${c.pct}%` : '—'}</span></li>
              ))}
            </ul>
            <div className="usage-ctx-foot">
              <small className="muted">{ctx.compact?.messageCount ? `${ctx.compact.messageCount} mensagens` : '—'}</small>
              <button type="button" className="btn btn-sm" disabled={!chatId || compactBusy || !ctx.compact?.canCompact} onClick={compactSession} title={chatId ? 'Remove mensagens antigas desta conversa' : 'Abra uma conversa para compactar'}>
                {compactBusy ? 'Compactando…' : 'Compactar sessão'}
              </button>
            </div>
            {ctx.note && <p className="muted small">{ctx.note}</p>}
          </div>
        )}
        {(ctxExpanded || ctx) && ctx && !ctx.hasData && (
          <p className="muted small usage-hint">Sem medição de contexto ainda. O Ripper não inventa categorias de tokens do provedor.</p>
        )}

        <p className="pop-label">Uso registrado nesta instalação</p>
        {lim?.localUsage && (
          <p className="small">
            {lim.localUsage.totalRecordedEvents
              ? `${lim.localUsage.totalRecordedEvents} eventos · ~${fmtTok(lim.localUsage.chars5h / 4)} tokens (5 h) · ~${fmtTok(lim.localUsage.chars7d / 4)} tokens (7 d)`
              : 'Nenhuma resposta registrada ainda nesta instalação.'}
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

        {lim?.providers?.length > 0 && (
          <section className="usage-julia">
            <p className="pop-label">Último bloqueio de cota (provedor)</p>
            <ul className="usage-list">
              {lim.providers.map(p => (
                <li key={p.id}>
                  <span><b>{p.id}</b><small>{p.message?.slice(0, 120)}{(p.message?.length > 120) ? '…' : ''}</small></span>
                  {p.resetLabel && <span className="muted small">{p.resetLabel}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {lim?.cloudCredits?.configured && lim.cloudCredits.remainingUsd != null && (
          <div className="usage-cloud">
            <p className="usage-cloud-head"><Icon name="globe" size={14} /> Créditos na nuvem (configurados)</p>
            <UsageBar
              label={`US$ ${lim.cloudCredits.remainingUsd} de US$ ${lim.cloudCredits.totalUsd} restantes`}
              pct={lim.cloudCredits.pctRemaining}
              tone="blue"
            />
          </div>
        )}

        {lim?.juliaRouting && (
          <section className="usage-julia">
            <p className="pop-label">Julia 1 (telemetria local)</p>
            {lim.juliaRouting.decisions != null ? (
              <>
                <p className="small">
                  {lim.juliaRouting.answered} decisões pela Julia · {lim.juliaRouting.fallbacks} reservas (heurística/regra)
                  {lim.juliaRouting.latencyMs?.p50 != null && (
                    <> · latência p50 {lim.juliaRouting.latencyMs.p50} ms{p95Label(lim.juliaRouting.latencyMs)}</>
                  )}
                </p>
                {lim.juliaRouting.avoidedPromptChars?.sum > 0 && (
                  <p className="small muted">
                    ~{lim.juliaRouting.avoidedPromptChars.sum.toLocaleString('pt-BR')} caracteres de prompt de triagem medidos ({lim.juliaRouting.avoidedPromptChars.eventsWithMeasurement} eventos) — não é custo em US$.
                  </p>
                )}
                {juliaFallbackLines(lim.juliaRouting.fallbacksByReason).length > 0 && (
                  <ul className="usage-list">
                    {juliaFallbackLines(lim.juliaRouting.fallbacksByReason).map(([reason, n]) => (
                      <li key={reason}><span><b>{reason}</b><small>{n} fallback{n === 1 ? '' : 's'}</small></span></li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="muted small">Sem decisões Julia registradas ainda.</p>
            )}
            {lim.juliaRouting.usageRoutedByJulia > 0 && (
              <p className="muted small">{lim.juliaRouting.usageRoutedByJulia} respostas do modelo grande com roteamento Julia/heurística (uso local).</p>
            )}
            <p className="muted small usage-hint">Sem estimativa de economia em US$ — só eventos medidos nesta instalação.</p>
          </section>
        )}

        <button type="button" className="link-btn usage-more" onClick={() => setExpanded(v => !v)}>{expanded ? 'Ocultar detalhamento' : 'Ver detalhamento por modelo'}</button>
        {expanded && lim?.byModel && (
          <ul className="usage-list">
            {Object.entries(lim.byModel).filter(([k, r]) => k !== 'auto' && (r.requests || r.charsIn || r.charsOut)).map(([k, r]) => (
              <li key={k}><span><b>{r.label}</b><small>{r.sharePct}% do uso local · {r.requests || 0} respostas · {r.charsIn + r.charsOut} caracteres</small></span></li>
            ))}
          </ul>
        )}
        {expanded && lim?.localUsage?.totalRecordedEvents === 0 && (
          <p className="muted small">Sem uso por modelo ainda.</p>
        )}

        {lim?.notes?.providerBilling && (
          <p className="muted small usage-hint">{lim.notes.providerBilling}</p>
        )}
      </div>
    </Menu>
  );
}
