import { HelpTip } from '../disclosure.jsx';
import { useT } from '../i18n/index.jsx';

export function SaveBar({ dirty, saving, save, reset }) {
  const tr = useT();
  if (!dirty) return null;
  return (
    <div className="save-bar" role="region" aria-label={tr('settings.unsavedRegion')}>
      <span>{tr('settings.unsaved')}</span>
      <button className="btn" onClick={reset}>{tr('common.discard')}</button>
      <button className="btn btn-primary" disabled={saving} onClick={() => save()}>{saving ? tr('common.saving') : tr('common.save')}</button>
    </div>
  );
}

/** Linha de configuração: rótulo e explicação à esquerda, controle à direita. */
export function Row({ title, desc, children, stack, tip }) {
  return (
    <div className={`set-row ${stack ? 'stack' : ''}`}>
      <div className="set-label"><b>{title}</b>{tip && <HelpTip text={tip} />}{desc && <small>{desc}</small>}</div>
      <div className="set-control">{children}</div>
    </div>
  );
}

export function Card({ title, badge, children, desc }) {
  return (
    <section className="set-card">
      {title && <header><h3>{title}</h3>{badge}</header>}
      {desc && <p className="set-card-desc">{desc}</p>}
      {children}
    </section>
  );
}
