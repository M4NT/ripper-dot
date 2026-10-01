import { useEffect, useMemo, useState } from 'react';
import { api, go, fmtAgo } from './lib.js';
import { markdown } from './markdown.js';
import { Dialog, Icon, AgentAvatar } from './ui.jsx';
import { useOv } from './overlay.jsx';
import { useApp } from './app.jsx';

function download(name, text, type = 'text/markdown') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const slug = s => (s || 'arquivo').replace(/[^\w\-À-ú ]/g, '').trim().slice(0, 60) || 'arquivo';

/** Menu de botão direito de uma conversa: abrir, renomear, exportar, apagar (e extras da tela). */
export function useChatMenu() {
  const ov = useOv();
  const { S, agent, refresh, toast } = useApp();
  return (e, c, extra = []) => {
    const ids = c.agentIds || [c.agentId];
    ov.menu(e, [
      { label: 'Abrir', icon: 'chat', onSelect: () => go(`/c/${c.id}`) },
      { label: 'Renomear', icon: 'edit', onSelect: async () => {
        const t = await ov.ask({ title: 'Renomear conversa', value: c.title, action: 'Renomear' });
        if (t) { await api(`/api/chats/${c.id}`, { method: 'PUT', body: { title: t } }); refresh(); }
      } },
      { label: 'Exportar em Markdown', icon: 'download', onSelect: async () => {
        const full = await api(`/api/chats/${c.id}`);
        const md = `# ${full.title}\n\n` + full.messages.map(m => `**${m.role === 'user' ? (S.settings.name || 'Você') : agent(m.agentId || ids[0])?.name || 'Agente'}** · ${m.at ? new Date(m.at).toLocaleString('pt-BR') : ''}\n\n${m.content}`).join('\n\n---\n\n');
        download(`${slug(full.title)}.md`, md);
      } },
      { label: 'Exportar JSON', icon: 'download', onSelect: async () => {
        const payload = await api(`/api/chats/${c.id}/export`);
        download(`${slug(c.title)}.ripper-chat.json`, JSON.stringify(payload, null, 2), 'application/json');
      } },
      { label: 'Importar JSON…', icon: 'upload', onSelect: async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            const raw = JSON.parse(await file.text());
            const aid = c.agentId || ids[0];
            const out = await api('/api/chats/import', { method: 'POST', body: { ...raw, agentId: aid, projectId: c.projectId || null } });
            if (out.warnings?.length) toast(out.warnings.join(' '), 'warn');
            await refresh();
            go(`/c/${out.chat.id}`);
            toast('Conversa importada');
          } catch (err) { toast(err.message, 'error'); }
        };
        input.click();
      } },
      { label: 'Copiar link', icon: 'share', onSelect: () => { navigator.clipboard.writeText(`${location.origin}/#/c/${c.id}`); toast('Link copiado'); } },
      ...extra,
      { sep: true },
      { label: 'Apagar conversa', icon: 'trash', danger: true, onSelect: async () => {
        if (!(await ov.confirm({ title: `Apagar “${c.title}”?`, body: 'Não dá para desfazer.', action: 'Apagar', danger: true }))) return;
        await api(`/api/chats/${c.id}`, { method: 'DELETE' });
        if (location.hash.includes(c.id)) go('/chats');
        refresh(); toast('Conversa apagada');
      } }
    ], c.title);
  };
}

/* ---------- artefatos ---------- */
export const KIND_ICON = { documento: 'file', roteiro: 'edit', plano: 'bolt', post: 'chat', codigo: 'terminal', tabela: 'data', outro: 'file' };

function ArtifactViewer({ id, close }) {
  const { agent, refresh, toast } = useApp();
  const ov = useOv();
  const [art, setArt] = useState(null);
  const [edit, setEdit] = useState(null);
  useEffect(() => { api(`/api/artifacts/${id}`).then(setArt).catch(e => { toast(e.message, 'error'); close(); }); }, [id]);
  const html = useMemo(() => art ? markdown(art.content) : '', [art?.content]);
  if (!art) return null;
  const who = agent(art.agentId);
  async function saveEdit() {
    const a = await api(`/api/artifacts/${art.id}`, { method: 'PUT', body: { content: edit } });
    setArt(a); setEdit(null); refresh(); toast('Artefato atualizado');
  }
  return (
    <Dialog open onClose={close} className="artifact-dialog" label={art.title}>
      <header className="artifact-head">
        <span className="artifact-ico"><Icon name={KIND_ICON[art.kind] || 'file'} /></span>
        <div className="grow"><h2>{art.title}</h2><small>{art.kind} · versão {art.version} · {who ? <>por {who.name}</> : 'editado por você'} · {fmtAgo(art.updatedAt)}</small></div>
        {edit == null ? <>
          <button className="icon-btn" title="Copiar" aria-label="Copiar" onClick={() => { navigator.clipboard.writeText(art.content); toast('Copiado'); }}><Icon name="copy" /></button>
          <button className="icon-btn" title="Baixar .md" aria-label="Baixar" onClick={() => download(`${slug(art.title)}.md`, art.content)}><Icon name="download" /></button>
          <button className="icon-btn" title="Editar" aria-label="Editar" onClick={() => setEdit(art.content)}><Icon name="edit" /></button>
          <button className="icon-btn" title="Apagar" aria-label="Apagar" onClick={async () => {
            if (!(await ov.confirm({ title: `Apagar “${art.title}”?`, body: 'Os agentes deixam de ver este artefato.', action: 'Apagar', danger: true }))) return;
            await api(`/api/artifacts/${art.id}`, { method: 'DELETE' }); refresh(); close();
          }}><Icon name="trash" /></button>
        </> : <>
          <button className="btn btn-sm" onClick={() => setEdit(null)}>Cancelar</button>
          <button className="btn btn-sm btn-primary" onClick={saveEdit}>Salvar versão {art.version + 1}</button>
        </>}
        <button className="icon-btn" onClick={close} aria-label="Fechar"><Icon name="x" /></button>
      </header>
      <div className="artifact-body">
        {edit == null ? <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
          : <textarea className="artifact-editor" value={edit} onChange={e => setEdit(e.target.value)} autoFocus />}
      </div>
    </Dialog>
  );
}

export function useArtifacts() {
  const ov = useOv();
  return { open: id => ov.show(close => <ArtifactViewer id={id} close={close} />) };
}

/** Lista de artefatos (painel da conversa, projeto, biblioteca). */
export function ArtifactList({ items, empty }) {
  const { agent } = useApp();
  const { open } = useArtifacts();
  if (!items.length) return <p className="muted small">{empty}</p>;
  return (
    <ul className="artifact-list">
      {[...items].sort((a, b) => b.updatedAt - a.updatedAt).map(a => (
        <li key={a.id}>
          <button onClick={() => open(a.id)}>
            <span className="artifact-ico sm"><Icon name={KIND_ICON[a.kind] || 'file'} size={16} /></span>
            <span className="artifact-text"><b>{a.title}</b><small>{a.kind} · v{a.version} · {agent(a.agentId)?.name || 'você'} · {fmtAgo(a.updatedAt)}</small></span>
            {agent(a.agentId) && <AgentAvatar agent={agent(a.agentId)} size={20} paused />}
          </button>
        </li>
      ))}
    </ul>
  );
}
