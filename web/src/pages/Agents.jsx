import { useEffect, useState } from 'react';
import { api } from '../lib.js';
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
  // Quem está trabalhando agora, em qualquer lugar (rotina, fluxo, WhatsApp, outra aba): atualiza a cada 4s com a aba visível.
  const [working, setWorking] = useState({});
  useEffect(() => {
    const load = () => document.visibilityState === 'visible' && api('/api/agents/working').then(r => setWorking(r.working || {}), () => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);
  // ativos primeiro, depois quem conversou mais recentemente (mesma ordem do Início)
  const lastUsed = id => Math.max(0, ...S.chats.filter(c => (c.agentIds || [c.agentId]).includes(id)).map(c => c.updatedAt || c.createdAt || 0));
  const list = [...S.agents]
    .sort((a, b) => (a.status === 'paused') - (b.status === 'paused') || lastUsed(b.id) - lastUsed(a.id))
    .filter(a => filter === 'all' || (filter === 'working' ? !!working[a.id] : a.status === filter))
    .filter(a => !q || (a.name + a.description + a.category).toLowerCase().includes(q.toLowerCase()));
  const count = s => S.agents.filter(a => s === 'all' || (s === 'working' ? !!working[a.id] : a.status === s)).length;
  return (
    <div className="page v2">
      <header className="page-head">
        <div><h1>{t('agents.title')}</h1><p className="lede">{t('agents.lede')}</p></div>
        <div className="page-head-actions">
          {enterprise && <a href="#/new?template=architect" className="btn">{t('agents.architect')}</a>}
          <a href="#/new" className="btn btn-primary"><Icon name="plus" size={16} />{t('agents.new')}</a>
        </div>
      </header>
      <div className="toolbar">
        <Segmented label="Filtrar por status" value={filter} onChange={setFilter} items={[['all', t('agents.filterAll'), count('all')], ...(count('online') !== count('all') || filter === 'online' ? [['online', t('agents.filterOnline'), count('online')]] : []), ['paused', t('agents.filterPaused'), count('paused')], ...(count('working') || filter === 'working' ? [['working', 'Trabalhando', count('working')]] : [])]} />
        <label className="search-field"><Icon name="search" size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={t('agents.search')} aria-label={t('agents.search')} /></label>
      </div>
      {list.length === 0
        ? <EmptyState title={t('agents.empty.title')} body={q ? t('agents.empty.bodySearch', { q }) : t('agents.empty.body')} />
        : <div className="agent-grid">{list.map(a => <AgentCard key={a.id} agent={a} live={working[a.id]} />)}<NewAgentCard /></div>}
    </div>
  );
}
