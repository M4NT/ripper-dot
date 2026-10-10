// Primitivos leves no recorte da ObsidianUI (botão, cartão, selo, campo, abas)
// e da casca do UI-2 (`ui-card` pending/ok/err). Sem Motion, GSAP ou WebGL.
import { Icon } from '../ui.jsx';

export function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}

export function cardStatus(state) {
  if (state === 'output-error' || state === 'denied' || state === 'expired') return 'err';
  if (state === 'approved' || state === 'answered') return 'ok';
  if (state === 'input-available' || state === 'input-streaming') return 'pending';
  return undefined;
}

/** Mesma casca do UI-2 (`web/src/ui/Card.jsx`) para os PRs poderem conviver. */
export function Card({ as: Tag = 'article', children, className = '', status, padded = true, ...rest }) {
  return (
    <Tag
      className={cn('ui-card', padded && 'ui-card-pad', status === 'pending' && 'ui-card-pending', status === 'ok' && 'ui-card-ok', status === 'err' && 'ui-card-err', className)}
      data-status={status || undefined}
      data-slot="card"
      {...rest}
    >{children}</Tag>
  );
}

/** Variantes da ObsidianUI (default / outline / secondary / ghost / destructive) em tokens do Ripper. */
export function Button({ variant = 'outline', size = 'sm', className = '', children, ...rest }) {
  return (
    <button type="button" data-slot="button" className={cn('oui-btn', `oui-btn-${variant}`, `oui-btn-${size}`, className)} {...rest}>
      {children}
    </button>
  );
}

export function Badge({ tone = 'neutral', children, className = '' }) {
  return <span data-slot="badge" className={cn('oui-badge', `oui-badge-${tone}`, className)}>{children}</span>;
}

export function Field({ label, hint, children }) {
  return (
    <label className="oui-field" data-slot="field">
      <span className="oui-field-label">{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Tabs({ items, value, onChange }) {
  return (
    <div className="oui-tabs" data-slot="tabs">
      <div className="oui-tablist" role="tablist">
        {items.map(it => (
          <button key={it.id} type="button" role="tab" aria-selected={value === it.id} className={cn('oui-tab', value === it.id && 'on')} onClick={() => onChange(it.id)}>
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Skeleton({ lines = 3, label = 'Carregando componente' }) {
  return (
    <div className="oui-skel" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => <i key={i} className={i === lines - 1 ? 'short' : i === 0 ? 'wide' : 'mid'} />)}
    </div>
  );
}

export function FallbackText({ text }) {
  return (
    <div className="oui-fallback" role="note">
      <Icon name="alert" size={14} />
      <pre>{text}</pre>
    </div>
  );
}
