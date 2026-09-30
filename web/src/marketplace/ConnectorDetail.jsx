import { Icon } from '../ui.jsx';
import BrandIcon from './BrandIcon.jsx';

export default function ConnectorDetail({ item, onBack, onConnect, connecting }) {
  if (!item) return null;
  return (
    <div className="mp-detail">
      <button type="button" className="link-btn mp-detail-back" onClick={onBack}><Icon name="arrowL" size={14} /> Conectores</button>
      <header className="mp-detail-hero">
        <BrandIcon id={item.icon} size={72} />
        <div className="mp-detail-title">
          <h1>{item.name}{item.verified && <Icon name="check" size={16} className="mp-verified" title="Verificado" />}</h1>
          <p className="mp-detail-tag">{item.tagline}</p>
        </div>
        <button type="button" className="btn btn-primary mp-detail-cta" disabled={connecting} onClick={onConnect}>
          {connecting ? 'Conectando…' : 'Conectar ao Ripper'}
        </button>
      </header>
      <p className="mp-detail-body">{item.body}</p>
      <section className="mp-detail-tools">
        <h2>Ferramentas</h2>
        <div className="mp-tool-chips">
          {item.tools.map(t => <code key={t} className="mp-tool-chip">{t}</code>)}
        </div>
      </section>
      <div className="mp-detail-trust">
        <Icon name="globe" size={16} />
        <p>Use apenas conectores de desenvolvedores em quem você confia. O Ripper não controla as ferramentas de terceiros nem garante o comportamento delas.</p>
      </div>
      <footer className="mp-detail-foot">
        <div><span className="mp-detail-meta-label">Desenvolvido por</span> <a href="#" onClick={e => e.preventDefault()}>{item.author}</a></div>
        <div className="mp-detail-url"><span className="mp-detail-meta-label">URL do conector</span> <code>{item.connectorUrl}</code></div>
      </footer>
    </div>
  );
}
