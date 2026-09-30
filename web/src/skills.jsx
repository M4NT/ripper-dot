import { useState } from 'react';
import { api, fmtAgo } from './lib.js';
import { Dialog, Icon, AgentAvatar, EmptyState, Select } from './ui.jsx';
import { useOv } from './overlay.jsx';
import { useApp } from './app.jsx';

function SkillEditor({ skill, close }) {
  const { S, refresh, toast } = useApp();
  const [v, setV] = useState({ name: skill?.name || '', description: skill?.description || '', content: skill?.content || '', projectId: skill?.projectId || '' });
  const [saving, setSaving] = useState(false);
  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api(skill ? `/api/skills/${skill.id}` : '/api/skills', { method: skill ? 'PUT' : 'POST', body: { ...v, projectId: v.projectId || null } });
      await refresh(); toast(skill ? 'Skill atualizada' : 'Skill criada'); close();
    } catch (err) { toast(err.message, 'error'); setSaving(false); }
  }
  return (
    <Dialog open onClose={close} className="skill-dialog" label={skill ? 'Editar skill' : 'Nova skill'}>
      <form onSubmit={save}>
        <div className="dialog-head"><h2>{skill ? 'Editar skill' : 'Nova skill'}</h2><button type="button" className="icon-btn" onClick={close} aria-label="Fechar"><Icon name="x" /></button></div>
        <p className="muted small skill-help">Uma skill é um passo a passo reutilizável. Os agentes veem só o nome e a descrição e carregam o resto quando precisam, o que economiza tokens.</p>
        <label className="field">Nome<input value={v.name} maxLength={60} onChange={e => setV({ ...v, name: e.target.value })} placeholder="post-linkedin-industria" required autoFocus /></label>
        <label className="field">Quando usar<input value={v.description} maxLength={200} onChange={e => setV({ ...v, description: e.target.value })} placeholder="Ao escrever posts de LinkedIn para empresas industriais." /></label>
        <label className="field">Instruções<textarea rows={10} value={v.content} maxLength={20000} onChange={e => setV({ ...v, content: e.target.value })} placeholder={'1. Abra com um dado do setor.\n2. Um parágrafo de contexto.\n3. Feche com uma pergunta.'} required /></label>
        <div className="field"><span>Onde vale</span>
          <Select label="Onde vale" value={v.projectId} onChange={projectId => setV({ ...v, projectId })}
            options={[{ value: '', label: 'Todos os agentes', hint: 'Skill global' }, ...S.projects.map(p => ({ value: p.id, label: p.name, hint: 'Só neste projeto' }))]} />
        </div>
        <div className="row end"><button type="button" className="btn" onClick={close}>Cancelar</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar skill'}</button></div>
      </form>
    </Dialog>
  );
}

export function useSkillEditor() {
  const ov = useOv();
  return skill => ov.show(close => <SkillEditor skill={skill} close={close} />);
}

export function SkillList({ projectId }) {
  const { S, agent, refresh, toast } = useApp();
  const ov = useOv();
  const edit = useSkillEditor();
  const list = S.skills.filter(k => projectId === undefined || !k.projectId || k.projectId === projectId);
  const menu = (e, k) => ov.menu(e, [
    { label: 'Editar', icon: 'edit', onSelect: () => edit(k) },
    { label: 'Copiar instruções', icon: 'copy', onSelect: () => { navigator.clipboard.writeText(k.content); toast('Copiado'); } },
    { sep: true },
    { label: 'Apagar skill', icon: 'trash', danger: true, onSelect: async () => {
      if (!(await ov.confirm({ title: `Apagar a skill “${k.name}”?`, body: 'Os agentes deixam de poder usá-la.', action: 'Apagar', danger: true }))) return;
      await api(`/api/skills/${k.id}`, { method: 'DELETE' }); refresh();
    } }
  ], k.name);
  return <>
    <div className="row"><p className="muted grow">Passo a passos que funcionaram e podem se repetir. Os próprios agentes também criam skills quando algo dá certo.</p><button className="btn btn-primary" onClick={() => edit(null)}><Icon name="plus" size={16} />Nova skill</button></div>
    {list.length === 0 ? <EmptyState title="Nenhuma skill ainda" body="Crie uma ou peça a um agente: “guarde isso como skill”." /> :
      <ul className="skill-list">{list.map(k => {
        const author = agent(k.createdBy);
        const proj = k.projectId && S.projects.find(p => p.id === k.projectId);
        return (
          <li key={k.id} onContextMenu={e => menu(e, k)}>
            <button className="skill-card" onClick={() => edit(k)}>
              <span className="skill-ico"><Icon name="bolt" size={17} /></span>
              <span className="skill-text"><b>{k.name}</b><small>{k.description || 'Sem descrição.'}</small>
                <em>{proj ? proj.name : 'Global'} · {author ? <>criada por {author.name}</> : 'criada por você'} · {fmtAgo(k.updatedAt)}</em></span>
              {author && <AgentAvatar agent={author} size={22} paused />}
            </button>
          </li>
        );
      })}</ul>}
  </>;
}
