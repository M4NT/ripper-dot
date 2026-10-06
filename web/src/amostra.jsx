// Página de amostra da identidade nova (sensação de painel Cloudflare: claro, seguro, direto). Não faz parte do app.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BotAvatar } from 'bot-avatars';
import './amostra.css';

const AGENTES = [
  { nome: 'Donald', funcao: 'Design & Front-end', type: 'cloud', cor: '#5b8def', st: 'trabalhando', ult: 'agora' },
  { nome: 'Engenheiro', funcao: 'Escreve e roda código', type: 'droid', cor: '#8a6cf0', st: 'ativo', ult: 'há 12 min' },
  { nome: 'Quinn', funcao: 'Testa e reporta bugs', type: 'ghost', cor: '#e0904a', st: 'ativo', ult: 'há 1 h' },
  { nome: 'Porteiro', funcao: 'Recepção do WhatsApp', type: 'cat', cor: '#4bb38a', st: 'pausado', ult: 'ontem' }
];
const NAV = [['Início', true], ['Caixa', false, 2], ['Agentes'], ['Conversas'], ['Rotinas'], ['Conectores']];

const Av = ({ a, size = 28 }) => <BotAvatar type={a.type} color={a.cor} size={size} shading="flat"
  state={a.st === 'pausado' ? 'sleeping' : a.st === 'trabalhando' ? 'working' : 'default'} paused={a.st !== 'trabalhando'} />;
const Status = ({ st }) => <span className={`badge b-${st}`}><i />{st[0].toUpperCase() + st.slice(1)}</span>;

function Amostra() {
  const [tema, setTema] = useState('claro');
  return (
    <div className={`app tema-${tema}`}>
      <aside className="side">
        <div className="brand"><span className="mark" />Ripper</div>
        <button className="search">Buscar <kbd>Ctrl K</kbd></button>
        <nav>{NAV.map(([n, on, c]) => <a key={n} className={on ? 'on' : ''}>{n}{c && <span className="count">{c}</span>}</a>)}</nav>
        <div className="side-foot">
          <div className="secure"><span className="lock" />Tudo roda no seu computador</div>
          <div className="seg"><button className={tema === 'claro' ? 'on' : ''} onClick={() => setTema('claro')}>Claro</button><button className={tema === 'escuro' ? 'on' : ''} onClick={() => setTema('escuro')}>Escuro</button></div>
        </div>
      </aside>

      <main className="main">
        <header className="page-head">
          <div><p className="crumb">Início</p><h1>Bom dia, Yan</h1></div>
          <button className="btn primary">+ Novo agente</button>
        </header>

        <section className="panel ask">
          <textarea rows={2} placeholder="Peça algo ao Donald…" />
          <div className="ask-bar">
            <span className="chip">Donald ▾</span>
            <button className="btn primary sm">Enviar</button>
          </div>
        </section>

        <div className="stats">
          {[['Agentes ativos', '3 de 4'], ['Tarefas hoje', '46'], ['Precisam de você', '2'], ['Uso da assinatura', '38%']].map(([k, v]) =>
            <div key={k} className="panel stat"><p>{k}</p><b>{v}</b></div>)}
        </div>

        <section className="panel">
          <div className="panel-head"><h2>Agentes</h2><a className="link">Ver todos →</a></div>
          <table>
            <thead><tr><th>Nome</th><th>Função</th><th>Status</th><th>Última ação</th></tr></thead>
            <tbody>{AGENTES.map(a =>
              <tr key={a.nome}><td><span className="who"><Av a={a} />{a.nome}</span></td><td className="muted">{a.funcao}</td><td><Status st={a.st} /></td><td className="muted">{a.ult}</td></tr>)}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Precisa de você</h2></div>
          <div className="alert warn"><b>Quinn quer enviar um e-mail</b><span>Para cliente@empresa.com · "Relatório de testes da semana"</span><div className="alert-actions"><button className="btn sm">Ver</button><button className="btn primary sm">Aprovar</button></div></div>
          <div className="alert info"><b>Conta Claude perto do limite</b><span>O Ripper troca sozinho para a outra conta às 17:20.</span></div>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Componentes</h2></div>
          <div className="row">
            <button className="btn primary">Salvar</button><button className="btn">Cancelar</button><button className="btn danger">Excluir</button>
            <Status st="ativo" /><Status st="trabalhando" /><Status st="pausado" /><Status st="erro" />
          </div>
          <div className="row"><label className="field">Nome do agente<input defaultValue="Donald" /></label><label className="field">Função<input placeholder="Ex.: atendimento" /></label></div>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Amostra />);
