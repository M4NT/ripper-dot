import { useApp } from '../app.jsx';
import { go } from '../lib.js';
import { isEnterpriseMode } from '../uiMode.js';
import { Icon, EmptyState } from '../ui.jsx';
import UsageReportPanel from '../admin/UsageReportPanel.jsx';
import MeteringPanel from '../admin/MeteringPanel.jsx';
import JuliaEconomiaPanel from '../admin/JuliaEconomiaPanel.jsx';
import TokenBudgetPanel from '../admin/TokenBudgetPanel.jsx';

function Section({ id, title, desc, children }) {
  return (
    <section className="admin-uso-block" id={id}>
      <header>
        <h2>{title}</h2>
        {desc && <p className="muted small">{desc}</p>}
      </header>
      {children}
    </section>
  );
}

/** Superfície unificada: medição, economia Julia e orçamento de tokens. */
export default function AdminUso() {
  const { S } = useApp();
  const enterprise = isEnterpriseMode(S.settings);

  if (!enterprise) {
    return (
      <div className="page pad">
        <EmptyState
          title="Uso indisponível"
          body="Medição, economia Julia e orçamento ficam no modo enterprise."
          action={<button type="button" className="btn" onClick={() => go('/settings/appearance')}>Abrir configurações</button>}
        />
      </div>
    );
  }

  return (
    <div className="page admin-page admin-uso-page">
      <header className="page-head">
        <div>
          <nav className="admin-uso-crumb muted small">
            <a href="#/admin" onClick={e => { e.preventDefault(); go('/admin'); }}>Centro admin</a>
            <span aria-hidden="true"> / </span>
            <span>Uso</span>
          </nav>
          <h1>Uso</h1>
          <p className="muted">Medição local, economia Julia medida e limites de orçamento — sem valores de fatura inventados.</p>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => go('/admin')}><Icon name="arrowL" size={16} />Voltar ao admin</button>
      </header>

      <Section
        id="periodo"
        title="Uso por período"
        desc="Respostas, tokens e custo estimados por dia, agente ou modelo."
      >
        <UsageReportPanel />
      </Section>

      <Section
        id="medicao"
        title="Medição de uso"
        desc="Agregados de usage.sqlite e export CSV."
      >
        <MeteringPanel />
      </Section>

      <Section
        id="julia"
        title="Economia Julia (medida)"
        desc="Telemetria real de roteamento, cache e cascata — sem US$ ou percentual de economia fabricado."
      >
        <JuliaEconomiaPanel />
      </Section>

      <Section
        id="orcamento"
        title="Orçamento de tokens"
        desc="Limites configuráveis com soft-stop no backend. Cotas Ripper via RIPPER_LIMIT_* continuam no servidor."
      >
        <TokenBudgetPanel />
      </Section>
    </div>
  );
}
