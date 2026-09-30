import { useMemo, useState } from 'react';
import { useApp } from '../app.jsx';
import { AgentAvatar, Icon, EmptyState, useConfirm, Select } from '../ui.jsx';
import { api, fmtAgo } from '../lib.js';
import ChatRow from '../chatRow.jsx';

export default function Chats() {
  const { S, agent, refresh, toast } = useApp();
  const [q, setQ] = useState('');
  const [who, setWho] = useState('all');
  const [confirm, confirmNode] = useConfirm();
  const groups = useMemo(() => {
    const day = 864e5, t0 = new Date().setHours(0, 0, 0, 0);
    const label = t => t >= t0 ? 'Hoje' : t >= t0 - day ? 'Ontem' : t >= t0 - 7 * day ? 'Últimos 7 dias' : 'Mais antigas';
    const out = new Map();
    [...S.chats]
      .filter(c => who === 'all' || c.agentId === who)
      .filter(c => !q || (c.title + ' ' + (c.preview || '')).toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
      .forEach(c => { const k = label(c.updatedAt || c.createdAt); out.set(k, [...(out.get(k) || []), c]); });
    return [...out];
  }, [S.chats, q, who]);

  async function remove(c) {
    if (!(await confirm({ title: `Apagar “${c.title}”?`, body: 'Não dá para desfazer.', action: 'Apagar', danger: true }))) return;
    await api(`/api/chats/${c.id}`, { method: 'DELETE' }); refresh(); toast('Conversa apagada');
  }

  return (
    <div className="page narrow">
      <header className="page-head"><div><h1>Conversas</h1><p className="lede">{S.chats.length} conversas com {S.agents.length} agentes.</p></div></header>
      <div className="toolbar">
        <label className="search-field grow"><Icon name="search" size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por título ou conteúdo" aria-label="Buscar conversas" /></label>
        <Select label="Filtrar por agente" value={who} onChange={setWho} className="select-filter" options={[
          { value: 'all', label: 'Todos os agentes', icon: <Icon name="agents" size={16} /> },
          ...S.agents.map(a => ({ value: a.id, label: a.name, icon: <AgentAvatar agent={a} size={20} paused /> }))]} />
      </div>
      {groups.length === 0 && <EmptyState title={q ? 'Nada encontrado' : 'Nenhuma conversa ainda'} body={q ? `Nenhuma conversa com “${q}”.` : 'Comece falando com um agente.'} action={!q && <a href="#/" className="btn btn-primary">Começar</a>} />}
      {groups.map(([g, list]) => (
        <section key={g} className="chat-group">
          <h2 className="group-label">{g}</h2>
          <ul className="crows">{list.map(ch => <ChatRow key={ch.id} c={ch} showProject />)}</ul>
        </section>
      ))}
      {confirmNode}
    </div>
  );
}
