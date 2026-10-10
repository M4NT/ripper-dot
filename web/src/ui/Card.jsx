/* Adaptado de ObsidianUI card (MIT). Ver web/src/ui/obsidian/LICENSE */
import './styles.js';
import '../styles/telas/ui-shell.css';

/**
 * Casca de cartão inline (registro de kinds vem no UI-3).
 * status: 'pending' | 'ok' | 'err' — só a faixa de estado; o conteúdo é do chamador.
 * Composição opcional: CardHeader, CardTitle, CardDescription, CardContent, CardFooter.
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
    <Tag className={cls} data-slot="card" data-status={status || undefined} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({ className = '', ...rest }) {
  return <div className={'ui-card-head' + (className ? ' ' + className : '')} data-slot="card-header" {...rest} />;
}
export function CardTitle({ className = '', ...rest }) {
  return <div className={'ui-card-title' + (className ? ' ' + className : '')} data-slot="card-title" {...rest} />;
}
export function CardDescription({ className = '', ...rest }) {
  return <div className={'ui-card-desc' + (className ? ' ' + className : '')} data-slot="card-description" {...rest} />;
}
export function CardContent({ className = '', ...rest }) {
  return <div className={'ui-card-body' + (className ? ' ' + className : '')} data-slot="card-content" {...rest} />;
}
export function CardFooter({ className = '', ...rest }) {
  return <div className={'ui-card-foot' + (className ? ' ' + className : '')} data-slot="card-footer" {...rest} />;
}
export function CardAction({ className = '', ...rest }) {
  return <div className={'ui-card-action' + (className ? ' ' + className : '')} data-slot="card-action" {...rest} />;
}
