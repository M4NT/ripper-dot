import { useEffect, useRef, useState } from 'react';
import { api } from './lib.js';
import { AgentAvatar, Icon } from './ui.jsx';
import { useApp } from './app.jsx';

/** Linha discreta na sua conversa: "Mensagem de 🟠 Valt" — um clique abre a troca entre os agentes. */
export function ViaLabel({ m, onOpen }) {
  const { agent } = useApp();
  const from = agent(m.agentId);
  return (
    <button type="button" className="via-label" onClick={() => onOpen(m.via.threadChatId)} title="Ver a conversa entre os agentes">
      Mensagem de {from && <AgentAvatar agent={from} size={16} paused />}<b>{from?.name || 'colega'}</b>
    </button>
  );
}

/** Conversa entre os agentes, ao lado, sem sair da sua. */
export function AgentThread({ chatId, onClose, Text }) {
  const { agent, toast } = useApp();
  const [chat, setChat] = useState(null);
  const box = useRef(null);
  useEffect(() => {
    let alive = true;
    api(`/api/chats/${chatId}`).then(c => alive && setChat(c), e => toast(e.message, 'error'));
    return () => { alive = false; };
  }, [chatId]);
  useEffect(() => { box.current?.scrollTo(0, box.current.scrollHeight); }, [chat]);
  useEffect(() => {
    const f = e => e.key === 'Escape' && onClose();
    addEventListener('keydown', f); return () => removeEventListener('keydown', f);
  }, [onClose]);
  const ids = chat?.agentIds || [];
  const [a, b] = ids.map(agent);
  return (
    <aside className="agent-thread" role="dialog" aria-label="Conversa entre os agentes">
      <header className="agent-thread-head">
        <span className="agent-thread-who">
          {a && <><AgentAvatar agent={a} size={20} paused /><b>{a.name}</b></>}
          <Icon name="retry" size={13} />
          {b && <><AgentAvatar agent={b} size={20} paused /><b>{b.name}</b></>}
        </span>
      </header>
      <div className="agent-thread-msgs" ref={box}>
        {!chat && <p className="muted small">Carregando…</p>}
        {chat?.messages?.filter(m => m.content).map((m, i) => {
          const who = agent(m.role === 'user' ? (m.inbox?.from || ids.find(x => x !== chat.agentId)) : m.agentId);
          return (
            <div key={m.id || i} className="agent-thread-msg">
              <span className="agent-thread-name" style={who?.avatar?.color ? { color: who.avatar.color } : undefined}>{who?.name || 'Agente'}</span>
              <div className="agent-thread-row">
                {who && <AgentAvatar agent={who} size={24} paused />}
                <div className="bubble bot-bubble"><Text text={m.content.replace(/^\[Mensagem de [^\]]+\]\n/, '')} /></div>
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" className="btn agent-thread-close" onClick={onClose}>Fechar chat</button>
    </aside>
  );
}
