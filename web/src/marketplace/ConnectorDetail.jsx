import { Icon } from '../ui.jsx';
import BrandIcon from './BrandIcon.jsx';
import OmiePanel from './OmiePanel.jsx';
import CertificadosPanel from './CertificadosPanel.jsx';
import { STATUS } from './state.js';
import '../styles/telas/marketplace/ConnectorDetail.css';

const HOW = {
  oauth: 'Você faz login na conta do serviço numa janela; o Ripper guarda o acesso e renova sozinho.',
  token: 'Usa um token pessoal seu. Ele fica guardado no servidor do Ripper e nunca aparece na interface.',
  claude: 'Este vem pela sua conta claude.ai: conecte lá uma vez e todos os agentes com aplicativos ligados passam a usar.',
  local: 'Roda nesta máquina, numa versão fixa. Ao conectar, o Ripper pede os dados de acesso abaixo.',
  native: 'Conexão direta com a API do Omie, sem servidor intermediário. Cada empresa tem a sua chave.'
};

export default function ConnectorDetail({ item, onBack, onConnect, connecting, connected, status, onRemove, onDisable }) {
  if (!item) return null;
  const st = status || (connected ? { id: STATUS.connected, label: 'Conectado', tone: 'ok' } : { id: STATUS.available });
  const showCta = item.connect?.type !== 'native' && st.id !== STATUS.connected;
  const cta = st.id === STATUS.needs_auth || st.id === STATUS.expired ? 'Entrar'
    : st.id === STATUS.error ? 'Tentar de novo'
    : st.id === STATUS.off ? 'Ligar'
    : item.connect?.type === 'claude' ? 'Conectar no claude.ai' : 'Conectar';
  return (
    <div className="mp-detail">
      <button type="button" className="link-btn mp-detail-back" onClick={onBack}><Icon name="arrowL" size={14} /> Aplicativos</button>
      <header className="mp-detail-hero">
        <BrandIcon id={item.icon} size={72} />
        <div className="mp-detail-title">
          <h1>{item.name}{item.verified && <Icon name="check" size={16} className="mp-verified" title="Verificado pelo Ripper — não é auditoria de segurança" />}</h1>
          <p className="mp-detail-tag">{item.tagline}</p>
          {st.label && <p className={`mp-status ${st.tone || ''}`}>{st.label}{st.detail ? ` — ${st.detail}` : ''}</p>}
        </div>
        {showCta
          ? <button type="button" className="btn btn-primary mp-detail-cta" disabled={connecting} onClick={onConnect}>
              {connecting ? 'Conectando…' : cta}
            </button>
          : item.connect?.type !== 'native' ? <span className="mp-status ok">Conectado</span> : null}
      </header>
      <p className="mp-detail-body">{item.body}</p>
      {HOW[item.connect?.type] && <p className="mp-detail-body muted">{HOW[item.connect.type]}</p>}
      {item.connect?.help && <p className="mp-detail-body muted">{item.connect.help}</p>}
      {item.connect?.type === 'native' && <OmiePanel />}
      {item.connect?.type === 'native' && <CertificadosPanel />}
      {(onDisable || onRemove) && (
        <div className="mp-detail-manage">
          {onDisable && <button type="button" className="btn btn-sm" onClick={onDisable}>Desativar</button>}
          {onRemove && <button type="button" className="btn btn-sm" onClick={onRemove}>Remover</button>}
        </div>
      )}
      <div className="mp-detail-trust">
        <Icon name="globe" size={16} />
        <p>Use apenas aplicativos de desenvolvedores em quem você confia. O Ripper não controla as ferramentas de terceiros nem garante o comportamento delas. Verificado não significa auditado.</p>
      </div>
      <footer className="mp-detail-foot">
        <div><span className="mp-detail-meta-label">Desenvolvido por</span> {item.author}</div>
        <div className="mp-detail-url"><span className="mp-detail-meta-label">Endereço</span> <code>{item.connectorUrl}</code></div>
      </footer>
    </div>
  );
}
