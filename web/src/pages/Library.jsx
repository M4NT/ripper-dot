import { useEffect, useState } from 'react';
import { useApp } from '../app.jsx';
import { AgentAvatar, Icon, Segmented, EmptyState } from '../ui.jsx';
import { api, fmtSize, fmtAgo } from '../lib.js';

import FileThumb from '../fileThumb.jsx';
import { ArtifactList } from '../actions.jsx';
import { SkillList, ScriptPool } from '../skills.jsx';
const isImage = t => /^image\/(png|jpe?g|webp|gif)$/.test(t);

/** Memória em dois níveis: perfil (estável, sempre no contexto) e registro (datado, só o recente entra). */
function MemoryTiers({ memories, setMemories }) {
  const { agent, refresh, toast } = useApp();
  const [tier, setTier] = useState('profile');
  if (!memories) return <p className="muted pad">Carregando…</p>;
  const tierOf = m => m.tier || 'profile';
  const list = memories.filter(m => tierOf(m) === tier);
  const move = async m => {
    const to = tierOf(m) === 'profile' ? 'log' : 'profile';
    await api(`/api/memories/${m.id}`, { method: 'PUT', body: { tier: to } });
    setMemories(ms => ms.map(x => x.id === m.id ? { ...x, tier: to } : x));
    toast(to === 'profile' ? 'Movida para o perfil' : 'Movida para o registro');
  };
  return <>
    <div className="mem-head">
      <Segmented label="Nível da memória" value={tier} onChange={setTier} size="sm" items={[['profile', 'Perfil', memories.filter(m => tierOf(m) === 'profile').length], ['log', 'Registro', memories.filter(m => m.tier === 'log').length]]} />
      <p className="muted small">{tier === 'profile' ? 'Fatos estáveis sobre você. Entram em toda conversa.' : 'Anotações datadas do que aconteceu. Só as mais recentes entram no contexto (ajuste em Configurações → Memória).'}</p>
    </div>
    {list.length === 0 ? <EmptyState title={tier === 'profile' ? 'Nenhum fato no perfil' : 'Nenhum registro'} body="Diga “lembre que…” numa conversa com um agente que tenha memória ligada." /> :
      <ul className="rows">{list.map(m => (
        <li key={m.id} className="row-item">
          <AgentAvatar agent={agent(m.agentId)} size={28} paused />
          <div className="row-main"><b className="wrap">{m.text}</b><small>{agent(m.agentId)?.name} · {tier === 'log' ? new Date(m.createdAt).toLocaleDateString('pt-BR') : fmtAgo(m.createdAt)}</small></div>
          <button className="btn btn-sm" onClick={() => move(m)} title={tier === 'profile' ? 'Virar anotação datada' : 'Tornar fato estável'}>{tier === 'profile' ? 'Mover p/ registro' : 'Mover p/ perfil'}</button>
          <button className="icon-btn sm" aria-label="Esquecer" onClick={() => api(`/api/memories/${m.id}`, { method: 'DELETE' }).then(() => { setMemories(ms => ms.filter(x => x.id !== m.id)); refresh(); toast('Memória esquecida'); })}><Icon name="trash" size={16} /></button>
        </li>
      ))}</ul>}
  </>;
}

const STATUS = { queued: 'Na fila', delivering: 'Entregando', delivered: 'Respondida', failed: 'Falhou' };
const PRIO = { now: 'urgente', normal: 'normal', low: 'sem pressa' };
function MessageLog() {
  const { agent } = useApp();
  const [list, setList] = useState(null);
  useEffect(() => { const load = () => api('/api/messages').then(setList).catch(() => setList([])); load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);
  if (!list) return <p className="muted pad">Carregando…</p>;
  if (!list.length) return <EmptyState title="Nenhuma mensagem entre agentes" body="Quando um agente pedir algo a um colega (send_message), a troca aparece aqui." />;
  return (
    <ul className="rows">{list.map(m => (
      <li key={m.id} className="row-item msg-log">
        <span className="msg-pair"><AgentAvatar agent={agent(m.from)} size={24} paused /><Icon name="arrowR" size={13} /><AgentAvatar agent={agent(m.to)} size={24} paused /></span>
        <div className="row-main"><b>{m.fromName} → {m.toName}</b><small>{m.body}</small></div>
        <span className={`tag msg-st ${m.status}`}>{STATUS[m.status] || m.status} · {PRIO[m.priority]}</span>
        <small className="muted">{fmtAgo(m.createdAt)}</small>
        {m.threadChatId && <a className="icon-btn sm" href={`#/c/${m.threadChatId}`} aria-label="Abrir a troca"><Icon name="chat" size={15} /></a>}
      </li>
    ))}</ul>
  );
}

export default function Library() {
  const { S, agent, refresh, toast } = useApp();
  const [tab, setTab] = useState('artifacts');
  const [memories, setMemories] = useState(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null); // resultados da busca (null = sem busca)
  useEffect(() => {
    if (q.trim().length < 2) { setFound(null); return; }
    const t = setTimeout(() => api(`/api/library/search?q=${encodeURIComponent(q.trim())}`).then(r => setFound(r.results), () => setFound([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (tab !== 'memories') return;
    Promise.all(S.agents.map(a => api(`/api/agents/${a.id}/memories`))).then(r => setMemories(r.flat().sort((a, b) => b.createdAt - a.createdAt)));
  }, [tab, S.agents]);
  const files = [...S.files].sort((a, b) => b.createdAt - a.createdAt);
  const routines = S.routines;
  const when = r => r.everyMinutes ? `A cada ${r.everyMinutes} min` : `${r.weekday != null ? ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][r.weekday] + ', ' : 'Todo dia, '}${r.dailyAt}`;

  return (
    <div className="page narrow v2">
      <header className="page-head"><div><h1>Biblioteca</h1><p className="lede">Tudo o que seus agentes guardam e compartilham: artefatos, skills, arquivos, memórias e rotinas.</p></div></header>
      <label className="search-field lib-search"><Icon name="search" size={16} /><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar dentro de artefatos, arquivos, memórias e skills" aria-label="Buscar na biblioteca" /></label>
      {found ? <LibraryResults results={found} q={q} /> : <>
      {/* abas vazias (0) somem, como na Caixa; as sem contagem (scripts, mensagens) e a selecionada ficam */}
      <Segmented label="Seção" value={tab} onChange={setTab} items={[['artifacts', 'Artefatos', S.artifacts.length], ['skills', 'Skills', S.skills.length], ['scripts', 'Scripts'], ['messages', 'Mensagens'], ['files', 'Arquivos', files.length], ['memories', 'Memórias', S.memoriesCount], ['routines', 'Rotinas', routines.length]].filter(([k, , n]) => k === tab || n == null || n > 0)} className="seg-scroll" />
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
        {tab === 'memories' && <MemoryTiers memories={memories} setMemories={setMemories} />}
        {tab === 'artifacts' && <ArtifactList items={S.artifacts} empty="Nenhum artefato ainda. Numa conversa, peça: “salve isso como artefato”." />}
        {tab === 'skills' && <SkillList />}
        {tab === 'scripts' && <ScriptPool />}
        {tab === 'messages' && <MessageLog />}
        {tab === 'routines' && (routines.length === 0 ? <EmptyState title="Nenhuma rotina" body="Crie nas configurações de um agente ou peça no chat: “todo dia às 9, me mande…”." /> :
          <ul className="rows">{routines.map(r => (
            <li key={r.id} className="row-item">
              <AgentAvatar agent={agent(r.agentId)} size={28} />
              <div className="row-main"><b>{r.name}</b><small>{when(r)} · {agent(r.agentId)?.name}{agent(r.agentId)?.status === 'paused' ? ' · pausado' : ''}</small></div>
              <a className="btn btn-sm" href={`#/agents/${r.agentId}/settings?tab=routines`}>Editar</a>
            </li>
          ))}</ul>)}
      </div>
      </>}
    </div>
  );
}

const KIND = { artifact: ['Artefato', 'book'], file: ['Arquivo', 'file'], memory: ['Memória', 'brain'], skill: ['Skill', 'bulb'] };
function LibraryResults({ results, q }) {
  if (!results.length) return <EmptyState title="Nada encontrado" body={`Nada com “${q.trim()}” em artefatos, arquivos de texto, memórias ou skills.`} />;
  return (
    <ul className="rows lib-results" aria-label="Resultados da busca">{results.map(r => (
      <li key={`${r.kind}-${r.id}`} className="row-item">
        <span className="thumb file-ico"><Icon name={KIND[r.kind]?.[1] || 'file'} size={18} /></span>
        <a className="row-main" href={r.href} {...(r.href.startsWith('/api/') ? { target: '_blank', rel: 'noreferrer' } : {})}>
          <b>{r.title}</b>
          <small>{KIND[r.kind]?.[0]}{r.at ? ` · ${fmtAgo(r.at)}` : ''}</small>
          {r.snippet && <span className="lib-snippet">{r.snippet}</span>}
        </a>
      </li>
    ))}</ul>
  );
}
