import { useRef } from 'react';
import { api, fmtAgo, nameColor } from './lib.js';
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
  const { refresh, toast } = useApp();
  const gesto = useRef({ x: 0, y: 0, dx: 0, ativo: false, moveu: false });
  const arquiva = async () => {
    try {
      const r = await api('/api/chats/bulk', { method: 'POST', body: { ids: [c.id], action: 'archive' } });
      if (r.skipped) { toast('Esta conversa está respondendo agora; não arquivei.', 'error'); return; }
      await refresh();
      toast('Conversa arquivada', 'info', { label: 'Desfazer', run: async () => {
        await api('/api/chats/bulk', { method: 'POST', body: { ids: [c.id], action: 'unarchive' } });
        await refresh();
        toast('Conversa de volta às ativas');
      } });
    } catch (e) { toast(e.message, 'error'); }
  };
  // Deslize para a esquerda: passou de 96 px solta e arquiva. Mouse não desliza (é clique normal).
  const fimGesto = e => {
    const g = gesto.current; g.ativo = false;
    const el = e.currentTarget; el.style.transform = ''; el.style.transition = '';
    if (g.dx < -96) arquiva();
    g.dx = 0;
    if (g.moveu) setTimeout(() => { g.moveu = false; }, 300); // o clique que vem depois do gesto é ignorado
  };
  return (
    <li className={`crow ${group ? 'is-group' : ''} ${c.unread ? 'unread' : ''}`} onContextMenu={e => chatMenu(e, c)}
      onPointerDown={e => { if (e.pointerType === 'mouse') return; gesto.current = { x: e.clientX, y: e.clientY, dx: 0, ativo: true, moveu: false }; }}
      onPointerMove={e => {
        const g = gesto.current; if (!g.ativo) return;
        const dx = e.clientX - g.x, dy = e.clientY - g.y;
        if (!g.moveu && Math.abs(dy) > Math.abs(dx)) { g.ativo = false; return; } // rolagem vertical
        if (Math.abs(dx) > 8) g.moveu = true;
        if (!g.moveu) return;
        e.currentTarget.style.transition = 'none'; // acompanha o dedo sem atraso
        g.dx = Math.min(0, dx);
        e.currentTarget.style.transform = `translateX(${Math.max(-120, g.dx)}px)`;
      }}
      onPointerUp={fimGesto} onPointerCancel={fimGesto}
      onClickCapture={e => { if (gesto.current.moveu) { e.preventDefault(); e.stopPropagation(); gesto.current.moveu = false; } }}>
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
