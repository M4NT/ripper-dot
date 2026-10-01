import { useEffect, useState } from 'react';
import { api, fmtAgo, go } from '../lib.js';
import { Icon, EmptyState } from '../ui.jsx';
import UiModeToggle from '../uiModeToggle.jsx';
import { useUiMode } from '../uiMode.js';

const TABS = [
  ['audit', 'Auditoria', 'Trilha local de decisões (WORM quando habilitado no servidor)'],
  ['usage', 'Uso e tokens', 'Métricas reais ou vazio — sem estimativas inventadas'],
  ['rbac', 'RBAC', 'Papéis e permissões de administração'],
  ['ops', 'Operações', 'Manager-worker e filas'],
  ['teams', 'Meta-equipes', 'Geradores e templates avançados']
];

function AuditPanel() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api('/api/audit?limit=80')
      .then(r => { setRows(r.entries || []); setErr(''); })
      .catch(e => { setRows([]); setErr(e.message); });
  }, []);
  if (rows === null) return <p className="muted">Carregando auditoria…</p>;
  if (err) return <p className="form-error" role="alert">{err}</p>;
  if (!rows.length) {
    return <EmptyState title="Sem dados de auditoria" body="Nenhum evento registrado nesta instalação. Aprovações e ações futuras aparecem aqui quando o backend grava a trilha." />;
  }
  return (
    <ul className="rows flat audit-list">
      {rows.map(e => (
        <li key={e.id} className="row-item">
          <span className="thumb file-ico"><Icon name="clock" size={16} /></span>
          <div className="row-main">
            <b>{e.type || 'evento'} · {e.status || e.kind || '—'}</b>
            <small className="mono">{e.command || e.agentId || e.id}</small>
          </div>
          <time className="muted">{fmtAgo(e.at)}</time>
        </li>
      ))}
    </ul>
  );
}

function UsagePanel() {
  const [snap, setSnap] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api('/api/usage')
      .then(r => { setSnap(r); setErr(''); })
      .catch(e => { setSnap(null); setErr(e.message); });
  }, []);
  if (!snap && !err) return <p className="muted">Carregando uso…</p>;
  if (err) return <p className="form-error" role="alert">{err}</p>;
  const events = snap?.localUsage?.totalRecordedEvents ?? 0;
  const byModel = snap?.byModel && Object.keys(snap.byModel).length ? snap.byModel : null;
  if (!events && !byModel) {
    return <EmptyState title="Sem dados de uso" body="Nenhum evento medido nesta instalação. O Ripper não exibe custos ou tokens fictícios." />;
  }
  return (
    <div className="enterprise-usage">
      <p className="muted small">Somente medição local. Cotas do provedor aparecem quando configuradas ou disponíveis via login.</p>
      {events > 0 && <p><b>{events}</b> eventos registrados (instalação local).</p>}
      {byModel && (
        <ul className="usage-list">
          {Object.entries(byModel).map(([k, v]) => (
            <li key={k}><span>{k}</span><span className="mono">{v?.calls ?? v?.count ?? '—'}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StubPanel({ title, body, action }) {
  return <EmptyState title={title} body={body} action={action} />;
}

export default function EnterpriseHub({ tab: initial }) {
  const { isEnterprise } = useUiMode();
  const tab = TABS.some(t => t[0] === initial) ? initial : 'audit';
  const current = TABS.find(t => t[0] === tab);

  if (!isEnterprise) {
    return (
      <div className="page enterprise-gate">
        <header className="page-head"><div><h1>Opções avançadas</h1><p className="lede">Auditoria, compliance e operações ficam no modo enterprise.</p></div></header>
        <div className="set-card pad">
          <UiModeToggle />
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page enterprise-page">
      <nav className="settings-nav" aria-label="Enterprise">
        <h1>Enterprise</h1>
        <p className="side-hint muted small">Administração, compliance e operações.</p>
        {TABS.map(([k, l, hint]) => (
          <a key={k} href={`#/enterprise/${k}`} className={k === tab ? 'on' : ''} aria-current={k === tab ? 'page' : undefined}>
            <Icon name={k === 'audit' ? 'clock' : k === 'usage' ? 'data' : k === 'rbac' ? 'key' : k === 'ops' ? 'terminal' : 'agents'} size={17} />
            <span><b>{l}</b><small>{hint}</small></span>
          </a>
        ))}
        <div className="settings-nav-foot">
          <UiModeToggle compact />
        </div>
      </nav>
      <div className="settings-main">
        <header className="settings-head"><h2>{current[1]}</h2><p>{current[2]}</p></header>
        {tab === 'audit' && <section className="set-card"><AuditPanel /></section>}
        {tab === 'usage' && <section className="set-card"><UsagePanel /></section>}
        {tab === 'rbac' && (
          <section className="set-card">
            <StubPanel title="RBAC em preparação" body="Controle de papéis e permissões administrativas ainda não está disponível nesta instalação. Ative quando o backend de identidade estiver conectado." />
          </section>
        )}
        {tab === 'ops' && (
          <section className="set-card">
            <StubPanel title="Manager-worker" body="Orquestração multi-processo e filas de trabalho aparecerão aqui quando o cluster estiver configurado." />
          </section>
        )}
        {tab === 'teams' && (
          <section className="set-card">
            <StubPanel
              title="Meta-equipes e geradores"
              body="Templates avançados e geradores de equipe ficam em Explorar e na Biblioteca."
              action={<button type="button" className="btn" onClick={() => go('/explore')}>Abrir Explorar</button>}
            />
          </section>
        )}
      </div>
    </div>
  );
}
