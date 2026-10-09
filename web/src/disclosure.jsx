import { isEnterpriseMode } from './uiMode.js';
import './styles/telas/disclosure.css';

/**
 * Agrupa controles avançados em <details> recolhido no modo simples.
 * No modo enterprise, abre por padrão na primeira renderização.
 */
export function AdvancedBlock({ settings, summary = 'Avançado', hint, children, className = '' }) {
  const defaultOpen = isEnterpriseMode(settings);
  return (
    <details className={`adv-disclosure ${className}`.trim()} open={defaultOpen || undefined}>
      <summary>
        <span className="adv-disclosure-title">{summary}</span>
        {hint && <span className="adv-disclosure-hint">{hint}</span>}
      </summary>
      <div className="adv-disclosure-body">{children}</div>
    </details>
  );
}

/** Ícone de ajuda com tooltip nativo (title). */
export function HelpTip({ text }) {
  if (!text) return null;
  return <span className="help-tip" title={text} aria-label={text} role="note">?</span>;
}
