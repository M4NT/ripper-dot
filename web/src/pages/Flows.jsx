import { useEffect, useState } from 'react';
import { api, go, fmtAgo } from '../lib.js';
import { useApp } from '../app.jsx';
import { AgentAvatar, Icon, Select, Switch, EmptyState, useConfirm } from '../ui.jsx';

const blankStep = agentId => ({ agentId, instruction: '', approve: false });

/**
 * Fluxos: agentes em sequência, cada um trabalhando em cima do anterior.
 * O editor é a própria cadeia: cartões ligados por setas, da esquerda para a direita.
 */
export default function Flows() {
  const { S, toast } = useApp();
  const [confirm, confirmNode] = useConfirm();
  const [flows, setFlows] = useState(null);
  const [edit, setEdit] = useState(null); // { id?, name, steps } em edição
  const [running, setRunning] = useState(null); // { flow, input }
  const load = () => api('/api/flows').then(r => setFlows(r.flows)).catch(() => setFlows([]));
  useEffect(() => { load(); }, []);
  const agents = S.agents.filter(a => a.status !== 'paused');
  const agentOf = id => S.agents.find(a => a.id === id);

  async function save() {
    try {
      await api(edit.id ? `/api/flows/${edit.id}` : '/api/flows', { method: edit.id ? 'PUT' : 'POST', body: edit });
      toast(edit.id ? 'Fluxo salvo' : 'Fluxo criado'); setEdit(null); load();
    } catch (e) { toast(e.message, 'error'); }
  }
  async function run() {
    try {
      const { chatId } = await api(`/api/flows/${running.flow.id}/run`, { method: 'POST', body: { input: running.input } });
      setRunning(null); go(`/c/${chatId}`);
    } catch (e) { toast(e.message, 'error'); }
  }
  async function remove(f) {
    if (!(await confirm({ title: `Apagar “${f.name}”?`, body: 'As conversas que ele já rodou continuam.', danger: true, action: 'Apagar' }))) return;
    await api(`/api/flows/${f.id}`, { method: 'DELETE' }); load();
  }

  if (edit) return <FlowEditor edit={edit} setEdit={setEdit} agents={agents} agentOf={agentOf} onSave={save} />;
  return (
    <div className="page">
      {confirmNode}
      <header className="page-head">
        <div><h1>Fluxos</h1><p className="lede">Agentes em sequência: um pesquisa, o outro escreve, o próximo publica. Cada um trabalha em cima do anterior, e você aprova onde quiser.</p></div>
        <button type="button" className="btn btn-primary" disabled={!agents.length} onClick={() => setEdit({ name: '', steps: [blankStep(agents[0]?.id)] })}><Icon name="plus" size={16} />Novo fluxo</button>
      </header>
      {flows === null ? <p className="muted">Carregando…</p>
        : !flows.length ? <EmptyState title="Nenhum fluxo ainda" body="Monte uma sequência de agentes para um trabalho que se repete: pesquisa → texto → revisão, por exemplo." action={agents.length > 1 && <button type="button" className="btn btn-primary" onClick={() => setEdit({ name: '', steps: [blankStep(agents[0].id), blankStep(agents[1].id)] })}><Icon name="plus" size={16} />Criar o primeiro</button>} />
        : <ul className="flow-list">{flows.map(f => (
          <li key={f.id} className="flow-card">
            <div className="flow-card-head">
              <div><b>{f.name}</b><small>{f.steps.length} {f.steps.length === 1 ? 'passo' : 'passos'} · editado {fmtAgo(f.updatedAt)}</small></div>
              <div className="row">
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setRunning({ flow: f, input: '' })}><Icon name="play" size={14} />Rodar</button>
                <button type="button" className="icon-btn sm" aria-label={`Editar ${f.name}`} onClick={() => setEdit(structuredClone(f))}><Icon name="edit" size={16} /></button>
                <button type="button" className="icon-btn sm" aria-label={`Apagar ${f.name}`} onClick={() => remove(f)}><Icon name="trash" size={16} /></button>
              </div>
            </div>
            <ol className="flow-chain" aria-label="Passos">
              {f.steps.map((st, i) => {
                const a = agentOf(st.agentId);
                return (
                  <li key={i}>
                    {i > 0 && <Icon name="arrowR" size={14} className="flow-chain-arrow" />}
                    <span className="flow-chip" title={st.instruction}>{a ? <AgentAvatar agent={a} size={22} /> : <Icon name="x" size={14} />}<span>{a?.name || 'agente apagado'}</span>{st.approve && <Icon name="check" size={13} className="flow-chip-gate" aria-label="pede aprovação" />}</span>
                  </li>
                );
              })}
            </ol>
            {running?.flow.id === f.id && (
              <div className="flow-run">
                <textarea className="input" rows={2} autoFocus value={running.input} onChange={e => setRunning({ ...running, input: e.target.value })} placeholder="O que o fluxo deve fazer desta vez? (ex.: o tema do post)" aria-label="Pedido para o fluxo" />
                <div className="row"><button type="button" className="btn btn-primary" onClick={run}><Icon name="play" size={14} />Começar</button><button type="button" className="btn" onClick={() => setRunning(null)}>Cancelar</button></div>
              </div>
            )}
          </li>
        ))}</ul>}
    </div>
  );
}

function FlowEditor({ edit, setEdit, agents, agentOf, onSave }) {
  const setStep = (i, patch) => setEdit({ ...edit, steps: edit.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i, d) => { const steps = [...edit.steps]; [steps[i], steps[i + d]] = [steps[i + d], steps[i]]; setEdit({ ...edit, steps }); };
  const options = agents.map(a => ({ value: a.id, label: a.name, hint: a.description, icon: <AgentAvatar agent={a} size={18} /> }));
  return (
    <div className="page">
      <header className="page-head">
        <div><a className="link back" href="#/flows" onClick={e => { e.preventDefault(); setEdit(null); }}><Icon name="arrowL" size={14} />Fluxos</a>
          <input className="input flow-name" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="Nome do fluxo (ex.: Post do blog)" aria-label="Nome do fluxo" autoFocus={!edit.id} /></div>
        <div className="row"><button type="button" className="btn" onClick={() => setEdit(null)}>Cancelar</button><button type="button" className="btn btn-primary" onClick={onSave}><Icon name="check" size={16} />Salvar</button></div>
      </header>
      <ol className="flow-canvas" aria-label="Passos do fluxo">
        {edit.steps.map((st, i) => (
            <li key={i} className="flow-node">
              {i > 0 && <span className={`flow-link ${edit.steps[i - 1].approve ? 'gated' : ''}`} aria-hidden="true">{edit.steps[i - 1].approve && <span className="flow-gate"><Icon name="check" size={12} />você aprova</span>}<Icon name="arrowR" size={16} /></span>}
              <div className="flow-step">
                <div className="flow-step-head">
                  <span className="flow-num">{i + 1}</span>
                  <Select label={`Agente do passo ${i + 1}`} value={st.agentId} onChange={v => setStep(i, { agentId: v })} options={options} size="sm" />
                </div>
                <textarea className="input" rows={4} value={st.instruction} onChange={e => setStep(i, { instruction: e.target.value })} placeholder={i === 0 ? 'Ex.: Pesquise as 5 notícias mais importantes sobre o tema, com fontes.' : 'Ex.: Com a pesquisa acima, escreva um post de 300 palavras.'} aria-label={`O que o passo ${i + 1} faz`} />
                {i < edit.steps.length - 1 && <label className="switch-row compact"><span>Pedir minha aprovação antes de seguir</span><Switch checked={st.approve} onChange={v => setStep(i, { approve: v })} label="Pedir aprovação" /></label>}
                <div className="flow-step-tools">
                  <button type="button" className="icon-btn sm" disabled={i === 0} aria-label="Mover para a esquerda" onClick={() => move(i, -1)}><Icon name="arrowL" size={15} /></button>
                  <button type="button" className="icon-btn sm" disabled={i === edit.steps.length - 1} aria-label="Mover para a direita" onClick={() => move(i, 1)}><Icon name="arrowR" size={15} /></button>
                  <button type="button" className="icon-btn sm" disabled={edit.steps.length === 1} aria-label={`Remover passo ${i + 1}`} onClick={() => setEdit({ ...edit, steps: edit.steps.filter((_, j) => j !== i) })}><Icon name="trash" size={15} /></button>
                </div>
              </div>
            </li>
        ))}
        {edit.steps.length < 10 && (
          <li className="flow-node">
            <span className="flow-link" aria-hidden="true"><Icon name="arrowR" size={16} /></span>
            <button type="button" className="flow-add" onClick={() => setEdit({ ...edit, steps: [...edit.steps, blankStep(agents.find(a => a.id !== edit.steps.at(-1)?.agentId)?.id || agents[0]?.id)] })}><Icon name="plus" size={20} /><span>Passo</span></button>
          </li>
        )}
      </ol>
      <p className="muted small">Cada agente vê o pedido e o que os anteriores fizeram. Rodando, tudo aparece numa conversa; nos passos com aprovação, o fluxo pausa e pede o seu OK na Caixa.</p>
    </div>
  );
}
