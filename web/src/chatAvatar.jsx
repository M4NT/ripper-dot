import { AgentAvatar, Icon } from './ui.jsx';
import { useApp } from './app.jsx';

/**
 * Identidade visual de uma conversa: um avatar (individual) ou um "trevo" de avatares
 * com selo de grupo. Usado na lateral, na lista de conversas e nos projetos.
 */
export default function ChatAvatar({ chat, size = 28 }) {
  const { agent, busyChats } = useApp();
  const ids = chat.agentIds || [chat.agentId];
  const members = ids.map(agent).filter(Boolean);
  const working = !!busyChats[chat.id];
  if (members.length <= 1) {
    const a = members[0];
    return <span className="chat-av" style={{ width: size, height: size }}>{a ? <AgentAvatar agent={a} size={size} state={working ? 'working' : undefined} /> : <Icon name="chat" size={16} />}</span>;
  }
  const small = Math.round(size * 0.72);
  return (
    <span className={`chat-av group ${working ? 'working' : ''}`} style={{ width: size + 6, height: size }} title={`Grupo: ${members.map(a => a.name).join(', ')}`}>
      <span className="chat-av-a"><AgentAvatar agent={members[0]} size={small} state={working ? 'working' : undefined} /></span>
      <span className="chat-av-b"><AgentAvatar agent={members[1]} size={small} state={working ? 'working' : undefined} /></span>
      <span className="chat-av-badge" aria-hidden="true">{members.length}</span>
    </span>
  );
}

export const isGroupChat = c => (c.agentIds || []).length > 1;
