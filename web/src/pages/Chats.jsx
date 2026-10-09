import { useMemo, useState } from 'react';
import { useApp } from '../app.jsx';
import { AgentAvatar, Icon, EmptyState, useConfirm, Select, Segmented } from '../ui.jsx';
import { api } from '../lib.js';
import ChatRow from '../chatRow.jsx';
import '../styles/telas/pages/Chats.css';

export default function Chats() {
  const { S, refresh, toast } = useApp();
  const [q, setQ] = useState('');
  const [who, setWho] = useState('all');
  const [view, setView] = useState('active'); // active | archived
  const [tag, setTag] = useState(null);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [newTag, setNewTag] = useState('');
  const [confirm, confirmNode] = useConfirm();

  const tags = useMemo(() => [...new Set(S.chats.flatMap(c => c.tags || []))].sort(), [S.chats]);
  const visible = useMemo(() => [...S.chats]
    .filter(c => !c.inboxKey) // conversa entre agentes: abre dentro da conversa de quem pediu
    .filter(c => (view === 'archived') === !!c.archived)
    .filter(c => who === 'all' || c.agentId === who || (c.agentIds || []).includes(who))
    .filter(c => !tag || (c.tags || []).includes(tag))
    .filter(c => !q || (c.title + ' ' + (c.preview || '') + ' ' + (c.tags || []).join(' ')).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)), [S.chats, q, who, tag, view]);
  const groups = useMemo(() => {
    const day = 864e5, t0 = new Date().setHours(0, 0, 0, 0);
    const label = t => t >= t0 ? 'Hoje' : t >= t0 - day ? 'Ontem' : t >= t0 - 7 * day ? 'Últimos 7 dias' : 'Mais antigas';
    const out = new Map();
    visible.forEach(c => { const k = label(c.updatedAt || c.createdAt); out.set(k, [...(out.get(k) || []), c]); });
    return [...out];
  }, [visible]);
  const archivedCount = S.chats.filter(c => c.archived).length;

  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const stopSelecting = () => { setSelecting(false); setSel(new Set()); setNewTag(''); };
  async function bulk(action, extra = {}) {
    if (!sel.size) return;
    if (action === 'delete' && !(await confirm({ title: `Apagar ${sel.size} ${sel.size === 1 ? 'conversa' : 'conversas'}?`, body: 'Não dá para desfazer.', action: 'Apagar', danger: true }))) return;
    try {
      const ids = [...sel];
      const r = await api('/api/chats/bulk', { method: 'POST', body: { ids, action, ...extra } });
      await refresh();
      const texto = { archive: 'Arquivadas', unarchive: 'De volta às ativas', tag: `Etiqueta “${extra.tag}” aplicada`, delete: 'Apagadas' }[action] + (r.skipped ? ` · ${r.skipped} respondendo agora ficou de fora` : '');
      // Arquivar e desarquivar se desfazem com um toque (apagar não tem volta, por isso não oferece "Desfazer")
      const oposto = { archive: 'unarchive', unarchive: 'archive' }[action];
      if (oposto && r.changed) toast(texto, 'info', { label: 'Desfazer', run: async () => { await api('/api/chats/bulk', { method: 'POST', body: { ids, action: oposto } }); await refresh(); toast(oposto === 'archive' ? 'Arquivadas de novo' : 'De volta às ativas'); } });
      else toast(texto);
      stopSelecting();
    } catch (e) { toast(e.message, 'error'); }
  }

  return (
    <div className="page narrow">
      <header className="page-head">
        <div><h1>Conversas</h1><p className="lede">{(() => { const n = S.chats.length - archivedCount; return n ? `${n} ${n === 1 ? 'conversa ativa' : 'conversas ativas'}${archivedCount ? ` · ${archivedCount} arquivada${archivedCount === 1 ? '' : 's'}` : ''}` : `Nenhuma conversa ainda. ${S.agents.length} ${S.agents.length === 1 ? 'agente disponível' : 'agentes disponíveis'}.`; })()}</p></div>
        {visible.length > 0 && <button type="button" className="btn" onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>{selecting ? 'Cancelar' : 'Selecionar'}</button>}
      </header>
      <div className="toolbar">
        {archivedCount > 0 && <Segmented label="Mostrar" value={view} onChange={v => { setView(v); stopSelecting(); }} items={[['active', 'Ativas'], ['archived', 'Arquivadas', archivedCount]]} />}
        <label className="search-field grow"><Icon name="search" size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por título, conteúdo ou etiqueta" aria-label="Buscar conversas" /></label>
        <Select label="Filtrar por agente" value={who} onChange={setWho} className="select-filter" options={[
          { value: 'all', label: 'Todos os agentes', icon: <Icon name="agents" size={16} /> },
          ...S.agents.map(a => ({ value: a.id, label: a.name, icon: <AgentAvatar agent={a} size={20} paused /> }))]} />
      </div>
      {tags.length > 0 && (
        <div className="tag-filter" role="group" aria-label="Filtrar por etiqueta">
          {tags.map(t => <button key={t} type="button" className={`pill ${tag === t ? 'on' : ''}`} aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>#{t}</button>)}
        </div>
      )}
      {groups.length === 0 && <EmptyState title={q || tag ? 'Nada encontrado' : view === 'archived' ? 'Nenhuma arquivada' : 'Nenhuma conversa ainda'} body={q ? `Nenhuma conversa com “${q}”.` : tag ? `Nenhuma conversa com #${tag}.` : view === 'archived' ? 'Conversas arquivadas aparecem aqui.' : 'Comece falando com um agente.'} action={!q && !tag && view === 'active' && <a href="#/" className="btn btn-primary">Começar</a>} />}
      {groups.map(([g, list]) => (
        <section key={g} className="chat-group">
          <h2 className="group-label">{g}</h2>
          <ul className={`crows ${selecting ? 'selecting' : ''}`}>{list.map(ch => selecting
            ? <li key={ch.id} className={`crow-select ${sel.has(ch.id) ? 'on' : ''}`}>
                <label><input type="checkbox" checked={sel.has(ch.id)} onChange={() => toggle(ch.id)} aria-label={`Selecionar ${ch.title}`} /><span className="crow-select-title">{ch.title}</span>{(ch.tags || []).map(t => <span key={t} className="tag-pill">#{t}</span>)}</label>
              </li>
            : <ChatRow key={ch.id} c={ch} showProject />)}</ul>
        </section>
      ))}
      {selecting && (
        <div className="bulk-bar" role="toolbar" aria-label="Ações nas conversas selecionadas">
          <button type="button" className="btn btn-sm" onClick={() => setSel(sel.size === visible.length ? new Set() : new Set(visible.map(c => c.id)))}>{sel.size === visible.length ? 'Nenhuma' : 'Todas'}</button>
          <span className="bulk-count">{sel.size} {sel.size === 1 ? 'selecionada' : 'selecionadas'}</span>
          <span className="grow" />
          <form className="bulk-tag" onSubmit={e => { e.preventDefault(); if (newTag.trim()) bulk('tag', { tag: newTag.trim() }); }}>
            <input className="input" value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="etiqueta" aria-label="Etiqueta para aplicar" list="chat-tags" />
            <datalist id="chat-tags">{tags.map(t => <option key={t} value={t} />)}</datalist>
            <button className="btn btn-sm" disabled={!sel.size || !newTag.trim()}><Icon name="plus" size={14} />Etiquetar</button>
          </form>
          {view === 'active'
            ? <button type="button" className="btn btn-sm" disabled={!sel.size} onClick={() => bulk('archive')}><Icon name="down" size={14} />Arquivar</button>
            : <button type="button" className="btn btn-sm" disabled={!sel.size} onClick={() => bulk('unarchive')}><Icon name="arrowUp" size={14} />Desarquivar</button>}
          <button type="button" className="btn btn-sm btn-danger" disabled={!sel.size} onClick={() => bulk('delete')}><Icon name="trash" size={14} />Apagar</button>
        </div>
      )}
      {confirmNode}
    </div>
  );
}
