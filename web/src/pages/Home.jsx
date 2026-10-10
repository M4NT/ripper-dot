import { useEffect, useRef, useState } from 'react';
import { MetalFx } from '../fx/metal.jsx';
import { api, go, local, useDark } from '../lib.js';
import { AgentAvatar, Icon, Menu, Dialog } from '../ui.jsx';
import { useApp } from '../app.jsx';
import { isEnterpriseMode } from '../uiMode.js';
import AgentCard, { NewAgentCard } from '../agentCard.jsx';
import Composer from '../composer.jsx';
import { sessionPayload } from '../marketplace/sessionMcp.js';

const TEMPLATE_ICON = { Pesquisa: 'search', Dados: 'data', Operações: 'bolt', Atendimento: 'chat', Marketing: 'edit', Vendas: 'agents', Produtividade: 'clock', Arquitetura: 'agents' };

/* Campo de pontos em meio-tom: uma esfera iluminada, desenhada como geometria pura. */
function Halftone() {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current, ctx = c.getContext('2d');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf, t0 = performance.now(), visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !reduce) loop(); });
    io.observe(c);
    function draw(t) {
      const dpr = Math.min(devicePixelRatio, 2), w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = getComputedStyle(c).color;
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.46, step = 9;
      const a = t / 9000, lx = Math.cos(a) * 0.7, ly = -0.55, lz = Math.sqrt(Math.max(0, 1 - lx * lx - ly * ly));
      for (let y = cy - R; y <= cy + R; y += step) for (let x = cx - R; x <= cx + R; x += step) {
        const nx = (x - cx) / R, ny = (y - cy) / R, d2 = nx * nx + ny * ny;
        if (d2 > 1) {
          // halo: pontos esparsos que se dissolvem fora da esfera
          const f = 1 - (Math.sqrt(d2) - 1) / 0.35;
          if (f > 0 && ((x * 7 + y * 13) % 5 < 1)) { ctx.beginPath(); ctx.arc(x, y, 0.9 * f, 0, 7); ctx.fill(); }
          continue;
        }
        const nz = Math.sqrt(1 - d2), shade = Math.max(0, 1 - (nx * lx + ny * ly + nz * lz)); // lado escuro = pontos maiores
        const r = 0.45 + shade * 3.1;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      }
    }
    function loop() { cancelAnimationFrame(raf); const tick = now => { draw(now - t0); if (visible && !reduce) raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); }
    draw(0); if (!reduce) loop();
    const ro = new ResizeObserver(() => draw(performance.now() - t0)); ro.observe(c);
    return () => { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); };
  }, []);
  return <canvas ref={ref} className="halftone" aria-hidden="true" />;
}

function HeroArt({ agent }) {
  const ink = useDark() ? '#ece9e3' : '#1a1917';
  const labels = [['Raciocina', 'l1'], ['Executa', 'l2'], ['Aprende', 'l3'], ['Conecta', 'l4']];
  return (
    <div className="hero-art" aria-hidden="true">
      <Halftone />
      <svg className="hero-lines" viewBox="0 0 520 460" preserveAspectRatio="none">
        <path d="M118 78 C 90 170, 170 230, 250 236" /><circle cx="118" cy="78" r="3" /><circle cx="196" cy="216" r="4" />
        <path d="M420 92 C 380 120, 330 150, 300 190" /><circle cx="420" cy="92" r="3" /><circle cx="352" cy="140" r="4" />
        <path d="M150 380 C 190 360, 210 330, 238 300" /><circle cx="150" cy="380" r="3" /><circle cx="210" cy="332" r="4" />
      </svg>
      <div className="hero-bot"><AgentAvatar agent={{ ...agent, avatar: { ...agent.avatar, color: ink }, status: 'online' }} size={168} interactive animate /></div>
      {labels.map(([l, c]) => <span key={l} className={`hero-label ${c}`}>{l}</span>)}
    </div>
  );
}

function HowItWorks({ open, onClose }) {
  const steps = [
    ['Crie', 'Dê nome, função e instruções. Comece do zero ou de um template.'],
    ['Equipe', 'Ligue pesquisa na web, um computador próprio, memória, rotinas e plugins MCP.'],
    ['Converse', 'Ripper Auto escolhe entre Claude e ChatGPT a cada pedido e troca sozinho se um falhar.'],
    ['Automatize', 'Rotinas rodam no horário e abrem uma conversa nova com o resultado.']
  ];
  return (
    <Dialog open={open} onClose={onClose} className="how" label="Como funciona">
      <div className="dialog-head"><h2>Como o Ripper funciona</h2><button className="icon-btn" onClick={onClose} aria-label="Fechar"><Icon name="x" /></button></div>
      <ol className="how-list">{steps.map(([t, d]) => <li key={t}><b>{t}</b><span>{d}</span></li>)}</ol>
      <div className="row end"><button className="btn btn-primary" onClick={() => { onClose(); go('/new'); }}>Criar meu primeiro agente<Icon name="arrowR" size={16} /></button></div>
    </Dialog>
  );
}

export default function Home() {
  const { S, agent } = useApp();
  const [how, setHow] = useState(false);
  // Agentes por uso: ativos primeiro, depois quem conversou mais recentemente (os pausados vão para o fim).
  const lastUsed = id => Math.max(0, ...S.chats.filter(c => (c.agentIds || [c.agentId]).includes(id)).map(c => c.updatedAt || c.createdAt || 0));
  const byUse = [...S.agents].sort((a, b) => (a.status === 'paused') - (b.status === 'paused') || lastUsed(b.id) - lastUsed(a.id));
  const [agentId, setAgentId] = useState(() => {
    const saved = S.agents.find(a => a.id === local.get('homeAgent'));
    return (saved && saved.status !== 'paused' ? saved : byUse[0]).id; // nunca abre perguntando a um agente pausado
  });
  const current = agent(agentId) || S.agents[0];
  const [choice, setChoice] = useState({ model: current.model || S.settings.defaultModel, effort: current.effort || 'auto' });
  const dark = useDark();
  const enterprise = isEnterpriseMode(S.settings);
  const [pulse, setPulse] = useState(null);
  useEffect(() => { api('/api/pulse').then(setPulse, () => {}); }, []);

  function start({ text, fileIds }) {
    // A conversa nasce na tela de chat; a mensagem vai junto.
    sessionStorage.setItem('ripper.pending', JSON.stringify({ agentId: current.id, text, fileIds, ...choice, mcpSession: sessionPayload() }));
    go(`/a/${current.id}`);
  }

  return (
    <div className="page home">
      {pulse && !pulse.empty ? (
        <section className="pulse-card" aria-label="Resumo do dia">
          <header className="section-head"><h2>O que seus agentes fizeram nas últimas 24 horas</h2><a href="#/agents" className="link">Ver agentes<Icon name="arrowR" size={16} /></a></header>
          <p className="pulse-body">{pulse.body}</p>
        </section>
      ) : <section className="hero">
        <div className="hero-copy">
          <h1>Crie agentes<br />que realmente<br /><em>trabalham</em> por você.</h1>
          <p className="lede">Agentes com computador próprio, memória e rotinas. Rodam nas assinaturas do Claude e do ChatGPT que você já tem.</p>
          <div className="hero-cta">
            <MetalFx variant="button" preset="silver" theme={dark ? "dark" : "light"} strength={0.85} normalizeHostStyles={false}>
              <a href="#/new" className="btn btn-primary btn-lg">
                <Icon name="plus" size={17} />Criar novo agente<Icon name="arrowR" size={17} />
              </a>
            </MetalFx>
            <button className="btn btn-lg" onClick={() => setHow(true)}><Icon name="play" size={15} />Ver como funciona</button>
          </div>
        </div>
        <HeroArt agent={current} />
      </section>}

      <section className="home-composer">
        <Composer agent={current} choice={choice} setChoice={setChoice} onSend={start} draftKey="home"
          placeholder={`Pergunte algo ao ${current.name}…`} />
        <div className="ask-as">
          <span className="muted">Conversando com</span>
          <Menu trigger={({ toggle, open }) => (
            <button className="chip" onClick={toggle} aria-expanded={open}><AgentAvatar agent={current} size={18} />{current.name}<Icon name="down" size={13} /></button>
          )}>
            {S.agents.map(a => (
              <button key={a.id} role="menuitem" className={`menu-item ${a.id === current.id ? 'on' : ''}`} onClick={() => { setAgentId(a.id); local.set('homeAgent', a.id); setChoice({ model: a.model || S.settings.defaultModel, effort: a.effort || 'auto' }); }}>
                <AgentAvatar agent={a} size={20} />{a.name}
              </button>
            ))}
          </Menu>
        </div>
      </section>

      <section className="section">
        <header className="section-head"><h2>Seus agentes</h2><a href="#/agents" className="link">Ver todos{S.agents.length > 4 ? ` (${S.agents.length})` : ''}<Icon name="arrowR" size={16} /></a></header>
        <div className="agent-grid">
          {byUse.slice(0, 4).map(a => <AgentCard key={a.id} agent={a} />)}
          <NewAgentCard />
        </div>
      </section>

      <section className="section">
        <header className="section-head"><h2>Templates</h2><a href={enterprise ? '#/explore' : '#/new'} className="link">Ver todos<Icon name="arrowR" size={16} /></a></header>
        <div className="template-row">
          {S.templates.slice(0, 4).map(t => (
            <a key={t.id} href={`#/new?template=${t.id}`} className="template-line">
              <span className="template-ico"><Icon name={TEMPLATE_ICON[t.category] || 'file'} size={18} /></span>
              <span><b>{t.name}</b><small>{t.description}</small></span>
              <Icon name="arrowR" size={17} className="go" />
            </a>
          ))}
        </div>
      </section>
      <HowItWorks open={how} onClose={() => setHow(false)} />
    </div>
  );
}
