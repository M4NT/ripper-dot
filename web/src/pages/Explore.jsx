import { useState } from 'react';
import { useApp } from '../app.jsx';
import { AgentAvatar, Icon, Segmented, EmptyState } from '../ui.jsx';
import { TOOL_INFO } from '../lib.js';
import '../styles/telas/pages/Explore.css';

export default function Explore() {
  const { S } = useApp();
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const cats = ['all', ...new Set(S.templates.map(t => t.category))];
  const list = S.templates
    .filter(t => cat === 'all' || t.category === cat)
    .filter(t => !q || (t.name + t.description).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <header className="page-head"><div><h1>Templates</h1><p className="lede">Comece com um agente pronto e ajuste ao seu contexto.</p></div></header>
      <div className="toolbar wrap">
        <Segmented label="Categoria" value={cat} onChange={setCat} items={cats.map(c => [c, c === 'all' ? 'Todos' : c])} className="seg-scroll" />
        <label className="search-field"><Icon name="search" size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar templates" aria-label="Buscar templates" /></label>
      </div>
      {list.length === 0 ? <EmptyState title="Nenhum template encontrado" body="Tente outra busca ou crie do zero." action={<a className="btn" href="#/new">Criar do zero</a>} /> : (
        <div className="template-grid">
          {list.map(t => (
            <a key={t.id} href={`#/new?template=${t.id}`} className="template-card">
              <AgentAvatar agent={{ name: t.name, avatar: t.avatar, status: 'online' }} size={72} />
              <h3>{t.name}</h3>
              <p>{t.description}</p>
              <div className="tpl-tools">{t.tools.map(x => <span key={x} title={TOOL_INFO[x].label}><Icon name={TOOL_INFO[x].icon} size={14} /></span>)}</div>
              <span className="tag">{t.category}</span>
              <span className="tpl-use">Usar template<Icon name="arrowR" size={15} /></span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
