// Amostra no estilo da referência do dono (mensageiro escuro). Não faz parte do app.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BotAvatar } from 'bot-avatars';
import { Icon } from './ui.jsx';
import './amostra.css';

const AG = {
  valt: { nome: 'Valt', funcao: 'Core financeiro', type: 'blob', cor: '#f26a1b' },
  atlas: { nome: 'Atlas', funcao: 'Arquiteto de software', type: 'cloud', cor: '#ffffff' },
  barriga: { nome: 'Sr. Barriga', funcao: 'Financeiro', type: 'circle', cor: '#1677ff' },
  donald: { nome: 'Donald', funcao: 'Design & Front-end', type: 'cloud', cor: '#ffffff' },
  rex: { nome: 'Rex', funcao: 'Atendimento', type: 'drop', cor: '#e8317a' }
};
const FIXOS = ['valt', 'atlas'];
const CONVERSAS = [
  { id: 'barriga', ultima: 'Respondi o Valt: pagamento cancelado' },
  { id: 'donald', ultima: 'As abas e o botão de liberar já estão prontos' },
  { id: 'rex', ultima: 'Em que posso ajudar?' },
  { id: 'grupo', nome: 'Os Danadinhos', membros: ['valt', 'barriga', 'rex'], ultima: 'Fechado. Consolidei pra você' }
];

const Av = ({ id, size = 44 }) => { const a = AG[id]; return <BotAvatar type={a.type} color={a.cor} size={size} shading="flat" paused />; };

function Amostra() {
  const [ativo, setAtivo] = useState('atlas');
  const [aba, setAba] = useState('Detalhes');
  const a = AG[ativo] || AG.atlas;
  return (
    <div className="app">
      <aside className="side">
        <div className="side-top">
          <button className="round" aria-label="Buscar"><Icon name="search" size={18} /></button>
          <button className="round" aria-label="Novo"><Icon name="plus" size={18} /></button>
        </div>
        <div className="pins">
          {FIXOS.map(id => (
            <button key={id} className={`pin${ativo === id ? ' on' : ''}`} onClick={() => setAtivo(id)}>
              <span className="pin-av"><Av id={id} size={64} />{id === 'atlas' && <i className="dot" />}</span>
              <b>{AG[id].nome}</b><small>{AG[id].funcao}</small>
            </button>
          ))}
        </div>
        <ul className="list">
          {CONVERSAS.map(c => (
            <li key={c.id}><button className={ativo === c.id ? 'on' : ''} onClick={() => AG[c.id] && setAtivo(c.id)}>
              {c.membros ? <span className="trio">{c.membros.map(m => <Av key={m} id={m} size={22} />)}</span> : <Av id={c.id} size={44} />}
              <span className="row-txt">
                <span className="row-top"><b>{c.nome || AG[c.id].nome}</b>{!c.membros && <em className="tag">{AG[c.id].funcao}</em>}</span>
                <span className="row-last">{c.ultima}</span>
              </span>
            </button></li>
          ))}
        </ul>
        <div className="side-foot">
          <span className="me">Y</span>
          <button className="connect">Conectar aplicativos</button>
        </div>
      </aside>

      <main className="chat">
        <div className="thread">
          <p className="when">sáb., 3 de out. 13:23</p>
          <div className="bubble">Juntei o PR de ajustes do modo simples. Testes passando, era o único aberto no ripper-dot.</div>
          <p className="when">Ontem 16:39</p>
          <div className="bubble">
            <p>A fila do ripper-dot zerou. Os próximos ajustes de interface ainda não começaram. Posso abrir 5 agentes em paralelo, cada um em arquivos separados:</p>
            <ul>
              <li>Segurança no modo simples: aprovações primeiro (<code>Settings.jsx</code>)</li>
              <li>Configuração do agente em 4 grupos (<code>AgentConfig.jsx</code>)</li>
              <li>Novo agente com menos modelos prontos (<code>NewAgent.jsx</code>)</li>
              <li>Aba Artefatos escondida quando vazia</li>
              <li>Busca rápida sem biblioteca no modo simples</li>
            </ul>
          </div>
          <div className="bubble ask">
            <div className="ask-head"><b>Lanço esses 5 agentes agora?</b><button className="x" aria-label="Fechar"><Icon name="x" size={16} /></button></div>
            <div className="opts">
              {['Sim, lança os 5', 'Só 1 ou 2 (eu escolho)', 'Não, deixa quieto'].map((t, i) =>
                <button key={t}><kbd>{'ABC'[i]}</kbd>{t}</button>)}
            </div>
          </div>
        </div>
        <form className="composer" onSubmit={e => e.preventDefault()}>
          <button type="button" className="round sm" aria-label="Anexar"><Icon name="plus" size={18} /></button>
          <input placeholder={`Mensagem para ${a.nome}`} aria-label="Mensagem" />
          <button type="button" className="round sm ghost" aria-label="Ditado"><Icon name="mic" size={17} /></button>
          <button className="round sm white" aria-label="Enviar"><Icon name="arrowUp" size={17} /></button>
        </form>
      </main>

      <aside className="info">
        <div className="info-top">
          <button className="round" aria-label="Compartilhar"><Icon name="share" size={17} /></button>
          <button className="round" aria-label="Painel"><Icon name="sidebar" size={17} /></button>
        </div>
        <div className="profile">
          <Av id={ativo in AG ? ativo : 'atlas'} size={88} />
          <h2>{a.nome}</h2>
          <p>{a.funcao}</p>
        </div>
        <div className="tabs">{['Detalhes', 'Mídia', 'Computador'].map(t => <button key={t} className={aba === t ? 'on' : ''} onClick={() => setAba(t)}>{t}</button>)}</div>
        <h3>Rotinas</h3>
        <div className="card">Peça no chat para configurar uma rotina.</div>
      </aside>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Amostra />);
