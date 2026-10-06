import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app.jsx';
import { api, go, useRoute, fmtSize, fmtAgo, fmtTime, stepLabel } from '../lib.js';
import { AgentAvatar, Icon, Segmented, StatusDot, EmptyState, useConfirm, Select, Switch } from '../ui.jsx';
import { Basics, Behavior, Tools, Appearance, ModelPick, VoiceStyle, agentStyleDraft } from '../agentForm.jsx';
import { AutonomySemaphore } from '../autonomy.jsx';
import { uploadFile } from '../composer.jsx';
import { isEnterpriseMode } from '../uiMode.js';
import { useOv } from '../overlay.jsx';
import { RoutineList, RoutineForm } from '../routines.jsx';

// Abas pelo jeito que o dono pensa: quem ele é, o que sabe fazer, quanto decide sozinho, quando age sozinho, o que já fez.
const TABS = [['identity', 'Identidade'], ['skills', 'Habilidades'], ['autonomy', 'Autonomia'], ['routines', 'Rotinas'], ['activity', 'Atividade']];
// links antigos (?tab=model etc.) continuam abrindo a aba certa
const OLD_TAB = { general: 'identity', look: 'identity', voice: 'identity', advanced: 'identity', tools: 'skills', knowledge: 'skills', model: 'autonomy', behavior: 'autonomy' };

/** Onde o agente atende. O WhatsApp é um número só; aqui você escolhe se É ESTE agente que atende. */
function Channels({ agent }) {
  const { S, refresh, toast } = useApp();
  const ov = useOv();
  const w = S.settings.whatsappWeb || {};
  const enterprise = isEnterpriseMode(S.settings);
  const mine = w.agentId === agent.id && w.enabled;
  const other = w.enabled && w.agentId && w.agentId !== agent.id ? S.agents.find(a => a.id === w.agentId) : null;
  async function toggle(on) {
    if (on && other && !(await ov.confirm({ title: `Passar o WhatsApp para ${agent.name}?`, body: `Hoje quem atende é ${other.name}. Só um agente atende o número por vez.`, action: 'Passar' }))) return;
    try {
      await api('/api/settings', { method: 'PUT', body: { whatsappWeb: on ? { agentId: agent.id, enabled: true } : { enabled: false } } });
      await refresh();
      toast(on ? `${agent.name} agora atende o WhatsApp` : 'WhatsApp desligado');
    } catch (e) { toast(e.message, 'error'); }
  }
  return <>
    <h3 className="sub">Onde atende</h3>
    <ul className="toggle-list">
      <li><label><span className="toggle-ico"><Icon name="chat" /></span><span className="toggle-text"><b>Chat do Ripper</b><small>Você conversa com {agent.name} aqui.</small></span><span className="tag">sempre</span></label></li>
      <li><label><span className="toggle-ico"><Icon name="inbox" /></span>
        <span className="toggle-text"><b>WhatsApp</b>
          <small>{!enterprise ? 'Disponível no modo Enterprise (Configurações → Aparência).'
            : mine ? `${agent.name} responde os contatos liberados e deixa recados na Caixa.`
            : other ? `Hoje quem atende é ${other.name}.`
            : 'Ninguém atende o WhatsApp agora.'}{enterprise && <> <a className="inline-link" href="#/settings/channels">Contatos, conexão e segurança</a></>}</small>
        </span>
        {enterprise && <Switch checked={!!mine} onChange={toggle} label={`${agent.name} atende o WhatsApp`} />}
      </label></li>
    </ul>
  </>;
}

const pick = a => ({
  name: a.name, nickname: a.nickname || '', description: a.description, category: a.category, status: a.status,
  instructions: a.instructions, tone: a.tone, style: agentStyleDraft(a),
  model: a.model, effort: a.effort || 'auto', tools: a.tools, avatar: a.avatar,
  autonomyLevel: a.autonomyLevel || 'semi_autonomous', claudeAccount: a.claudeAccount || ''
});

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

const fmtS = ms => `${(ms / 1000).toFixed(1).replace('.', ',')}s`;
const fmtUsd = n => `US$ ${n.toFixed(n < 0.01 ? 4 : 2).replace('.', ',')}`;
const KIND = { routine: 'rotina', flow: 'fluxo' };

// Linha do tempo dos últimos 7 dias: o que o agente fez, quanto demorou e custou.
function Activity({ agent }) {
  const [t, setT] = useState(null);
  useEffect(() => { api(`/api/agents/${agent.id}/timeline?days=7`).then(setT).catch(e => setT({ error: e.message })); }, [agent.id]);
  if (!t) return <p className="muted">Carregando…</p>;
  if (t.error) return <p className="form-error">{t.error}</p>;
  if (!t.entries.length) return <EmptyState title="Nada nos últimos 7 dias" body={`Quando ${agent.name} responder ou agir sozinho, aparece aqui.`} />;
  const s = t.summary, days = [];
  for (const e of t.entries) {
    const d = new Date(e.at).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
    if (days.at(-1)?.d !== d) days.push({ d, list: [] });
    days.at(-1).list.push(e);
  }
  return <>
    <p className="tl-summary muted">Últimos 7 dias: {s.replies} {s.replies === 1 ? 'resposta' : 'respostas'} · {s.actions} {s.actions === 1 ? 'ação' : 'ações'} · <span className={s.errors ? 'msg-error' : ''}>{s.errors} {s.errors === 1 ? 'falha' : 'falhas'}</span>{s.costUsd > 0 && ` · ${fmtUsd(s.costUsd)}`}{s.avgMs != null && ` · ${fmtS(s.avgMs)} em média`}</p>
    {days.map(({ d, list }) => <section key={d} className="tl-day">
      <h4>{d}</h4>
      <ol className="tl">
        {list.map((e, i) => <li key={i} className={e.kind === 'error' ? 'tl-err' : ''}>
          <div className="tl-head"><time>{fmtTime(e.at)}</time> <a className="link" href={`#/c/${e.chatId}`}>{e.chatTitle}</a>{KIND[e.kind] && <small className="muted"> · {KIND[e.kind]}</small>}</div>
          {e.actions.length > 0 && <div className="tl-line muted">{[...new Set(e.actions.map(stepLabel))].join(' · ')}</div>}
          {e.error && <div className="tl-line msg-error">{e.error}</div>}
          <small className="muted">{[e.ms != null && fmtS(e.ms), e.files > 0 && `${e.files} ${e.files === 1 ? 'arquivo' : 'arquivos'}`, e.costUsd > 0 && fmtUsd(e.costUsd)].filter(Boolean).join(' · ')}</small>
        </li>)}
      </ol>
    </section>)}
  </>;
}

function Routines({ agent }) {
  const { S } = useApp();
  return <>
    <p className="muted">Rotinas acordam {agent.name} num horário ou quando algo acontece (mensagem no WhatsApp, e-mail, GitHub, formulário, qualquer sistema). Com “só avisar se houver novidade”, execuções sem resultado relevante não deixam conversa. Para uma sequência de agentes, automatize um <a className="link" href="#/flows">fluxo</a>.{agent.status === 'paused' && ' Com o agente pausado, elas não rodam.'}</p>
    <RoutineList list={S.routines.filter(r => r.agentId === agent.id && !r.flowId)} />
    <RoutineForm agentId={agent.id} />
  </>;
}

export default function AgentConfig({ id }) {
  const { S, agent: get, updateAgent, refresh, toast } = useApp();
  const { query } = useRoute();
  const agent = get(id);
  const enterprise = isEnterpriseMode(S.settings);
  const [tab, setTab] = useState(() => { const q = query.get('tab'); return OLD_TAB[q] || (TABS.some(([k]) => k === q) ? q : 'identity'); });
  const [v, setV] = useState(() => agent && pick(agent));
  const [saving, setSaving] = useState(false);
  const [confirm, confirmNode] = useConfirm();
  const [computer, setComputer] = useState(null);
  useEffect(() => { if (tab === 'identity' && enterprise && agent) api(`/api/agents/${agent.id}/computer`).then(setComputer).catch(() => {}); }, [tab]);
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
        <AgentAvatar agent={{ ...agent, ...v }} size={80} interactive animate />
        <div><h1>{v.name || 'Sem nome'}</h1><div className="config-hero-meta"><StatusDot status={v.status} /><AutonomySemaphore level={v.autonomyLevel} settings={S.settings} /></div><p className="lede">{v.description || 'Sem descrição.'}</p></div>
      </div>
      <Segmented label="Seções" value={tab} onChange={setTab} items={TABS} className="seg-scroll config-tabs" />
      <div className="config-body">
        {tab === 'identity' && <>
          {/* o que se edita no dia a dia vem primeiro; a aparência fica recolhida */}
          <Basics v={v} set={set} categories={S.categories} />
          <div className="field"><span>Status</span>
            <Select label="Status" value={v.status} onChange={status => set({ status })} options={[
              { value: 'online', label: 'Ativo', hint: 'Responde e roda rotinas', icon: <i className="dot dot-ok" /> },
              { value: 'paused', label: 'Pausado', hint: 'Responde, mas as rotinas não rodam', icon: <i className="dot" /> }]} />
          </div>
          <details className="adv-model">
            <summary><Icon name="down" size={14} className="adv-chev" />Aparência <small>Avatar, formato e cor</small></summary>
            <Appearance v={v} set={set} />
          </details>
          <h3 className="sub">Voz e estilo</h3>
          <VoiceStyle v={v} set={set} />
          <h3 className="sub">Mais</h3>
          <div className="row" style={{ marginBottom: '1rem' }}>
            <button type="button" className="btn" onClick={async () => {
              try {
                await api('/api/agent-templates', { method: 'POST', body: { ...v, builtinTemplateId: agent.templateId } });
                await refresh();
                toast('Modelo salvo — aparece em Novo agente');
              } catch (e) { toast(e.message, 'error'); }
            }}><Icon name="book" size={16} />Salvar como modelo de agente</button>
          </div>
          {enterprise && <dl className="facts">
            <dt>ID</dt><dd><code>{agent.id}</code></dd>
            <dt>Computador</dt><dd>{computer ? `${computer.kind === 'boat' ? 'VM boat.dev' : computer.kind === 'local' ? 'Pasta local' : computer.kind === 'docker' ? 'Docker' : 'Desligado'} · ${computer.status}` : '…'}</dd>
            <dt>Criado</dt><dd>{new Date(agent.createdAt).toLocaleString('pt-BR')}</dd>
          </dl>}
          <div className="danger-zone">
            <div><b>Excluir agente</b><small>Apaga o agente e as rotinas dele. As conversas ficam.</small></div>
            <button className="btn btn-danger" disabled={S.agents.length < 2} onClick={remove}>Excluir</button>
          </div>
        </>}
        {tab === 'skills' && <>
          <h3 className="sub">O que {v.name || 'ele'} sabe fazer</h3>
          <Tools v={v} set={set} />
          <Channels agent={agent} />
          <Knowledge agent={agent} />
        </>}
        {tab === 'autonomy' && <>
          <Behavior v={v} set={set} settings={S.settings} />
          <details className="adv-model" open={enterprise}>
            <summary><Icon name="down" size={14} className="adv-chev" />Modelo e esforço <small>Avançado · o Ripper Auto escolhe sozinho</small></summary>
            <ModelPick v={v} set={set} />
          </details>
          {S.settings.claude?.accounts?.length > 0 && (
            <div className="set-row">
              <div className="set-label"><b>Conta do Claude</b><small>Qual assinatura este agente usa. Se ela bater o limite, o Ripper continua pela outra (quando a troca automática está ligada).</small></div>
              <div className="set-control">
                <Select label="Conta do Claude" value={v.claudeAccount} onChange={x => set('claudeAccount', x)}
                  options={[{ value: '', label: 'Padrão do Ripper' }, { value: 'principal', label: 'Conta pessoal' }, ...S.settings.claude.accounts.map(c => ({ value: c.id, label: c.label }))]} />
              </div>
            </div>
          )}
        </>}
        {tab === 'routines' && <Routines agent={agent} />}
        {tab === 'activity' && <Activity agent={agent} />}
      </div>
      {confirmNode}
    </div>
  );
}
