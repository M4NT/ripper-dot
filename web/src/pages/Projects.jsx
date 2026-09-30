import { useState } from 'react';
import { useApp } from '../app.jsx';
import { api, go, fmtAgo } from '../lib.js';
import { AgentAvatar, Dialog, Icon, EmptyState } from '../ui.jsx';

export function AgentPicker({ agents, value, onChange }) {
  const toggle = id => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  return (
    <div className="picker" role="group" aria-label="Agentes">
      {agents.map(a => (
        <button key={a.id} type="button" aria-pressed={value.includes(a.id)} className={`pick ${value.includes(a.id) ? 'on' : ''}`} onClick={() => toggle(a.id)}>
          <AgentAvatar agent={a} size={28} paused />
          <span><b>{a.name}</b><small>{a.description || a.category}</small></span>
          <span className="pick-check">{value.includes(a.id) && <Icon name="check" size={14} />}</span>
        </button>
      ))}
    </div>
  );
}

export function NewProjectDialog({ open, onClose }) {
  const { S, refresh, toast } = useApp();
  const [v, setV] = useState({ name: '', description: '', agentIds: S.agents.slice(0, 3).map(a => a.id) });
  const [saving, setSaving] = useState(false);
  async function create(e) {
    e.preventDefault();
    if (!v.name.trim()) return;
    setSaving(true);
    try { const p = await api('/api/projects', { method: 'POST', body: v }); await refresh(); onClose(); go(`/p/${p.id}`); toast('Projeto criado'); }
    catch (err) { toast(err.message, 'error'); }
    setSaving(false);
  }
  return (
    <Dialog open={open} onClose={onClose} className="project-dialog" label="Novo projeto">
      <form onSubmit={create}>
        <div className="dialog-head"><h2>Novo projeto</h2><button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar"><Icon name="x" /></button></div>
        <label className="field">Nome<input autoFocus value={v.name} maxLength={80} onChange={e => setV({ ...v, name: e.target.value })} placeholder="Ex.: Lançamento do app" required /></label>
        <label className="field">Objetivo<textarea rows={2} value={v.description} maxLength={300} onChange={e => setV({ ...v, description: e.target.value })} placeholder="O que este projeto precisa entregar." /></label>
        <div className="field"><span>Agentes do projeto</span><AgentPicker agents={S.agents} value={v.agentIds} onChange={agentIds => setV({ ...v, agentIds })} /></div>
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={!v.name.trim() || saving}>{saving ? 'Criando…' : 'Criar projeto'}</button></div>
      </form>
    </Dialog>
  );
}

export default function Projects() {
  const { S, agent } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Projetos</h1><p className="lede">Reúna agentes em torno de um objetivo. Converse com um de cada vez ou com o time todo.</p></div>
        <button className="btn btn-primary" onClick={() => setOpen(true)}><Icon name="plus" size={16} />Novo projeto</button>
      </header>
      {S.projects.length === 0
        ? <EmptyState title="Nenhum projeto ainda" body="Um projeto junta agentes, instruções e arquivos. Dentro dele, cada agente trabalha sozinho ou em grupo." action={<button className="btn btn-primary" onClick={() => setOpen(true)}><Icon name="plus" size={16} />Criar o primeiro</button>} />
        : (
          <div className="project-grid">
            {S.projects.map(p => {
              const chats = S.chats.filter(c => c.projectId === p.id);
              const last = Math.max(p.updatedAt || p.createdAt, ...chats.map(c => c.updatedAt || c.createdAt));
              return (
                <a key={p.id} href={`#/p/${p.id}`} className="project-card">
                  <div className="project-top">
                    <span className="project-ico"><Icon name="folder" size={20} /></span>
                    <span className="avatar-stack">{p.agentIds.slice(0, 5).map(id => agent(id) && <AgentAvatar key={id} agent={agent(id)} size={28} paused />)}</span>
                  </div>
                  <h3>{p.name}</h3>
                  <p>{p.description || 'Sem objetivo definido.'}</p>
                  <div className="project-meta"><span>{p.agentIds.length} agente{p.agentIds.length === 1 ? '' : 's'}</span><span>{chats.length} conversa{chats.length === 1 ? '' : 's'}</span><time>{fmtAgo(last)}</time></div>
                </a>
              );
            })}
            <button className="project-card project-new" onClick={() => setOpen(true)}><span className="new-plus"><Icon name="plus" size={22} /></span><b>Novo projeto</b></button>
          </div>
        )}
      {open && <NewProjectDialog open onClose={() => setOpen(false)} />}
    </div>
  );
}
