import { useRef, useState } from 'react';
import { useApp } from '../app.jsx';
import { api, go, fmtAgo, fmtSize } from '../lib.js';
import { AgentAvatar, Icon, Segmented, EmptyState, useConfirm, StatusDot } from '../ui.jsx';
import { AgentPicker } from './Projects.jsx';
import { uploadFile } from '../composer.jsx';
import ChatRow from '../chatRow.jsx';
import { ArtifactList } from '../actions.jsx';
import ProjectBoard from './ProjectBoard.jsx';

export default function Project({ id }) {
  const { S, agent, refresh, toast } = useApp();
  const p = S.projects.find(x => x.id === id);
  const [tab, setTab] = useState('chats');
  const [pick, setPick] = useState(() => p?.agentIds || []);
  const [instructions, setInstructions] = useState(p?.instructions || '');
  const [editing, setEditing] = useState(false);
  const [confirm, confirmNode] = useConfirm();
  const input = useRef(null);
  if (!p) return <div className="page"><EmptyState title="Projeto não encontrado" action={<a className="btn" href="#/projects">Ver projetos</a>} /></div>;

  const members = p.agentIds.map(agent).filter(Boolean);
  const chats = S.chats.filter(c => c.projectId === p.id).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  const files = S.files.filter(f => f.projectId === p.id);
  const arts = S.artifacts.filter(a => a.projectId === p.id);
  const save = async patch => { try { await api(`/api/projects/${p.id}`, { method: 'PUT', body: patch }); await refresh(); } catch (e) { toast(e.message, 'error'); } };
  const startGroup = ids => ids.length < 2 ? toast('Escolha pelo menos dois agentes.', 'error') : go(`/p/${p.id}/new?agents=${ids.join(',')}`);
  const startSolo = aid => go(`/p/${p.id}/new?agents=${aid}`);
  const selected = pick.filter(x => p.agentIds.includes(x));

  async function remove() {
    if (!(await confirm({ title: `Excluir o projeto ${p.name}?`, body: 'As conversas continuam na sua lista, sem projeto. Os arquivos do projeto são apagados.', action: 'Excluir projeto', danger: true }))) return;
    await api(`/api/projects/${p.id}`, { method: 'DELETE' }); await refresh(); go('/projects');
  }
  async function addFiles(list) {
    for (const f of list) { try { await uploadFile(null, null, f, p.id); } catch (e) { toast(e.message, 'error'); } }
    refresh(); toast('Arquivos adicionados ao projeto');
  }

  return (
    <div className="page project-page">
      <nav className="crumbs" aria-label="Caminho"><a href="#/projects"><Icon name="arrowL" size={15} />Projetos</a><span>/</span><b>{p.name}</b></nav>
      <header className="project-head">
        <div className="grow">
          {editing ? (
            <form className="project-edit" onSubmit={e => { e.preventDefault(); const f = new FormData(e.target); save({ name: f.get('name'), description: f.get('description') }).then(() => setEditing(false)); }}>
              <input name="name" defaultValue={p.name} className="input title-input-lg" aria-label="Nome do projeto" autoFocus />
              <textarea name="description" defaultValue={p.description} className="input" rows={2} aria-label="Objetivo" placeholder="Objetivo do projeto" />
              <div className="row"><button className="btn btn-primary btn-sm">Salvar</button><button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>Cancelar</button></div>
            </form>
          ) : <>
            <h1>{p.name}<button className="icon-btn sm" onClick={() => setEditing(true)} aria-label="Editar nome e objetivo"><Icon name="edit" size={15} /></button></h1>
            <p className="lede">{p.description || 'Sem objetivo definido.'}</p>
          </>}
        </div>
        <div className="project-actions">
          <span className="avatar-stack">{members.slice(0, 5).map(a => <AgentAvatar key={a.id} agent={a} size={32} paused />)}</span>
          <button className="btn btn-primary" disabled={members.length < 2} onClick={() => startGroup(p.agentIds)} title={members.length < 2 ? 'Adicione pelo menos dois agentes' : undefined}><Icon name="group" size={16} />Conversa em grupo</button>
        </div>
      </header>

      <Segmented label="Seções do projeto" value={tab} onChange={setTab} className="seg-scroll"
        items={[['chats', 'Conversas', chats.length], ['board', 'Quadro'], ['artifacts', 'Artefatos', arts.length], ['team', 'Agentes', members.length], ['files', 'Arquivos', files.length], ['instructions', 'Instruções'], ['settings', 'Ajustes']]} />

      <div className="project-body">
        {tab === 'chats' && <>
          {members.length > 0 && (
            <div className="start-strip">
              <p className="muted small">Começar uma conversa</p>
              <div className="start-row">
                {members.map(a => (
                  <button key={a.id} className="start-solo" onClick={() => startSolo(a.id)}><AgentAvatar agent={a} size={24} paused /><span>{a.name}</span><Icon name="arrowR" size={14} /></button>
                ))}
                {members.length > 1 && <button className="start-solo group" onClick={() => startGroup(p.agentIds)}><Icon name="group" size={18} /><span>Todos juntos</span><Icon name="arrowR" size={14} /></button>}
              </div>
            </div>
          )}
          {chats.length === 0
            ? <EmptyState title="Nenhuma conversa no projeto" body={members.length ? 'Fale com um agente sozinho ou com o time inteiro. Instruções e arquivos do projeto entram no contexto de todos.' : 'Adicione agentes ao projeto na aba Agentes.'} />
            : <ul className="crows">{chats.map(c => <ChatRow key={c.id} c={c} />)}</ul>}
        </>}

        {tab === 'board' && <ProjectBoard project={p} members={members} />}

        {tab === 'artifacts' && <>
          <p className="muted">Entregas que os agentes salvaram neste projeto: roteiros, planos, textos finais. Todos os agentes do projeto podem ler e melhorar.</p>
          <ArtifactList items={arts} empty="Nenhum artefato ainda. Numa conversa do projeto, peça: “salve isso como artefato”." />
        </>}

        {tab === 'team' && <>
          <p className="muted">Escolha quem faz parte. Marque alguns e inicie uma conversa só com eles.</p>
          <ul className="member-cards">
            {members.map(a => (
              <li key={a.id} className={selected.includes(a.id) ? 'on' : ''}>
                <label className="member-check"><input type="checkbox" checked={selected.includes(a.id)} onChange={() => setPick(x => x.includes(a.id) ? x.filter(y => y !== a.id) : [...x, a.id])} aria-label={`Selecionar ${a.name}`} /></label>
                <AgentAvatar agent={a} size={44} />
                <div className="grow"><b>{a.name}</b><small>{a.description || a.category}</small><StatusDot status={a.status} /></div>
                <button className="btn btn-sm" onClick={() => startSolo(a.id)}>Conversar</button>
                <button className="icon-btn sm" aria-label={`Tirar ${a.name} do projeto`} onClick={() => save({ agentIds: p.agentIds.filter(x => x !== a.id) })}><Icon name="x" size={15} /></button>
              </li>
            ))}
          </ul>
          {selected.length >= 2 && <button className="btn btn-primary" onClick={() => startGroup(selected)}><Icon name="group" size={16} />Conversar com {selected.length} selecionados</button>}
          {S.agents.some(a => !p.agentIds.includes(a.id)) && <>
            <h3 className="sub">Adicionar ao projeto</h3>
            <AgentPicker agents={S.agents.filter(a => !p.agentIds.includes(a.id))} value={[]} onChange={ids => save({ agentIds: [...p.agentIds, ...ids] })} />
          </>}
          <p className="muted small">Precisa de outro especialista? <a className="link" href="#/new">Crie um agente</a> e adicione aqui.</p>
        </>}

        {tab === 'files' && <>
          <button type="button" className="dropzone" onClick={() => input.current.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles([...e.dataTransfer.files]); }}>
            <Icon name="paperclip" size={22} /><b>Arquivos do projeto</b><small>Todos os agentes do projeto conhecem estes arquivos. Até 25 MB cada.</small>
          </button>
          <input ref={input} type="file" multiple hidden onChange={e => { addFiles([...e.target.files]); e.target.value = ''; }} />
          {files.length > 0 && <ul className="rows">{files.map(f => (
            <li key={f.id} className="row-item"><span className="thumb file-ico"><Icon name="file" size={18} /></span>
              <a className="row-main" href={`/api/files/${f.id}`} target="_blank" rel="noreferrer"><b>{f.name}</b><small>{fmtSize(f.size)} · {fmtAgo(f.createdAt)}{f.chatId ? ' · enviado numa conversa' : ''}</small></a>
              <button className="icon-btn sm" aria-label={`Remover ${f.name}`} onClick={() => api(`/api/files/${f.id}`, { method: 'DELETE' }).then(refresh)}><Icon name="trash" size={16} /></button></li>
          ))}</ul>}
        </>}

        {tab === 'instructions' && <>
          <label className="field">Instruções do projeto
            <textarea rows={10} value={instructions} maxLength={8000} onChange={e => setInstructions(e.target.value)} placeholder="Contexto, prazos, tom da marca, o que cada agente deve priorizar…" />
            <small>Entram no contexto de todos os agentes em qualquer conversa deste projeto, individual ou em grupo.</small>
          </label>
          <button className="btn btn-primary" disabled={instructions === (p.instructions || '')} onClick={() => save({ instructions }).then(() => toast('Instruções salvas'))}>Salvar instruções</button>
        </>}

        {tab === 'settings' && (
          <div className="danger-zone">
            <div><b>Excluir projeto</b><small>As conversas continuam na sua lista, sem projeto. Os arquivos do projeto são apagados.</small></div>
            <button className="btn btn-danger" onClick={remove}>Excluir</button>
          </div>
        )}
      </div>
      {confirmNode}
    </div>
  );
}
