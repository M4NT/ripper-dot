import '../../tokens.css';
import '../../styles/telas/ui-state.css';

/** Esqueleto de lista: linhas com forma da lista real, no lugar do texto "Carregando…".
 *  variant: 'list' (padrão, API antiga) · 'message' · 'panel' · 'line' */
export function Skeleton({ rows = 3, label = 'Carregando', variant = 'list' }) {
  if (variant === 'message') {
    return (
      <div className="ui-skel-msg" role="status" aria-label={label}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={'ui-skel-bubble' + (i % 2 ? ' user' : '')} aria-hidden="true" />
        ))}
      </div>
    );
  }
  if (variant === 'panel') {
    return (
      <div className="ui-skel-panel" role="status" aria-label={label}>
        {Array.from({ length: rows }, (_, i) => (
          <span key={i} className={'ui-skel-block' + (i === 0 ? ' wide' : i === rows - 1 ? ' short' : ' mid')} aria-hidden="true" />
        ))}
      </div>
    );
  }
  if (variant === 'line') {
    return (
      <span className="ui-skel-line" role="status" aria-label={label} />
    );
  }
  return (
    <div className="skeleton-list" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" aria-hidden="true">
          <span className="skeleton-dot" />
          <span className="skeleton-lines"><span className="skeleton-line" /><span className="skeleton-line short" /></span>
        </div>
      ))}
    </div>
  );
}
