import { useState } from 'react';
import { useApp } from '../app.jsx';
import { Segmented, Icon, EmptyState } from '../ui.jsx';
import AgentCard, { NewAgentCard } from '../agentCard.jsx';
import { useT } from '../i18n/index.jsx';
import { isEnterpriseMode } from '../uiMode.js';

export default function Agents() {
  const { S } = useApp();
  const t = useT();
  const enterprise = isEnterpriseMode(S.settings);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const list = S.agents
    .filter(a => filter === 'all' || a.status === filter)
    .filter(a => !q || (a.name + a.description + a.category).toLowerCase().includes(q.toLowerCase()));
  const count = s => S.agents.filter(a => s === 'all' || a.status === s).length;
  return (
    <div className="page">
      <header className="page-head">
        <div><h1>{t('agents.title')}</h1><p className="lede">{t('agents.lede')}</p></div>
        <div className="page-head-actions">
          {enterprise && <a href="#/new?template=architect" className="btn">{t('agents.architect')}</a>}
          <a href="#/new" className="btn btn-primary"><Icon name="plus" size={16} />{t('agents.new')}</a>
        </div>
      </header>
      <div className="toolbar">
        <Segmented label="Filtrar por status" value={filter} onChange={setFilter} items={[['all', t('agents.filterAll'), count('all')], ['online', t('agents.filterOnline'), count('online')], ['paused', t('agents.filterPaused'), count('paused')]]} />
        <label className="search-field"><Icon name="search" size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={t('agents.search')} aria-label={t('agents.search')} /></label>
      </div>
      {list.length === 0
        ? <EmptyState title={t('agents.empty.title')} body={q ? t('agents.empty.bodySearch', { q }) : t('agents.empty.body')} />
        : <div className="agent-grid">{list.map(a => <AgentCard key={a.id} agent={a} />)}<NewAgentCard /></div>}
    </div>
  );
}
