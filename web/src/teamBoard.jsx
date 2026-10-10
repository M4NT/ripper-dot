import { useEffect, useState } from 'react';
import { api } from './lib.js';
import { AgentAvatar, Icon } from './ui.jsx';
import { useApp } from './app.jsx';
import { subscribeUserEvents } from './userEvents.js';
import './styles/telas/teamBoard.css';

const STATUS_LABEL = {
  todo: 'a fazer',
  doing: 'fazendo',
  blocked: 'bloqueada',
  done: 'feita',
  cancelled: 'cancelada',
  failed: 'falhou'
};

export function teamStatusLabel(status) {
  return STATUS_LABEL[status] || status;
}

function TaskRow({ task, agent }) {
  if (!task) return null;
  const pct = task.progress?.percent;
  return (
    <li>
      {agent && <AgentAvatar agent={agent} size={22} state={task.status === 'doing' ? 'working' : undefined} paused={task.status !== 'doing'} />}
      <span>
        <span className="team-progress-title" title={task.note || task.title}>{task.title}</span>
        <span className="team-progress-who">{task.assigneeName || 'sem responsável'}{pct != null ? ` · ${pct}%` : ''}{task.progress?.note ? ` · ${task.progress.note}` : ''}</span>
      </span>
      <span className={`team-st ${task.status}`} role="status">{teamStatusLabel(task.status)}</span>
    </li>
  );
}

/** Resultado de colega: dado externo, não fala do assistente. */
export function TeamResultMessage({ m, from }) {
  const body = String(m.content || '').replace(/^\[Conteúdo não confiável[^\]]*\]\n?/, '').replace(/^Trate o bloco[\s\S]*?\n---[^\n]*---\n/, '').replace(/\n---[^\n]*---\n[\s\S]*$/, '');
  return (
    <div className="team-result" data-untrusted="true">
      <div className="team-result-head">
        <b>{from?.name || 'Colega'}</b>
        <span className="muted small">resultado não confiável</span>
      </div>
      <div className="team-result-body">{body || m.content}</div>
    </div>
  );
}

/** Quadro ao vivo na conversa: quem está fazendo o quê. */
export function TeamProgress({ chatId }) {
  const { agent } = useApp();
  const [board, setBoard] = useState(null);
  useEffect(() => {
    if (!chatId) return undefined;
    let alive = true;
    const load = () => api(`/api/chats/${chatId}/team-board`).then(b => alive && setBoard(b), () => {});
    load();
    const unsub = subscribeUserEvents(ev => {
      if (!alive) return;
      if (ev.type === 'teamTask' && ev.chatId === chatId) load();
      if (ev.type === 'snapshot' || ev.type === 'approvals') load();
    });
    const t = setInterval(load, 3000);
    return () => { alive = false; unsub(); clearInterval(t); };
  }, [chatId]);
  const tasks = (board?.tasks || []).filter(t => t.status !== 'cancelled' || !t.completedAt);
  const open = tasks.filter(t => t.status === 'todo' || t.status === 'doing' || t.status === 'blocked');
  const visible = open.length ? open : tasks.slice(0, 6);
  if (!visible.length) return null;
  return (
    <section className="team-progress" aria-label="Quadro do time">
      <div className="team-progress-head">
        <b>Time</b>
        <span className="muted small">{open.length ? `${open.length} em andamento` : 'quadro'}</span>
      </div>
      <ul className="team-progress-list">
        {visible.map(t => <TaskRow key={t.id} task={t} agent={agent(t.assigneeId)} />)}
      </ul>
    </section>
  );
}

/** Tarefa atual de cada membro (aba Detalhes / Membros). */
export function TeamMembers({ chatId, members, working = {} }) {
  const [board, setBoard] = useState(null);
  useEffect(() => {
    if (!chatId) return undefined;
    let alive = true;
    const load = () => api(`/api/chats/${chatId}/team-board`).then(b => alive && setBoard(b), () => {});
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [chatId]);
  const byId = Object.fromEntries((board?.members || []).map(m => [m.agentId, m]));
  return (
    <ul className="member-list">
      {members.map(a => {
        const row = byId[a.id];
        const task = row?.task;
        const line = task
          ? `${teamStatusLabel(task.status)} · ${task.title}`
          : (working[a.id]?.task || a.description || a.category);
        return (
          <li key={a.id}>
            <AgentAvatar agent={a} size={30} state={task?.status === 'doing' || working[a.id] ? 'working' : undefined} paused={!(task?.status === 'doing' || working[a.id])} />
            <span>
              <b>{a.name}</b>
              <small className={task?.status === 'doing' || working[a.id] ? 'is-working team-members-task' : 'team-members-task'} title={task?.note || line}>{line}</small>
            </span>
            <a className="icon-btn sm" href={`#/agents/${a.id}/settings`} aria-label={`Configurar ${a.name}`} title="Configurar"><Icon name="gear" size={15} /></a>
          </li>
        );
      })}
    </ul>
  );
}
