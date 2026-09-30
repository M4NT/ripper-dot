import { useApp } from './app.jsx';
import { Icon, Menu } from './ui.jsx';

function fmt(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Popover de uso por modelo (dados do servidor). */
export default function ModelUsage() {
  const { S } = useApp();
  const usage = S.usage?.byModel || {};
  const rows = Object.entries(S.models)
    .filter(([k]) => k !== 'auto')
    .map(([k, m]) => ({ key: k, label: m.label, ...(usage[k] || { requests: 0, charsIn: 0, charsOut: 0 }) }))
    .sort((a, b) => b.requests - a.requests);

  return (
    <Menu align="up" className="usage-menu" trigger={({ toggle, open }) => (
      <button type="button" className="usage-btn" aria-expanded={open} aria-label="Uso por modelo" onClick={toggle} title="Uso por modelo">
        <Icon name="data" size={15} />
      </button>
    )}>
      <div className="usage-pop" role="dialog" aria-label="Uso por modelo">
        <p className="pop-label">Uso nesta instalação</p>
        <p className="muted small usage-hint">Contagem por modelo (caracteres aproximados, não é fatura dos provedores).</p>
        <ul className="usage-list">
          {rows.map(r => (
            <li key={r.key}>
              <span><b>{r.label}</b><small>{r.requests} {r.requests === 1 ? 'resposta' : 'respostas'}</small></span>
              <span className="usage-nums"><span>↓ {fmt(r.charsIn)}</span><span>↑ {fmt(r.charsOut)}</span></span>
            </li>
          ))}
        </ul>
        {S.usage?.updatedAt && <p className="muted small">Atualizado {new Date(S.usage.updatedAt).toLocaleString('pt-BR')}</p>}
      </div>
    </Menu>
  );
}
