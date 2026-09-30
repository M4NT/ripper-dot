import { useEffect, useState } from 'react';
import { useApp } from '../app.jsx';
import { AgentAvatar, Icon, Segmented, EmptyState } from '../ui.jsx';
import { api, fmtSize, fmtAgo } from '../lib.js';

import FileThumb from '../fileThumb.jsx';
const isImage = t => /^image\/(png|jpe?g|webp|gif)$/.test(t);

export default function Library() {
  const { S, agent, refresh, toast } = useApp();
  const [tab, setTab] = useState('files');
  const [memories, setMemories] = useState(null);
  useEffect(() => {
    if (tab !== 'memories') return;
    Promise.all(S.agents.map(a => api(`/api/agents/${a.id}/memories`))).then(r => setMemories(r.flat().sort((a, b) => b.createdAt - a.createdAt)));
  }, [tab, S.agents]);
  const files = [...S.files].sort((a, b) => b.createdAt - a.createdAt);
  const routines = S.routines;
  const when = r => r.everyMinutes ? `A cada ${r.everyMinutes} min` : `${r.weekday != null ? ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][r.weekday] + ', ' : 'Todo dia, '}${r.dailyAt}`;

  return (
    <div className="page narrow">
      <header className="page-head"><div><h1>Biblioteca</h1><p className="lede">Tudo o que seus agentes guardam: arquivos, memórias e rotinas.</p></div></header>
      <Segmented label="Seção" value={tab} onChange={setTab} items={[['files', 'Arquivos', files.length], ['memories', 'Memórias', S.memoriesCount], ['routines', 'Rotinas', routines.length]]} />
      <div className="library">
        {tab === 'files' && (files.length === 0 ? <EmptyState title="Nenhum arquivo" body="Anexe arquivos numa conversa: eles aparecem aqui e ficam no computador do agente." /> :
          <ul className="rows">{files.map(f => (
            <li key={f.id} className="row-item">
              {isImage(f.type) ? <FileThumb src={`/api/files/${f.id}`} /> : <span className="thumb file-ico"><Icon name="file" size={18} /></span>}
              <a className="row-main" href={`/api/files/${f.id}`} target="_blank" rel="noreferrer"><b>{f.name}</b><small>{fmtSize(f.size)} · {agent(f.agentId)?.name || 'Agente excluído'} · {fmtAgo(f.createdAt)}</small></a>
              {f.chatId && <a className="icon-btn sm" href={`#/c/${f.chatId}`} aria-label="Abrir conversa"><Icon name="chat" size={16} /></a>}
              <button className="icon-btn sm" aria-label={`Remover ${f.name}`} onClick={() => api(`/api/files/${f.id}`, { method: 'DELETE' }).then(() => { refresh(); toast('Arquivo removido'); })}><Icon name="trash" size={16} /></button>
            </li>
          ))}</ul>)}
        {tab === 'memories' && (!memories ? <p className="muted pad">Carregando…</p> : memories.length === 0 ? <EmptyState title="Nenhuma memória" body="Diga “lembre que…” numa conversa com um agente que tenha memória ligada." /> :
          <ul className="rows">{memories.map(m => (
            <li key={m.id} className="row-item">
              <AgentAvatar agent={agent(m.agentId)} size={28} />
              <div className="row-main"><b className="wrap">{m.text}</b><small>{agent(m.agentId)?.name} · {fmtAgo(m.createdAt)}</small></div>
              <button className="icon-btn sm" aria-label="Esquecer" onClick={() => api(`/api/memories/${m.id}`, { method: 'DELETE' }).then(() => { setMemories(ms => ms.filter(x => x.id !== m.id)); refresh(); toast('Memória esquecida'); })}><Icon name="trash" size={16} /></button>
            </li>
          ))}</ul>)}
        {tab === 'routines' && (routines.length === 0 ? <EmptyState title="Nenhuma rotina" body="Crie nas configurações de um agente ou peça no chat: “todo dia às 9, me mande…”." /> :
          <ul className="rows">{routines.map(r => (
            <li key={r.id} className="row-item">
              <AgentAvatar agent={agent(r.agentId)} size={28} />
              <div className="row-main"><b>{r.name}</b><small>{when(r)} · {agent(r.agentId)?.name}{agent(r.agentId)?.status === 'paused' ? ' · pausado' : ''}</small></div>
              <a className="btn btn-sm" href={`#/agents/${r.agentId}/settings?tab=routines`}>Editar</a>
            </li>
          ))}</ul>)}
      </div>
    </div>
  );
}
