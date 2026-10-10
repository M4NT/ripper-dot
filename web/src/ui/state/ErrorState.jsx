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
    <div className={'ui-error' + (className ? ' ' + className : '')} role="alert" aria-live="assertive">
      <p className="ui-error-title">{title}</p>
      {body && <p className="ui-error-body">{body}</p>}
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
  );
}
