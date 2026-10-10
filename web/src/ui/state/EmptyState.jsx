/* Adaptado de ObsidianUI empty (MIT). Ver web/src/ui/obsidian/LICENSE */
import '../../tokens.css';
import '../../styles/telas/ui-state.css';

/**
 * Estado vazio. API antiga: { title, body, action } — mesma marcação e classes.
 * Novos (opcionais): icon (nó), className. Slots alinhados à ObsidianUI.
 */
export function EmptyState({ title, body, action, icon, className }) {
  return (
    <div data-slot="empty" className={className ? 'empty ' + className : 'empty'}>
      {icon && <div className="ui-empty-icon" data-slot="empty-icon" aria-hidden="true">{icon}</div>}
      <p className="empty-title" data-slot="empty-title">{title}</p>
      {body && <p className="empty-body" data-slot="empty-description">{body}</p>}
      {action}
    </div>
  );
}
