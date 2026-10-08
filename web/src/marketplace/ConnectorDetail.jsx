import { Icon } from '../ui.jsx';
import BrandIcon from './BrandIcon.jsx';
import OmiePanel from './OmiePanel.jsx';

const HOW = {
  oauth: 'Você faz login na conta do serviço numa janela; o Ripper guarda o acesso e renova sozinho.',
  token: 'Usa um token pessoal seu. Ele fica guardado no servidor do Ripper e nunca aparece na interface.',
  claude: 'Este vem pela sua conta claude.ai: conecte lá uma vez e todos os agentes com "Conectores" ligado passam a usar.',
  local: 'Roda nesta máquina, numa versão fixa. Ao conectar, o Ripper pede os dados de acesso abaixo.',
  native: 'Conexão direta com a API do Omie, sem servidor intermediário. Cada empresa tem a sua chave.'
};

export default function ConnectorDetail({ item, onBack, onConnect, connecting, connected }) {
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
        {item.connect?.type === 'native' ? null
          : connected
          ? <span className="mp-status ok">Conectado</span>
          : <button type="button" className="btn btn-primary mp-detail-cta" disabled={connecting} onClick={onConnect}>
              {connecting ? 'Conectando…' : item.connect?.type === 'claude' ? 'Conectar no claude.ai' : 'Conectar'}
            </button>}
      </header>
      <p className="mp-detail-body">{item.body}</p>
      {HOW[item.connect?.type] && <p className="mp-detail-body muted">{HOW[item.connect.type]}</p>}
      {item.connect?.help && <p className="mp-detail-body muted">{item.connect.help}</p>}
      {item.connect?.type === 'native' && <OmiePanel />}
      <div className="mp-detail-trust">
        <Icon name="globe" size={16} />
        <p>Use apenas conectores de desenvolvedores em quem você confia. O Ripper não controla as ferramentas de terceiros nem garante o comportamento delas.</p>
      </div>
      <footer className="mp-detail-foot">
        <div><span className="mp-detail-meta-label">Desenvolvido por</span> {item.author}</div>
        <div className="mp-detail-url"><span className="mp-detail-meta-label">Servidor</span> <code>{item.connectorUrl}</code></div>
      </footer>
    </div>
  );
}
