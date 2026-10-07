import { Switch } from './ui.jsx';
import { useUiMode, SINGLE_MODE } from './uiMode.js';

/** Alternância visível entre modo simples e enterprise (persiste na API de configurações). */
export default function UiModeToggle({ compact = false, className = '' }) {
  if (SINGLE_MODE) return null; // plataforma única: sem seletor
  const { mode, isEnterprise, setMode } = useUiMode();
  const on = isEnterprise;
  return (
    <div className={`ui-mode-toggle ${compact ? 'compact' : ''} ${className}`}>
      {!compact && (
        <div className="ui-mode-copy">
          <b>{on ? 'Modo enterprise' : 'Modo simples'}</b>
          <small>{on ? 'Administração, auditoria e ajustes avançados visíveis.' : 'Interface enxuta: chat, agentes e o essencial.'}</small>
        </div>
      )}
      <label className="ui-mode-switch">
        <span className="ui-mode-labels" aria-hidden="true">
          <span className={!on ? 'on' : ''}>Simples</span>
          <span className={on ? 'on' : ''}>Enterprise</span>
        </span>
        <Switch checked={on} onChange={v => setMode(v ? 'enterprise' : 'simple')} label={on ? 'Modo enterprise' : 'Modo simples'} />
      </label>
    </div>
  );
}

/** Onde algo é do modo Enterprise: diz o que é e liga com um clique (em vez de esconder). */
export function EnterpriseHint({ children, className = '' }) {
  if (SINGLE_MODE) return null;
  const { setMode } = useUiMode();
  return (
    <span className={`enterprise-hint ${className}`}>
      {children}{' '}
      <button type="button" className="link enterprise-hint-btn" onClick={() => setMode('enterprise')}>Ativar modo Enterprise</button>
    </span>
  );
}
