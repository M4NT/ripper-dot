import { useEffect, useState } from 'react';
import { useApp } from '../app.jsx';
import { api, fmtAgo } from '../lib.js';
import { AgentAvatar, Icon } from '../ui.jsx';

const COLUMNS = [['todo', 'A fazer'], ['doing', 'Fazendo'], ['done', 'Feito']];

export default function ProjectBoard({ project, members }) {
  const { agent, refresh, toast } = useApp();
  const [tasks, setTasks] = useState(null);
  const [over, setOver] = useState(null);
  const base = `/api/projects/${project.id}/tasks`;
  const load = () => api(base).then(setTasks).catch(e => toast(e.message, 'error'));
  useEffect(() => { load(); }, [project.id]);
  const running = tasks?.some(t => t.running);
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => load().then(refresh), 3000); // ponytail: polling enquanto algum card roda; SSE se o quadro crescer
    return () => clearInterval(iv);
  }, [running]);

  const call = async (path, method, body) => {
    try { await api(path, { method, body }); await load(); } catch (e) { toast(e.message, 'error'); }
  };
  const update = (t, patch) => call(`${base}/${t.id}`, 'PUT', patch);
  const run = t => call(`${base}/${t.id}/run`, 'POST').then(refresh);

  if (!tasks) return <p className="muted">Carregando quadro…</p>;
  return (
    <div className="board">
      {COLUMNS.map(([status, label]) => {
        const items = tasks.filter(t => t.status === status).sort((a, b) => a.createdAt - b.createdAt);
        return (
          <section key={status} className={'board-col' + (over === status ? ' over' : '')} aria-label={label}
            onDragOver={e => { e.preventDefault(); setOver(status); }} onDragLeave={() => setOver(null)}
            onDrop={e => { e.preventDefault(); setOver(null); const t = tasks.find(x => x.id === e.dataTransfer.getData('text/plain')); if (t && t.status !== status) update(t, { status }); }}>
            <h3>{label}<span className="muted">{items.length}</span></h3>
            <ul>
              {items.map(t => {
                const a = agent(t.assigneeId);
                return (
                  <li key={t.id} className={'board-card' + (t.error ? ' err' : '')} draggable onDragStart={e => e.dataTransfer.setData('text/plain', t.id)}>
                    <b>{t.title}</b>
                    {t.note && <p>{t.note}</p>}
                    {t.error && <p className="board-error" role="alert">{t.error}</p>}
                    <div className="board-meta">
                      {a && <AgentAvatar agent={a} size={22} paused={!t.running} state={t.running ? 'working' : undefined} />}
                      <small>{t.running ? 'Trabalhando…' : fmtAgo(t.createdAt)}</small>
                      {t.chatId && <a className="link small" href={`#/c/${t.chatId}`}>Ver conversa</a>}
                    </div>
                    <div className="board-actions">
                      <select className="input input-sm" value={t.status} aria-label={`Mover “${t.title}”`} onChange={e => update(t, { status: e.target.value })}>
                        {COLUMNS.map(([s, l]) => <option key={s} value={s}>{l}</option>)}
                      </select>
                      <select className="input input-sm" value={t.assigneeId || ''} aria-label={`Responsável por “${t.title}”`} onChange={e => update(t, { assigneeId: e.target.value || null })}>
                        <option value="">Sem agente</option>
                        {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                      {a && !t.running && status !== 'done' && <button className="btn btn-sm" onClick={() => run(t)}>Pedir ao agente</button>}
                      <button className="icon-btn sm" aria-label={`Excluir “${t.title}”`} onClick={() => call(`${base}/${t.id}`, 'DELETE')}><Icon name="trash" size={15} /></button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <form className="board-add" onSubmit={e => {
              e.preventDefault(); const f = e.target; const title = f.title.value.trim(); if (!title) return;
              call(base, 'POST', { title, note: f.note.value, status, assigneeId: f.assignee.value || null }).then(() => f.reset());
            }}>
              <input name="title" className="input input-sm" placeholder="Nova tarefa" aria-label={`Nova tarefa em ${label}`} maxLength={200} />
              <input name="note" className="input input-sm" placeholder="Nota (opcional)" aria-label="Nota" maxLength={2000} />
              <div className="row">
                <select name="assignee" className="input input-sm" aria-label="Agente responsável" defaultValue="">
                  <option value="">Sem agente</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <button className="btn btn-sm"><Icon name="plus" size={14} />Adicionar</button>
              </div>
            </form>
          </section>
        );
      })}
    </div>
  );
}
