/* Adaptado de ObsidianUI alert (MIT). Ver web/src/ui/obsidian/LICENSE */
import '../../tokens.css';
import '../../styles/telas/ui-state.css';

/** Erro humano + "Tentar de novo" + detalhe recolhível. */
export function ErrorState({
  title = 'Algo deu errado',
  body = 'Tente de novo. Se continuar, abra os detalhes.',
  onRetry,
  retryLabel = 'Tentar de novo',
  details,
  className = '',
}) {
  return (
    <div className={'ui-error' + (className ? ' ' + className : '')} data-slot="alert" role="alert" aria-live="assertive">
      <svg className="icon ui-error-ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
      </svg>
      <div className="ui-error-copy">
        <p className="ui-error-title" data-slot="alert-title">{title}</p>
        {body && <p className="ui-error-body" data-slot="alert-description">{body}</p>}
        {onRetry && (
          <div className="ui-error-actions">
            <button type="button" className="btn btn-primary" onClick={onRetry}>{retryLabel}</button>
          </div>
        )}
        {details != null && details !== '' && (
          <details className="ui-error-details">
            <summary>Ver detalhe</summary>
            <pre>{typeof details === 'string' ? details : String(details)}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
