// Amostra da identidade "Rack": cada agente é uma unidade no rack. Não faz parte do app.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BotAvatar } from 'bot-avatars';
import { Icon } from './ui.jsx';
import './amostra.css';

// dados ilustrativos
const RACKS = [
  { nome: 'Multipli', unidades: [
    { id: 'donald', nome: 'Donald', funcao: 'Design e front-end', type: 'cloud', cor: '#8fb4ff', st: 'on', agora: 'Ajustando a tela de login do site', desde: '3 min' },
    { id: 'eng', nome: 'Engenheiro', funcao: 'Escreve e roda código', type: 'droid', cor: '#b9a4ff', st: 'wait', agora: 'Quer abrir um PR em ripper-dot', desde: '1 min', pedido: { o: 'Abrir pull request', d: '“Retoma turnos após reinício” · 3 arquivos' } },
    { id: 'quinn', nome: 'Quinn', funcao: 'Testa e reporta bugs', type: 'ghost', cor: '#ffc28a', st: 'idle', agora: 'Terminou 24 testes, 0 falhas', desde: '40 min' },
    { id: 'porteiro', nome: 'Porteiro', funcao: 'Recepção do WhatsApp', type: 'cat', cor: '#8fe0b8', st: 'off', agora: 'Pausado por você', desde: 'ontem' }
  ] },
  { nome: 'Pessoal', unidades: [
    { id: 'agenda', nome: 'Agenda', funcao: 'Organiza compromissos', type: 'pebble', cor: '#ffadc6', st: 'fault', agora: 'Não conseguiu acessar o Google Agenda', desde: '2 h' }
  ] }
];
const ST = { on: 'Trabalhando', wait: 'Esperando você', idle: 'Ligado', off: 'Desligado', fault: 'Com problema' };
const CONVERSA = {
  donald: [['eu', 'Deixa a tela de login mais simples, só e-mail e senha.'], ['ag', 'Feito o primeiro corte: tirei os botões de redes sociais e juntei os textos. Estou ajustando o espaçamento agora.']],
  eng: [['eu', 'Corrige o bug do reinício e abre o PR.'], ['ag', 'Corrigido e testado (624 testes passando). Posso abrir o pull request?']],
  quinn: [['ag', 'Rodei a bateria completa: 24 testes, nenhuma falha. Relatório salvo na Biblioteca.']],
  porteiro: [['ag', 'Fui pausado. Mensagens novas no WhatsApp ficam esperando até você me ligar de novo.']],
  agenda: [['ag', 'A permissão do Google Agenda expirou. Reconecte em Conectores para eu voltar a funcionar.']]
};
const NAV = [['home', 'Início'], ['inbox', 'Caixa', 1], ['agents', 'Agentes'], ['chat', 'Conversas'], ['clock', 'Rotinas'], ['plug', 'Conectores']];

function resumo(us) {
  const ligados = us.filter(u => u.st !== 'off').length, esperando = us.filter(u => u.st === 'wait').length, falha = us.filter(u => u.st === 'fault').length;
  return [`${ligados} de ${us.length} ligados`, esperando && `${esperando} esperando você`, falha && `${falha} com problema`].filter(Boolean).join(' · ');
}

function Unidade({ u, aberta, onOpen, n }) {
  return (
    <li className={`unit st-${u.st}${aberta ? ' out' : ''}`}>
      <button className="unit-face" onClick={onOpen} aria-expanded={aberta} aria-label={`${u.nome}, ${ST[u.st]}`}>
        <span className="u-num">{String(n).padStart(2, '0')}</span>
        <span className="led" aria-hidden="true" />
        <span className="u-av"><BotAvatar type={u.type} color={u.cor} size={30} shading="flat" state={u.st === 'off' ? 'sleeping' : u.st === 'on' ? 'working' : 'default'} paused={u.st !== 'on'} /></span>
        <span className="plate"><b>{u.nome}</b><small>{u.funcao}</small></span>
        <span className="u-now"><span>{u.agora}</span><small>{ST[u.st]} · {u.desde}</small></span>
        <span className="vent" aria-hidden="true" />
      </button>
      {u.pedido && (
        <div className="unit-ask">
          <span><b>{u.pedido.o}</b> {u.pedido.d}</span>
          <button className="btn">Ver</button>
          <button className="btn go">Aprovar</button>
        </div>
      )}
    </li>
  );
}

function Amostra() {
  const [tema, setTema] = useState('claro');
  const [aberta, setAberta] = useState('eng');
  const todas = RACKS.flatMap(r => r.unidades);
  const sel = todas.find(u => u.id === aberta);
  let n = 0;
  return (
    <div className={`app tema-${tema}`}>
      <aside className="rail">
        <div className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>Ripper</div>
        <nav>{NAV.map(([ic, nome, c], i) => <a key={nome} href="#" className={i === 0 ? 'on' : ''} onClick={e => e.preventDefault()}><Icon name={ic} size={17} />{nome}{c && <span className="count">{c}</span>}</a>)}</nav>
        <div className="rail-foot">
          <button className="theme" onClick={() => setTema(t => t === 'claro' ? 'escuro' : 'claro')}><Icon name={tema === 'claro' ? 'moon' : 'sun'} size={16} />{tema === 'claro' ? 'Tema escuro' : 'Tema claro'}</button>
          <p className="local"><Icon name="key" size={14} />Roda no seu computador</p>
        </div>
      </aside>

      <main className="floor">
        <header className="floor-head">
          <h1>Seus agentes</h1>
          <p>{resumo(todas)}</p>
        </header>
        {RACKS.map(r => (
          <section key={r.nome} className="rack" aria-label={`Projeto ${r.nome}`}>
            <h2><span>{r.nome}</span><small>{resumo(r.unidades)}</small></h2>
            <ol className="rack-body">
              {r.unidades.map(u => <Unidade key={u.id} u={u} n={++n} aberta={aberta === u.id} onOpen={() => setAberta(a => a === u.id ? null : u.id)} />)}
              <li className="unit empty"><button className="unit-face add"><Icon name="plus" size={16} />Instalar novo agente</button></li>
            </ol>
          </section>
        ))}
        <form className="ask" onSubmit={e => e.preventDefault()}>
          <label className="ask-to">Para <b>{sel?.nome || 'Ripper'}</b></label>
          <input placeholder={`Peça algo${sel ? ` ao ${sel.nome}` : ''}…`} aria-label="Mensagem" />
          <button className="btn go" aria-label="Enviar"><Icon name="arrowUp" size={16} /></button>
        </form>
      </main>

      <aside className={`side${sel ? ' open' : ''}`} aria-label="Conversa">
        {sel ? <>
          <header className="side-head">
            <BotAvatar type={sel.type} color={sel.cor} size={40} shading="flat" state={sel.st === 'on' ? 'working' : sel.st === 'off' ? 'sleeping' : 'default'} paused={sel.st !== 'on'} />
            <div><h2>{sel.nome}</h2><p className={`st-txt st-${sel.st}`}><span className="led" />{ST[sel.st]}</p></div>
            <button className="icon-btn" onClick={() => setAberta(null)} aria-label="Fechar"><Icon name="x" size={16} /></button>
          </header>
          <div className="msgs">{CONVERSA[sel.id].map(([q, t], i) => <p key={i} className={`msg ${q}`}>{t}</p>)}</div>
          <dl className="spec">
            <div><dt>Computador</dt><dd>{sel.st === 'off' ? 'Desligado' : 'Ligado · 2 GB'}</dd></div>
            <div><dt>Hoje</dt><dd>{sel.st === 'off' ? '—' : '18 respostas · 31 ações'}</dd></div>
          </dl>
        </> : <p className="side-empty">Abra uma unidade do rack para conversar.</p>}
      </aside>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Amostra />);
