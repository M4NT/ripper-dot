import { fmtAgo, nameColor } from './lib.js';
import { Icon } from './ui.jsx';
import { useApp } from './app.jsx';
import { useChatMenu } from './actions.jsx';
import ChatAvatar, { isGroupChat } from './chatAvatar.jsx';
import { botAvatarPalette } from 'bot-avatars';

const color = a => nameColor(a, botAvatarPalette);

/** Linha de conversa (projeto e lista de conversas). Botão direito ou "…" abre as ações. */
export default function ChatRow({ c, showProject }) {
  const { S, agent, busyChats } = useApp();
  const chatMenu = useChatMenu();
  const members = (c.agentIds || [c.agentId]).map(agent).filter(Boolean);
  const group = isGroupChat(c);
  const project = showProject && c.projectId && S.projects.find(p => p.id === c.projectId);
  const working = !!busyChats[c.id];
  return (
    <li className={`crow ${group ? 'is-group' : ''} ${c.unread ? 'unread' : ''}`} onContextMenu={e => chatMenu(e, c)}>
      <a href={`#/c/${c.id}`} className="crow-link">
        <ChatAvatar chat={c} size={36} />
        <span className="crow-main">
          <span className="crow-top">
            <b>{c.title}</b>
            {c.unread && <span className="unread-dot" title="Novidade" />}
            {group && <span className="group-pill" title="Grupo" aria-label="Grupo"><Icon name="group" size={12} /></span>}
            {project && <span className="proj-pill"><Icon name="folder" size={11} />{project.name}</span>}
            {(c.tags || []).map(t => <span key={t} className="tag-pill">#{t}</span>)}
          </span>
          <span className="crow-who">
            {members.map((a, i) => <span key={a.id} style={{ color: color(a) }}>{a.name}{i < members.length - 1 ? ' · ' : ''}</span>)}
            {working && <em className="crow-live">respondendo…</em>}
          </span>
          <span className="crow-preview">{c.preview || 'Sem mensagens ainda.'}</span>
        </span>
        <span className="crow-side">
          <time>{fmtAgo(c.updatedAt || c.createdAt)}</time>
          {c.count > 0 && <span className="crow-count">{c.count}</span>}
        </span>
      </a>
      <button className="icon-btn sm crow-more" aria-label={`Ações de ${c.title}`} onClick={e => { const r = e.currentTarget.getBoundingClientRect(); chatMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.left, clientY: r.bottom + 4 }, c); }}>
        <Icon name="more" size={16} />
      </button>
    </li>
  );
}
