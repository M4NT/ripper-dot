// Página de amostra da identidade nova (estilo cua.ai + verde neon). Não faz parte do app.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BotAvatar } from 'bot-avatars';
import './amostra.css';

const AGENTES = [
  { nome: 'Donald', funcao: 'Design & Front-end', type: 'cloud', state: 'working' },
  { nome: 'Engenheiro', funcao: 'Escreve e roda código', type: 'droid', state: 'default' },
  { nome: 'Quinn', funcao: 'Testa e reporta bugs', type: 'ghost', state: 'default' },
  { nome: 'Porteiro', funcao: 'Recepção do WhatsApp', type: 'cat', state: 'sleeping' }
];

function Mascote({ type, state, size = 72, tema }) {
  const dormindo = state === 'sleeping';
  return <BotAvatar type={type} size={size} state={state} shading="flat"
    color={tema === 'claro' ? '#1b1d1c' : '#2e322f'}
    ink={dormindo ? '#4a4d4b' : '#3DFF7A'} paused={state !== 'working'} />;
}

function Amostra() {
  const [tema, setTema] = useState('escuro');
  return (
    <div className={`am tema-${tema}`}>
      <header className="am-top">
        <span className="am-logo"><span className="dot" /> Ripper</span>
        <nav className="am-nav">
          <button className={tema === 'escuro' ? 'on' : ''} onClick={() => setTema('escuro')}>Escuro</button>
          <button className={tema === 'claro' ? 'on' : ''} onClick={() => setTema('claro')}>Claro</button>
        </nav>
      </header>

      {/* Início limpo */}
      <section className="am-hero">
        <div className="am-mascote-hero"><Mascote type="cloud" state="working" size={132} tema={tema} /></div>
        <p className="eyebrow">Início</p>
        <h1>O que seus agentes<br />fazem <em>por você</em> hoje?</h1>
        <div className="am-ask">
          <span className="am-ask-cmd">/pergunte</span>
          <input placeholder="peça qualquer coisa ao Donald…" />
          <button className="btn-primary" aria-label="Enviar">Enviar</button>
        </div>
        <div className="am-pills">
          <button className="pill">Resuma meus e-mails de hoje</button>
          <button className="pill">Crie um agente de atendimento</button>
          <button className="pill">O que mudou no projeto?</button>
        </div>
      </section>

      {/* Paleta */}
      <section className="am-sec">
        <p className="eyebrow">01 · Cores</p>
        <h2>Preto, branco e <em>um</em> verde.</h2>
        <div className="am-swatches">
          {[['--bg', 'Fundo'], ['--s1', 'Superfície'], ['--s2', 'Superfície 2'], ['--line', 'Linha'], ['--ink', 'Texto'], ['--muted', 'Apagado'], ['--neon', 'Neon'], ['--neon-ink', 'Texto verde']].map(([v, n]) =>
            <div key={v} className="sw"><span style={{ background: `var(${v})` }} /><b>{n}</b><code>{v}</code></div>)}
        </div>
        <p className="am-note">Neon é raro: uma ação principal por tela e o que está vivo agora. No tema claro, texto verde usa <code>--neon-ink</code>.</p>
      </section>

      {/* Tipografia */}
      <section className="am-sec">
        <p className="eyebrow">02 · Tipografia</p>
        <div className="am-type">
          <div><p className="eyebrow">Títulos · Instrument Serif</p><p className="t-display">Agentes que <em>trabalham</em></p></div>
          <div><p className="eyebrow">Texto e interface · Urbanist</p><p className="t-body">Cada agente tem computador próprio, memória e rotinas. Você acompanha tudo pela Caixa.</p></div>
          <div><p className="eyebrow">Rótulos e comandos · JetBrains Mono</p><p className="t-mono">3 AGENTES ONLINE / 1 PRECISA DE VOCÊ</p></div>
        </div>
      </section>

      {/* Componentes */}
      <section className="am-sec">
        <p className="eyebrow">03 · Componentes</p>
        <div className="am-row">
          <button className="btn-primary">Criar agente</button>
          <button className="btn">Ver Caixa</button>
          <button className="btn ghost">Cancelar</button>
          <span className="status"><span className="dot pulse" /> online</span>
          <span className="status off"><span className="dot" /> pausado</span>
          <span className="badge">2 novas</span>
        </div>
        <div className="am-cards">
          {[['01', 'Computador próprio', 'Cada agente roda num computador isolado, com seus arquivos.'],
            ['02', 'Memória e rotinas', 'Lembra do que importa e trabalha no horário que você marcar.'],
            ['03', 'No seu celular', 'Pareie com um QR Code e converse de qualquer lugar.']].map(([n, t, d]) =>
            <article key={n} className="card"><span className="eyebrow">{n}</span><h3>{t}</h3><p>{d}</p></article>)}
        </div>
      </section>

      {/* Mascotes */}
      <section className="am-sec">
        <p className="eyebrow">04 · Mascotes com a pele Ripper</p>
        <h2>Corpo grafite, olhos <em>acesos</em>.</h2>
        <div className="am-agents">
          {AGENTES.map(a =>
            <article key={a.nome} className="agent">
              <Mascote type={a.type} state={a.state} tema={tema} />
              <div><h3>{a.nome}</h3><p>{a.funcao}</p></div>
              <span className={`status ${a.state === 'sleeping' ? 'off' : ''}`}><span className={`dot ${a.state === 'working' ? 'pulse' : ''}`} />{a.state === 'working' ? 'trabalhando' : a.state === 'sleeping' ? 'pausado' : 'online'}</span>
            </article>)}
        </div>
        <p className="am-note">Olho verde = acordado. Olho apagado = pausado. O cartão mostra só nome, função e status; números ficam na página do agente.</p>
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Amostra />);
