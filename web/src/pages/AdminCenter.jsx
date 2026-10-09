import { useEffect, useState } from 'react';
import { useApp } from '../app.jsx';
import { api, go } from '../lib.js';
import { isEnterpriseMode } from '../uiMode.js';
import { Icon, EmptyState } from '../ui.jsx';
import X9AuditorCard from '../x9Auditor.jsx';
import '../styles/telas/pages/AdminCenter.css';

function StatusTag({ ok, label, warn }) {
  const cls = ok ? 'tag tag-ok' : (warn ? 'tag tag-warn' : 'tag');
  return <span className={cls} role="status">{label}</span>;
}

function AdminCard({ icon, title, desc, status, children }) {
  return (
    <section className="admin-card">
      <header className="admin-card-head">
        <span className="admin-card-ico"><Icon name={icon} size={20} /></span>
        <div>
          <h3>{title}</h3>
          {desc && <p className="muted small">{desc}</p>}
        </div>
        {status}
      </header>
      <div className="admin-card-body">{children}</div>
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="admin-metric">
      <span className="muted small">{label}</span>
      <b>{value}</b>
    </div>
  );
}

export default function AdminCenter() {
  const { S } = useApp();
  const enterprise = isEnterpriseMode(S.settings);
  const showX9 = enterprise;
  const [overview, setOverview] = useState(null);
  const [audit, setAudit] = useState(null);
  const [lgpd, setLgpd] = useState(null);
  const [limits, setLimits] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!enterprise) return;
    let alive = true;
    setErr('');
    setOverview(null);
    Promise.all([
      api('/api/admin/overview').catch(e => { throw e; }),
      api('/api/audit-trail?limit=5').catch(() => null),
      api('/api/lgpd/status').catch(() => null),
      api('/api/usage/limits').catch(() => null)
    ]).then(([ov, au, lg, lim]) => {
      if (!alive) return;
      setOverview(ov);
      setAudit(au);
      setLgpd(lg);
      setLimits(lim);
    }).catch(e => {
      if (alive) setErr(e.message || 'Não foi possível carregar o painel.');
    });
    return () => { alive = false; };
  }, [enterprise]);

  if (!enterprise) {
    return (
      <div className="page pad">
        <EmptyState
          title="Centro admin indisponível"
          body="Esta superfície é exclusiva do modo enterprise. Ative em Configurações → Aparência."
          action={<button type="button" className="btn" onClick={() => go('/settings/appearance')}>Abrir configurações</button>}
        />
      </div>
    );
  }

  if (err) {
    return (
      <div className="page pad">
        <EmptyState title="Erro ao carregar" body={err} action={<button type="button" className="btn" onClick={() => location.reload()}>Tentar de novo</button>} />
      </div>
    );
  }

  if (!overview) {
    return <div className="page-loading"><p className="muted">Carregando Centro admin…</p></div>;
  }

  const s = overview.sections || {};

  return (
    <div className="page admin-page">
      <header className="page-head">
        <div>
          <h1>Centro admin</h1>
          <p className="muted">Operações desta instalação Ripper — apenas dados reais, sem estimativas de faturamento.</p>
        </div>
        <button type="button" className="btn" onClick={() => go('/settings/appearance')}><Icon name="gear" size={16} />Modo e aparência</button>
      </header>

      {showX9 && (
        <section className="admin-x9-wrap set-card">
          <header><h3>X9 — Auditor</h3></header>
          <p className="set-card-desc muted">Varredura somente leitura: sandbox, autonomia, LGPD/retenção e trilha local. Sem alterar produção.</p>
          <X9AuditorCard />
        </section>
      )}

      <div className="admin-grid">
        <AdminCard
          icon="agents"
          title="Usuários e RBAC"
          desc="Controle de acesso multiusuário e papéis."
          status={<StatusTag ok={false} label="Indisponível" warn />}
        >
          <p className="muted small">{s.rbac?.emptyLabel}</p>
          <div className="admin-metrics">
            <Metric label="Autenticação" value={s.rbac?.auth === 'ripper_token' ? 'Token RIPPER_TOKEN' : 'Local (sem token)'} />
            <Metric label="Agentes" value={s.rbac?.agents ?? 0} />
          </div>
        </AdminCard>

        <AdminCard
          icon="file"
          title="Trilha de auditoria"
          desc="Histórico local de aprovações e decisões (não é armazenamento WORM)."
          status={<StatusTag ok={s.auditTrail?.entryCount > 0} label={s.auditTrail?.entryCount > 0 ? `${s.auditTrail.entryCount} eventos` : 'Vazio'} warn={!s.auditTrail?.entryCount} />}
        >
          {s.auditTrail?.worm === false && <p className="muted small">Store: local · WORM: não</p>}
          {audit?.entries?.length
            ? <ul className="admin-list mono small">{audit.entries.map(e => (
              <li key={e.id}><time>{new Date(e.at).toLocaleString('pt-BR')}</time> · {e.action || e.type || 'evento'}{e.category ? ` · ${e.category}` : ''}</li>
            ))}</ul>
            : <p className="muted small">{s.auditTrail?.emptyLabel || 'Indisponível'}</p>}
        </AdminCard>

        <AdminCard
          icon="data"
          title="Retenção"
          desc="Inventário de dados locais em RIPPER_DATA."
          status={<StatusTag ok={true} label="Ativo" />}
        >
          <div className="admin-metrics">
            <Metric label="Eventos de uso" value={s.retention?.usageEventCount ?? 0} />
            <Metric label="Decisões Julia" value={s.retention?.juliaDecisionCount ?? 0} />
            <Metric label="Arquivos conhecidos" value={s.retention?.fileCount ?? 0} />
          </div>
          <p className="muted small">{s.retention?.notes}</p>
          <p className="mono small wrap">{s.retention?.ripperData}</p>
        </AdminCard>

        <AdminCard
          icon="key"
          title="LGPD e privacidade"
          desc="O que o software faz localmente (não é parecer jurídico)."
          status={<StatusTag ok={lgpd?.available} label={lgpd?.available ? 'Relatório' : 'Indisponível'} warn={!lgpd?.available} />}
        >
          {lgpd ? (
            <>
              <div className="admin-metrics">
                <Metric label="Telemetria de produto" value={lgpd.productTelemetry ? 'sim' : 'não'} />
                <Metric label="Redação na API" value={lgpd.redactionInApi ? 'sim' : 'não'} />
                <Metric label="Acesso" value={lgpd.accessControl === 'bearer_token' ? 'Bearer' : 'Local'} />
              </div>
              <ul className="admin-notes muted small">{lgpd.notes?.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </>
          ) : <p className="muted small">Indisponível</p>}
        </AdminCard>

        <AdminCard
          icon="terminal"
          title="Sandbox"
          desc="Pastas de computador por agente."
          status={<StatusTag ok={s.sandbox?.available && (s.sandbox?.sandboxAgentDirs || 0) > 0} label={s.sandbox?.computerMode || 'off'} warn={!s.sandbox?.available} />}
        >
          <div className="admin-metrics">
            <Metric label="Modo computador" value={s.sandbox?.computerMode || 'off'} />
            <Metric label="Pastas sandbox" value={s.sandbox?.sandboxAgentDirs ?? 0} />
          </div>
          {s.sandbox?.emptyLabel && <p className="muted small">{s.sandbox.emptyLabel}</p>}
        </AdminCard>

        <AdminCard
          icon="bolt"
          title="Uso"
          desc="Medição, economia Julia (medida) e orçamento de tokens num só lugar."
          status={<StatusTag ok={s.usage?.available} label={s.usage?.available ? 'Com dados' : 'sem dados'} warn={!s.usage?.available} />}
        >
          <p className="muted small">{s.usage?.notes || 'Sem estimativas de fatura — só eventos medidos localmente.'}</p>
          <div className="admin-metrics">
            <Metric label="Eventos de uso" value={s.retention?.usageEventCount ?? 0} />
            <Metric label="Orçamento" value={limits?.accountUsage?.tokenBudget?.enabled ? 'ativo' : 'inativo'} />
          </div>
          <button type="button" className="btn btn-sm" onClick={() => go('/admin/uso')}>Abrir Uso</button>
        </AdminCard>
      </div>
    </div>
  );
}
