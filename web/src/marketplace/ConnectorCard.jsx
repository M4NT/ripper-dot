import { useState } from 'react';
import { Icon } from '../ui.jsx';
import BrandIcon from './BrandIcon.jsx';
import { authKind, authKindLabel, categoryLabel } from './catalog.js';
import { STATUS, primaryAction } from './state.js';
import '../styles/telas/marketplace/ConnectorCard.css';

function MpIcon({ id, size = 40 }) {
  if (id === 'plug') return <span className="mp-icon"><Icon name="plug" size={size * 0.45} /></span>;
  return <BrandIcon id={id} size={size} />;
}

export default function ConnectorCard({
  item,
  status,
  busy,
  onConnect,
  onOpen,
  onEnable,
  onRetry,
  onRefresh,
  error,
  logs
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [fields, setFields] = useState({});
  const [showLogs, setShowLogs] = useState(false);
  const type = item.connect?.type;
  const needsForm = type === 'token' || type === 'local';
  const action = primaryAction(status.id, type);
  const connecting = busy || status.id === STATUS.installing;

  function start() {
    if (needsForm && status.id === STATUS.available) {
      setFormOpen(true);
      return;
    }
    onConnect?.(fields);
  }

  async function submit(e) {
    e.preventDefault();
    if (type === 'token' && !String(fields.token || '').trim()) return;
    if (type === 'local') {
      for (const f of item.connect.fields || []) {
        if (!String(fields[f.key] || '').trim()) return;
      }
    }
    await onConnect?.(fields);
    setFormOpen(false);
  }

  function clickAction() {
    if (action.id === 'enable') return onEnable?.();
    if (action.id === 'retry') return onRetry?.() || start();
    if (action.id === 'reauth') return onRefresh?.() || onConnect?.(fields);
    if (action.id === 'auth') return onConnect?.(fields);
    if (action.id === 'setup') return onOpen?.();
    start();
  }

  const cls = ['mp-app'];
  if (status.id === STATUS.error) cls.push('errored');
  else if (status.id === STATUS.needs_auth || status.id === STATUS.expired) cls.push('attention');

  return (
    <article className={cls.join(' ')}>
      <button type="button" className="mp-app-icon" onClick={() => onOpen?.(item.id)} aria-label={`Ver ${item.name}`}>
        <MpIcon id={item.icon} />
      </button>
      <div className="mp-app-main">
        <button type="button" className="mp-app-title" onClick={() => onOpen?.(item.id)}>
          <b>{item.name}{item.verified && <Icon name="check" size={14} className="mp-verified" title="Verificado pelo Ripper — não é auditoria de segurança" />}</b>
        </button>
        <small>{item.desc}</small>
        <div className="mp-app-meta">
          {status.label && status.id !== STATUS.connected && <span className={`mp-status ${status.tone || ''}`}>{status.label}</span>}
          {status.hint && <span className="tag">{status.hint}</span>}
          <span className="tag">{authKindLabel(authKind(item))}</span>
          {item.category && <span className="tag">{categoryLabel(item.category)}</span>}
          {item.custom && <span className="tag">Seu</span>}
        </div>
      </div>
      <div className="mp-app-actions">
        {status.id === STATUS.connected ? (
          <span className="mp-status ok">Conectado</span>
        ) : !formOpen ? (
          <button type="button" className={`btn btn-sm ${action.id === 'connect' || action.id === 'auth' || action.id === 'setup' ? 'btn-primary' : ''}`}
            disabled={connecting || action.disabled} onClick={clickAction}>
            {connecting ? 'Conectando…' : action.label}
          </button>
        ) : null}
      </div>
      {(status.detail || error) && (
        <p className="mp-app-detail" role="status">{error || status.detail}</p>
      )}
      {(logs || status.logs) && (
        <div className="mp-app-form">
          <button type="button" className="link-btn" onClick={() => setShowLogs(v => !v)}>{showLogs ? 'Ocultar detalhe' : 'Ver detalhe'}</button>
          {showLogs && <pre className="mp-app-logs">{logs || status.logs}</pre>}
        </div>
      )}
      {formOpen && (
        <form className="mp-app-form" onSubmit={submit}>
          {type === 'token' && (
            <label>
              Token
              <input className="input" type="password" autoComplete="off" placeholder="cole o token aqui" value={fields.token || ''}
                onChange={e => setFields(f => ({ ...f, token: e.target.value }))} />
              {item.connect.tokenHelp && <small>{item.connect.tokenHelp}</small>}
            </label>
          )}
          {type === 'local' && (item.connect.fields || []).map(f => (
            <label key={f.key}>
              {f.label}
              <input className="input" placeholder={f.placeholder || ''} value={fields[f.key] || ''}
                onChange={e => setFields(cur => ({ ...cur, [f.key]: e.target.value }))} />
              {f.hint && <small>{f.hint}</small>}
            </label>
          ))}
          <div className="mp-app-form-actions">
            <button type="button" className="btn btn-sm" onClick={() => setFormOpen(false)}>Cancelar</button>
            <button type="submit" className="btn btn-sm btn-primary" disabled={connecting}>{connecting ? 'Conectando…' : 'Conectar'}</button>
          </div>
        </form>
      )}
    </article>
  );
}

export { MpIcon };
