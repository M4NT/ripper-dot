import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app.jsx';
import { api, go, useRoute, fmtSize, fmtAgo } from '../lib.js';
import { AgentAvatar, Icon, Segmented, StatusDot, EmptyState, useConfirm, Select } from '../ui.jsx';
import { Basics, Behavior, Tools, Appearance, ModelPick } from '../agentForm.jsx';
import { uploadFile } from '../composer.jsx';

const TABS = [['general', 'Geral'], ['model', 'Modelo'], ['behavior', 'Comportamento'], ['tools', 'Ferramentas'], ['knowledge', 'Conhecimento'], ['look', 'Aparência'], ['routines', 'Rotinas'], ['advanced', 'Avançado']];
const pick = a => ({ name: a.name, description: a.description, category: a.category, status: a.status, instructions: a.instructions, tone: a.tone, model: a.model, effort: a.effort || 'auto', tools: a.tools, avatar: a.avatar });

function Knowledge({ agent }) {
  const { S, refresh, toast } = useApp();
  const [mem, setMem] = useState([]);
  const input = useRef(null);
  useEffect(() => { api(`/api/agents/${agent.id}/memories`).then(setMem); }, [agent.id]);
  const files = S.files.filter(f => f.agentId === agent.id);
  return <>
    <h3 className="sub">Arquivos</h3>
    {files.length === 0 ? <p className="muted">Nenhum arquivo. Os que você enviar ficam no computador do agente, em ./uploads.</p> :
      <ul className="rows">{files.map(f => (
        <li key={f.id} className="row-item"><span className="thumb file-ico"><Icon name="file" size={18} /></span>
          <a className="row-main" href={`/api/files/${f.id}`} target="_blank" rel="noreferrer"><b>{f.name}</b><small>{fmtSize(f.size)} · {fmtAgo(f.createdAt)}</small></a>
          <button type="button" className="icon-btn sm" aria-label={`Remover ${f.name}`} onClick={() => api(`/api/files/${f.id}`, { method: 'DELETE' }).then(refresh)}><Icon name="trash" size={16} /></button></li>
      ))}</ul>}
    <button type="button" className="btn" onClick={() => input.current.click()}><Icon name="plus" size={16} />Adicionar arquivos</button>
    <input ref={input} type="file" multiple hidden onChange={async e => { for (const f of e.target.files) { try { await uploadFile(agent.id, null, f); } catch (err) { toast(err.message, 'error'); } } e.target.value = ''; refresh(); }} />
    <h3 className="sub">Memórias</h3>
    {mem.length === 0 ? <p className="muted">Nada guardado ainda.</p> :
      <ul className="rows">{mem.map(m => (
        <li key={m.id} className="row-item"><div className="row-main"><b className="wrap">{m.text}</b><small>{fmtAgo(m.createdAt)}</small></div>
          <button type="button" className="icon-btn sm" aria-label="Esquecer" onClick={() => api(`/api/memories/${m.id}`, { method: 'DELETE' }).then(() => setMem(x => x.filter(y => y.id !== m.id)))}><Icon name="trash" size={16} /></button></li>
      ))}</ul>}
  </>;
}

function Routines({ agent }) {
  const { S, refresh, toast } = useApp();
  const [f, setF] = useState({ name: '', prompt: '', kind: 'daily', when: '08:00', weekday: '' });
  const list = S.routines.filter(r => r.agentId === agent.id);
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  async function add() {
    if (!f.prompt.trim()) return toast('Diga o que a rotina deve fazer.', 'error');
    await api('/api/routines', { method: 'POST', body: { agentId: agent.id, name: f.name || 'Rotina', prompt: f.prompt, ...(f.kind === 'every' ? { everyMinutes: +f.when || 60 } : { dailyAt: f.when, weekday: f.weekday === '' ? undefined : +f.weekday }) } });
    setF({ name: '', prompt: '', kind: 'daily', when: '08:00', weekday: '' }); refresh(); toast('Rotina criada');
  }
  return <>
    <p className="muted">Rotinas deixam {agent.name} agir sozinho num horário. Cada execução abre uma conversa nova.{agent.status === 'paused' && ' Com o agente pausado, elas não rodam.'}</p>
    {list.length > 0 && <ul className="rows">{list.map(r => (
      <li key={r.id} className="row-item"><span className="thumb file-ico"><Icon name="clock" size={18} /></span>
        <div className="row-main"><b>{r.name}</b><small>{r.everyMinutes ? `A cada ${r.everyMinutes} min` : `${r.weekday != null ? days[r.weekday] + ', ' : 'Todo dia, '}${r.dailyAt}`} · {r.prompt}</small>{r.lastRun > 0 && <small>Última execução: {fmtAgo(r.lastRun)} · {{ running: 'Em andamento', succeeded: 'Concluída', failed: 'Falhou' }[r.lastStatus] || 'Sem resultado'}{r.lastError ? ` · ${r.lastError}` : ''}</small>}</div>
        <button type="button" className="icon-btn sm" aria-label={`Remover ${r.name}`} onClick={() => api(`/api/routines/${r.id}`, { method: 'DELETE' }).then(refresh)}><Icon name="trash" size={16} /></button></li>
    ))}</ul>}
    <div className="card-form">
      <h3 className="sub">Nova rotina</h3>
      <label className="field">Nome<input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Resumo de IA" /></label>
      <label className="field">O que fazer<textarea rows={3} value={f.prompt} onChange={e => setF({ ...f, prompt: e.target.value })} placeholder="Pesquise as notícias de IA de hoje e me mande um resumo." /></label>
      <div className="row">
        <Select label="Frequência" value={f.kind} onChange={kind => setF({ ...f, kind, when: kind === 'every' ? '60' : '08:00' })}
          options={[{ value: 'daily', label: 'No horário' }, { value: 'every', label: 'A cada N minutos' }]} />
        {f.kind === 'daily' && <Select label="Dia" value={f.weekday} onChange={weekday => setF({ ...f, weekday })}
          options={[{ value: '', label: 'Todo dia' }, ...days.map((d, i) => ({ value: String(i), label: d }))]} />}
        <input className="input narrow-input" type={f.kind === 'daily' ? 'time' : 'number'} min={5} value={f.when} onChange={e => setF({ ...f, when: e.target.value })} aria-label={f.kind === 'daily' ? 'Horário' : 'Minutos'} />
      </div>
      <button type="button" className="btn btn-primary" onClick={add}><Icon name="plus" size={16} />Criar rotina</button>
    </div>
  </>;
}

export default function AgentConfig({ id }) {
  const { S, agent: get, updateAgent, refresh, toast } = useApp();
  const { query } = useRoute();
  const agent = get(id);
  const [tab, setTab] = useState(query.get('tab') || 'general');
  const [v, setV] = useState(() => agent && pick(agent));
  const [saving, setSaving] = useState(false);
  const [confirm, confirmNode] = useConfirm();
  const [computer, setComputer] = useState(null);
  useEffect(() => { if (tab === 'advanced' && agent) api(`/api/agents/${agent.id}/computer`).then(setComputer).catch(() => {}); }, [tab]);
  const dirty = agent && JSON.stringify(v) !== JSON.stringify(pick(agent));
  useEffect(() => {
    if (!dirty) return;
    const f = e => { e.preventDefault(); e.returnValue = ''; };
    addEventListener('beforeunload', f); return () => removeEventListener('beforeunload', f);
  }, [dirty]);
  if (!agent || !v) return <div className="page"><EmptyState title="Agente não encontrado" action={<a className="btn" href="#/agents">Ver agentes</a>} /></div>;
  const set = p => setV(x => ({ ...x, ...p }));

  async function save() {
    if (!v.name.trim()) return toast('O agente precisa de um nome.', 'error');
    setSaving(true);
    try { await updateAgent(agent.id, v); toast('Alterações salvas'); } catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  }
  async function remove() {
    if (!(await confirm({ title: `Excluir ${agent.name}?`, body: 'As conversas continuam na sua lista. Rotinas deste agente são apagadas.', action: 'Excluir agente', danger: true }))) return;
    try { await api(`/api/agents/${agent.id}`, { method: 'DELETE' }); await refresh(); go('/agents'); } catch (e) { toast(e.message, 'error'); }
  }

  return (
    <div className="page config">
      <header className="config-top">
        <nav className="crumbs" aria-label="Caminho"><a href="#/agents"><Icon name="arrowL" size={15} />Agentes</a><span>/</span><a href={`#/a/${agent.id}`}>{agent.name}</a><span>/</span><b>Configurações</b></nav>
        <div className="grow" />
        {dirty && <button className="btn" onClick={() => setV(pick(agent))}>Descartar</button>}
        <button className="btn btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Salvando…' : 'Salvar alterações'}</button>
      </header>
      <div className="config-hero">
        <AgentAvatar agent={{ ...agent, ...v }} size={80} interactive />
        <div><h1>{v.name || 'Sem nome'}</h1><StatusDot status={v.status} /><p className="lede">{v.description || 'Sem descrição.'}</p></div>
      </div>
      <Segmented label="Seções" value={tab} onChange={setTab} items={TABS} className="seg-scroll config-tabs" />
      <div className="config-body">
        {tab === 'general' && <>
          <Basics v={v} set={set} categories={S.categories} />
          <div className="field"><span>Status</span>
            <Select label="Status" value={v.status} onChange={status => set({ status })} options={[
              { value: 'online', label: 'Online', hint: 'Responde e roda rotinas', icon: <i className="dot dot-ok" /> },
              { value: 'paused', label: 'Pausado', hint: 'Responde, mas as rotinas não rodam', icon: <i className="dot" /> }]} />
          </div>
        </>}
        {tab === 'model' && <ModelPick v={v} set={set} />}
        {tab === 'behavior' && <Behavior v={v} set={set} />}
        {tab === 'tools' && <Tools v={v} set={set} />}
        {tab === 'look' && <Appearance v={v} set={set} />}
        {tab === 'knowledge' && <Knowledge agent={agent} />}
        {tab === 'routines' && <Routines agent={agent} />}
        {tab === 'advanced' && <>
          <dl className="facts">
            <dt>ID</dt><dd><code>{agent.id}</code></dd>
            <dt>Computador</dt><dd>{computer ? `${computer.kind === 'boat' ? 'VM boat.dev' : computer.kind === 'local' ? 'Pasta local' : 'Desligado'} · ${computer.status}` : '…'}</dd>
            {agent.vmId && <><dt>VM</dt><dd><code>{agent.vmId}</code></dd></>}
            <dt>Criado</dt><dd>{new Date(agent.createdAt).toLocaleString('pt-BR')}</dd>
          </dl>
          <div className="danger-zone">
            <div><b>Excluir agente</b><small>Apaga o agente e as rotinas dele. As conversas ficam.</small></div>
            <button className="btn btn-danger" disabled={S.agents.length < 2} onClick={remove}>Excluir</button>
          </div>
        </>}
      </div>
      {confirmNode}
    </div>
  );
}
