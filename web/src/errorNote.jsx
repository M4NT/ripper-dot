// Erro em linguagem de gente + ação de 1 clique. O texto técnico (sem segredos) fica em "Detalhes".
import { explainError, ERROR_ACTIONS } from '../../lib/human-errors.mjs';
import { go } from './lib.js';
import { Icon } from './ui.jsx';

export default function ErrorNote({ raw, onRetry, compact }) {
  const { title, hint, action, details } = explainError(raw);
  const nav = ERROR_ACTIONS[action];
  return (
    <div className={'msg-error' + (compact ? ' compact' : '')} role="alert">
      <b>{title}</b><span>{hint}</span>
      <div className="msg-error-actions">
        {onRetry && <button type="button" className="btn btn-sm" onClick={onRetry}><Icon name="retry" size={14} />Tentar de novo</button>}
        {nav && <button type="button" className="btn btn-sm" onClick={() => go(nav[0])}>{nav[1]}</button>}
        {details && <details><summary>Detalhes</summary><code>{details}</code></details>}
      </div>
    </div>
  );
}
