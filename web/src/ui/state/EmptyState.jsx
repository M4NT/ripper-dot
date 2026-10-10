import '../../tokens.css';
import '../../styles/telas/ui-state.css';

/**
 * Estado vazio. API antiga: { title, body, action } — mesma marcação e classes.
 * Novos (opcionais): icon (nó), className.
 */
export function EmptyState({ title, body, action, icon, className }) {
  return (
    <div className={className ? 'empty ' + className : 'empty'}>
      {icon && <div className="ui-empty-icon" aria-hidden="true">{icon}</div>}
      <p className="empty-title">{title}</p>
      {body && <p className="empty-body">{body}</p>}
      {action}
    </div>
  );
}
