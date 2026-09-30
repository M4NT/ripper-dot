import { useState } from 'react';
import { useApp } from '../app.jsx';
import { Segmented, Icon, EmptyState } from '../ui.jsx';
import AgentCard, { NewAgentCard } from '../agentCard.jsx';

export default function Agents() {
  const { S } = useApp();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const list = S.agents
    .filter(a => filter === 'all' || a.status === filter)
    .filter(a => !q || (a.name + a.description + a.category).toLowerCase().includes(q.toLowerCase()));
  const count = s => S.agents.filter(a => s === 'all' || a.status === s).length;
  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Agentes</h1><p className="lede">Cada agente tem instruções, ferramentas e um computador só dele.</p></div>
        <a href="#/new" className="btn btn-primary"><Icon name="plus" size={16} />Novo agente</a>
      </header>
      <div className="toolbar">
        <Segmented label="Filtrar por status" value={filter} onChange={setFilter} items={[['all', 'Todos', count('all')], ['online', 'Online', count('online')], ['paused', 'Pausados', count('paused')]]} />
        <label className="search-field"><Icon name="search" size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar agentes" aria-label="Buscar agentes" /></label>
      </div>
      {list.length === 0
        ? <EmptyState title="Nenhum agente aqui" body={q ? `Nada combina com “${q}”.` : 'Pause um agente para ele aparecer nesta lista.'} />
        : <div className="agent-grid">{list.map(a => <AgentCard key={a.id} agent={a} />)}<NewAgentCard /></div>}
    </div>
  );
}
