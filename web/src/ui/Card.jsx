import '../tokens.css';
import '../styles/telas/ui-state.css';

/**
 * Casca de cartão inline (registro de kinds vem no UI-3).
 * status: 'pending' | 'ok' | 'err' — só a faixa de estado; o conteúdo é do chamador.
 */
export function Card({ as: Tag = 'article', children, className = '', status, padded = true, ...rest }) {
  const cls = [
    'ui-card',
    padded ? 'ui-card-pad' : '',
    status === 'pending' ? 'ui-card-pending' : '',
    status === 'ok' ? 'ui-card-ok' : '',
    status === 'err' ? 'ui-card-err' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <Tag className={cls} data-status={status || undefined} {...rest}>
      {children}
    </Tag>
  );
}
