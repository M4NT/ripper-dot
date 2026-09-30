import { Icon } from '../ui.jsx';
import { go } from '../lib.js';

/** Layout fullscreen estilo Marketplace / Conectores / Habilidades. */
export default function HubShell({ title, tabs, tab, onTab, search, onSearch, searchPlaceholder, actions, onClose, children }) {
  return (
    <div className="mp-page">
      <header className="mp-head">
        <div className="mp-head-left">
          {title && <h1>{title}</h1>}
          {tabs && onTab && (
            <div className="mp-tabs" role="tablist">
              {tabs.map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => onTab(k)}>{label}</button>
              ))}
            </div>
          )}
        </div>
        <div className="mp-head-center">
          {onSearch != null && (
            <label className="mp-search">
              <Icon name="search" size={16} />
              <input value={search} onChange={e => onSearch(e.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
            </label>
          )}
        </div>
        <div className="mp-head-right">
          {actions}
          <button type="button" className="icon-btn" aria-label="Fechar" onClick={onClose || (() => go('/'))}><Icon name="x" /></button>
        </div>
      </header>
      <div className="mp-body">{children}</div>
    </div>
  );
}
