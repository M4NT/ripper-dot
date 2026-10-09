import { useEffect, useState } from 'react';
import { useApp } from '../app.jsx';
import { api } from '../lib.js';
import { EmptyState, Switch } from '../ui.jsx';
import '../styles/telas/admin/TokenBudgetPanel.css';

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

      <div className="admin-budget-form">
        <div className="set-row"><div className="set-label"><b>Governador de orçamento</b><small>Interrompe novas respostas ao atingir o limite do período.</small></div><div className="set-control"><Switch checked={draft.enabled} onChange={v => setDraft(d => ({ ...d, enabled: v }))} label="Ativar governador de orçamento" /></div></div>
        <div className="set-row"><div className="set-label"><b>Período</b></div><div className="set-control"><div className="input-unit"><input className="input" type="number" min={1} max={168} value={draft.periodHours} onChange={e => setDraft(d => ({ ...d, periodHours: +e.target.value }))} /><span>horas</span></div></div></div>
        <div className="set-row"><div className="set-label"><b>Limite global</b><small>Deixe vazio para não limitar.</small></div><div className="set-control"><div className="input-unit"><input className="input" type="number" min={0} placeholder="sem limite" value={draft.globalMaxTokens} onChange={e => setDraft(d => ({ ...d, globalMaxTokens: e.target.value }))} /><span>tokens</span></div></div></div>
        <div className="set-row"><div className="set-label"><b>Detecção de loop de ferramentas</b><small>Para a execução quando o agente repete a mesma ferramenta.</small></div><div className="set-control"><Switch checked={draft.loopEnabled} onChange={v => setDraft(d => ({ ...d, loopEnabled: v }))} label="Interromper execução em loop" /></div></div>
        {draft.loopEnabled && <>
        <div className="set-row"><div className="set-label"><b>Mesma ferramenta</b></div><div className="set-control"><div className="input-unit"><input className="input" type="number" min={3} max={30} value={draft.sameToolThreshold} onChange={e => setDraft(d => ({ ...d, sameToolThreshold: +e.target.value }))} /><span>vezes</span></div></div></div>
        <div className="set-row"><div className="set-label"><b>Janela</b></div><div className="set-control"><div className="input-unit"><input className="input" type="number" min={30} max={600} value={draft.windowSeconds} onChange={e => setDraft(d => ({ ...d, windowSeconds: +e.target.value }))} /><span>segundos</span></div></div></div>
        </>}
      </div>
      <div className="set-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar orçamento'}</button>
      </div>
      {status?.note && <p className="muted small">{status.note}</p>}
    </div>
  );
}
