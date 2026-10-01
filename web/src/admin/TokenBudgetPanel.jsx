import { useEffect, useState } from 'react';
import { useApp } from '../app.jsx';
import { api } from '../lib.js';
import { EmptyState } from '../ui.jsx';

function UsageBar({ pct, label, sublabel, tone = 'blue' }) {
  if (pct == null) return null;
  return (
    <div className="usage-bar-block">
      <div className="usage-bar-head"><span>{label}</span><span className="usage-bar-pct">{pct}%</span></div>
      <div className="usage-bar-track"><div className={`usage-bar-fill ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
      {sublabel && <small className="muted">{sublabel}</small>}
    </div>
  );
}

/** Limites de orçamento de tokens (soft-stop no backend). */
export default function TokenBudgetPanel() {
  const { S, refresh, toast } = useApp();
  const [status, setStatus] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const tb = S.settings?.tokenBudget || {};
    setDraft({
      enabled: tb.enabled === true,
      periodHours: tb.periodHours ?? 24,
      globalMaxTokens: tb.globalMaxTokens ?? '',
      loopEnabled: tb.loopDetection?.enabled === true,
      sameToolThreshold: tb.loopDetection?.sameToolThreshold ?? 6,
      windowSeconds: tb.loopDetection?.windowSeconds ?? 120
    });
  }, [S.settings?.tokenBudget]);

  useEffect(() => {
    api('/api/usage/limits')
      .then(b => setStatus(b.accountUsage?.tokenBudget || b.limits?.tokenBudget))
      .catch(() => setStatus(null));
  }, [S]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const globalMaxTokens = draft.globalMaxTokens === '' ? null : Math.floor(+draft.globalMaxTokens);
      await api('/api/settings', {
        method: 'PUT',
        body: {
          tokenBudget: {
            enabled: draft.enabled,
            periodHours: draft.periodHours,
            globalMaxTokens: Number.isFinite(globalMaxTokens) && globalMaxTokens > 0 ? globalMaxTokens : null,
            agents: S.settings.tokenBudget?.agents || {},
            loopDetection: {
              enabled: draft.loopEnabled,
              sameToolThreshold: draft.sameToolThreshold,
              windowSeconds: draft.windowSeconds
            }
          }
        }
      });
      await refresh();
      toast('Orçamento atualizado');
      const b = await api('/api/usage/limits');
      setStatus(b.accountUsage?.tokenBudget || b.limits?.tokenBudget);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!draft) return null;

  return (
    <div className="admin-uso-section token-budget-panel">
      <p className="muted small">
        Quando ativo, o Ripper interrompe novas respostas ao atingir o limite (estimativa ~4 caracteres/token nos eventos medidos).
        Não substitui cotas do provedor nem faturamento.
      </p>

      {status?.enabled && status.scopes?.length > 0 ? (
        status.scopes.map(s => (
          <UsageBar
            key={s.scope + (s.agentId || '')}
            label={s.scope === 'agent' ? `Agente ${s.agentId}` : 'Orçamento global'}
            pct={s.pct}
            tone={s.exceeded ? 'red' : s.pct >= 80 ? 'orange' : 'blue'}
            sublabel={s.limitTokens != null ? `${s.usedTokens} / ${s.limitTokens} tokens no período` : null}
          />
        ))
      ) : (
        <EmptyState title="sem dados" body="Defina um limite global abaixo e ative o governador para ver consumo no período." />
      )}

      <div className="form-grid admin-budget-form">
        <label className="check-row">
          <input type="checkbox" checked={draft.enabled} onChange={e => setDraft(d => ({ ...d, enabled: e.target.checked }))} />
          Ativar governador de orçamento
        </label>
        <label>
          Período (horas)
          <input type="number" min={1} max={168} value={draft.periodHours} onChange={e => setDraft(d => ({ ...d, periodHours: +e.target.value }))} />
        </label>
        <label>
          Limite global (tokens)
          <input type="number" min={0} placeholder="sem limite" value={draft.globalMaxTokens} onChange={e => setDraft(d => ({ ...d, globalMaxTokens: e.target.value }))} />
        </label>
        <fieldset className="admin-budget-loop">
          <legend>Detecção de loop de ferramentas</legend>
          <label className="check-row">
            <input type="checkbox" checked={draft.loopEnabled} onChange={e => setDraft(d => ({ ...d, loopEnabled: e.target.checked }))} />
            Interromper execução em loop
          </label>
          <label>
            Mesma ferramenta (vezes)
            <input type="number" min={3} max={30} value={draft.sameToolThreshold} disabled={!draft.loopEnabled} onChange={e => setDraft(d => ({ ...d, sameToolThreshold: +e.target.value }))} />
          </label>
          <label>
            Janela (segundos)
            <input type="number" min={30} max={600} value={draft.windowSeconds} disabled={!draft.loopEnabled} onChange={e => setDraft(d => ({ ...d, windowSeconds: +e.target.value }))} />
          </label>
        </fieldset>
      </div>
      <button type="button" className="btn" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar orçamento'}</button>
      {status?.note && <p className="muted small">{status.note}</p>}
    </div>
  );
}
