import { BorderBeam } from 'border-beam';
import { go, useDark } from './lib.js';
import { AgentAvatar, Icon, Menu, MenuItem, StatusDot, useConfirm } from './ui.jsx';
import { useApp } from './app.jsx';
import { api } from './lib.js';

/** Card de agente. Enquanto o agente responde, a borda ganha um feixe (border-beam). */
export default function AgentCard({ agent }) {
  const { busy, updateAgent, refresh, toast, S } = useApp();
  const [confirm, confirmNode] = useConfirm();
  const working = !!busy[agent.id];
  const dark = useDark();
  const paused = agent.status === 'paused';

  async function remove() {
    if (!(await confirm({ title: `Excluir ${agent.name}?`, body: 'As conversas continuam na sua lista. As rotinas deste agente são apagadas.', action: 'Excluir', danger: true }))) return;
    try { await api(`/api/agents/${agent.id}`, { method: 'DELETE' }); await refresh(); toast(`${agent.name} foi excluído`); }
    catch (e) { toast(e.message, 'error'); }
  }

  return (
    <BorderBeam size="pulse-inner" colorVariant="mono" theme={dark ? 'dark' : 'light'} active={working} strength={0.8}>
      <article className={`agent-card ${paused ? 'is-paused' : ''}`}>
        <a href={`#/a/${agent.id}`} className="agent-card-link" aria-label={`Conversar com ${agent.name}`} />
        <div className="agent-card-av"><AgentAvatar agent={agent} size={64} state={working ? 'working' : undefined} /></div>
        <div className="agent-card-body">
          <h3>{agent.name}</h3>
          <p>{agent.description || 'Sem descrição.'}</p>
        </div>
        <div className="agent-card-foot">
          <StatusDot status={agent.status} />
          {working && <span className="working-label">respondendo</span>}
        </div>
        <Menu align="right" className="agent-card-menu" trigger={({ toggle, open }) => (
          <button className="icon-btn sm" aria-label={`Opções de ${agent.name}`} aria-expanded={open} onClick={toggle}><Icon name="more" /></button>
        )}>
          <MenuItem icon="chat" onClick={() => go(`/a/${agent.id}`)}>Nova conversa</MenuItem>
          <MenuItem icon="gear" onClick={() => go(`/agents/${agent.id}/settings`)}>Configurar</MenuItem>
          <MenuItem icon={paused ? 'play' : 'pause'} onClick={() => updateAgent(agent.id, { status: paused ? 'online' : 'paused' }).then(() => toast(paused ? `${agent.name} voltou` : `${agent.name} pausado. Rotinas não rodam.`))}>{paused ? 'Retomar' : 'Pausar'}</MenuItem>
          {S.agents.length > 1 && <MenuItem icon="trash" danger onClick={remove}>Excluir</MenuItem>}
        </Menu>
        {confirmNode}
      </article>
    </BorderBeam>
  );
}

export function NewAgentCard() {
  return (
    <a href="#/new" className="agent-card agent-card-new">
      <span className="new-plus"><Icon name="plus" size={22} /></span>
      <b>Novo agente</b>
    </a>
  );
}
