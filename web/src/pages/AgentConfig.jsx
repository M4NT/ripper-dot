import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app.jsx';
import { api, go, useRoute, fmtSize, fmtAgo } from '../lib.js';
import { AgentAvatar, Icon, Segmented, StatusDot, EmptyState, useConfirm, Select, Switch } from '../ui.jsx';
import { Basics, Behavior, Tools, Appearance, ModelPick, VoiceStyle, agentStyleDraft } from '../agentForm.jsx';
import { AutonomySemaphore } from '../autonomy.jsx';
import { uploadFile } from '../composer.jsx';
import { isEnterpriseMode } from '../uiMode.js';

// 4 abas pelo jeito que o dono pensa: quem ele é, o que sabe fazer, quanto decide sozinho, quando age sozinho.
const TABS = [['identity', 'Identidade'], ['skills', 'Habilidades'], ['autonomy', 'Autonomia'], ['routines', 'Rotinas']];
// links antigos (?tab=model etc.) continuam abrindo a aba certa
const OLD_TAB = { general: 'identity', look: 'identity', voice: 'identity', advanced: 'identity', tools: 'skills', knowledge: 'skills', model: 'autonomy', behavior: 'autonomy' };

/** Onde o agente atende além do chat do Ripper (canais configurados para ele). */
function Channels({ agent }) {
  const { S } = useApp();
  const qr = S.settings.whatsappWeb?.agentId === agent.id, meta = S.settings.whatsapp?.agentId === agent.id;
  const on = (qr && S.settings.whatsappWeb.enabled) || (meta && S.settings.whatsapp.enabled);
  return <>
    <h3 className="sub">Onde atende</h3>
    <ul className="toggle-list">
      <li><label><span className="toggle-ico"><Icon name="chat" /></span><span className="toggle-text"><b>Chat do Ripper</b><small>Você e seus times conversam com {agent.name} aqui.</small></span><span className="tag">sempre</span></label></li>
      <li><label><span className="toggle-ico"><Icon name="inbox" /></span><span className="toggle-text"><b>WhatsApp</b>
        <small>{qr || meta ? `${agent.name} responde ${qr ? 'pelo WhatsApp conectado por QR' : 'pela API oficial'}${on ? '' : ' (pausado: "Responder mensagens" está desligado)'}. Recados chegam na Caixa.` : `${agent.name} não atende no WhatsApp.`}</small></span>
        <a className="btn btn-sm" href="#/settings/plugins">{qr || meta ? 'Configurar' : 'Conectar'}</a></label></li>
    </ul>
  </>;
}
const pick = a => ({
  name: a.name, description: a.description, category: a.category, status: a.status,
  instructions: a.instructions, tone: a.tone, style: agentStyleDraft(a),
  model: a.model, effort: a.effort || 'auto', tools: a.tools, avatar: a.avatar,
  autonomyLevel: a.autonomyLevel || 'semi_autonomous'
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

function Routines({ agent }) {
  const { S, refresh, toast } = useApp();
  const blank = { name: '', prompt: '', kind: 'daily', when: '08:00', weekday: '', quiet: true, secret: '' };
  const [f, setF] = useState(blank);
  const list = S.routines.filter(r => r.agentId === agent.id);
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const hookUrl = r => `${location.origin}/api/hooks/${r.hookToken}`;
  const STATUS = { running: 'Em andamento', succeeded: 'Com novidade', failed: 'Falhou', quiet: 'Sem novidade (silenciosa)', never: 'Ainda não rodou' };
  async function add() {
    if (!f.prompt.trim()) return toast('Diga o que a rotina deve fazer.', 'error');
    const when = f.kind === 'webhook' ? { trigger: 'webhook', hookSecret: f.secret || undefined }
      : f.kind === 'every' ? { everyMinutes: +f.when || 60 } : { dailyAt: f.when, weekday: f.weekday === '' ? undefined : +f.weekday };
    await api('/api/routines', { method: 'POST', body: { agentId: agent.id, name: f.name || 'Rotina', prompt: f.prompt, quiet: f.quiet, ...when } });
    setF(blank); refresh(); toast(f.kind === 'webhook' ? 'Rotina criada. Copie o endereço do webhook na lista.' : 'Rotina criada');
  }
  return <>
    <p className="muted">Rotinas acordam {agent.name} num horário ou quando chega um evento (GitHub, formulário, qualquer sistema). Com “só avisar se houver novidade”, execuções sem resultado relevante não deixam conversa.{agent.status === 'paused' && ' Com o agente pausado, elas não rodam.'}</p>
    {list.length > 0 && <ul className="rows">{list.map(r => (
      <li key={r.id} className="row-item routine-row">
        <span className="thumb file-ico"><Icon name={r.trigger === 'webhook' ? 'plug' : 'clock'} size={18} /></span>
        <div className="row-main">
          <b>{r.name}{r.quiet !== false && <span className="tag">só novidades</span>}</b>
          <small>{r.trigger === 'webhook' ? `Quando chegar um evento${r.hasSecret ? ' · assinatura verificada' : ''}` : r.everyMinutes ? `A cada ${r.everyMinutes} min` : `${r.weekday != null ? days[r.weekday] + ', ' : 'Todo dia, '}${r.dailyAt}`} · {r.prompt}</small>
          {r.trigger === 'webhook' && (
            <div className="hook-url"><code>{hookUrl(r)}</code><button type="button" className="btn btn-sm" onClick={() => { navigator.clipboard.writeText(hookUrl(r)); toast('Endereço copiado'); }}><Icon name="copy" size={13} />Copiar</button></div>
          )}
          {r.lastRun > 0 && <small>Última execução: {fmtAgo(r.lastRun)} · {STATUS[r.lastStatus] || 'Sem resultado'}{r.lastError ? ` · ${r.lastError}` : ''}{r.lastChatId && r.lastStatus !== 'quiet' && <> · <a className="link" href={`#/c/${r.lastChatId}`}>ver resultado</a></>}</small>}
        </div>
        <button type="button" className="icon-btn sm" aria-label={`Remover ${r.name}`} onClick={() => api(`/api/routines/${r.id}`, { method: 'DELETE' }).then(refresh)}><Icon name="trash" size={16} /></button>
      </li>
    ))}</ul>}
    <div className="card-form">
      <h3 className="sub">Nova rotina</h3>
      <label className="field">Nome<input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder={f.kind === 'webhook' ? 'Revisar PRs' : 'Resumo de IA'} /></label>
      <label className="field">O que fazer<textarea rows={3} value={f.prompt} onChange={e => setF({ ...f, prompt: e.target.value })} placeholder={f.kind === 'webhook' ? 'Leia o evento. Se for um PR novo, resuma as mudanças e aponte riscos.' : 'Pesquise as notícias de IA de hoje e me mande um resumo.'} /></label>
      <div className="row wrap-row">
        <Select label="Quando" value={f.kind} onChange={kind => setF({ ...f, kind, when: kind === 'every' ? '60' : '08:00' })}
          options={[{ value: 'daily', label: 'No horário', icon: <Icon name="clock" size={15} /> }, { value: 'every', label: 'A cada N minutos', icon: <Icon name="retry" size={15} /> }, { value: 'webhook', label: 'Quando chegar um evento', hint: 'Webhook: GitHub, formulários, qualquer sistema', icon: <Icon name="plug" size={15} /> }]} />
        {f.kind === 'daily' && <Select label="Dia" value={f.weekday} onChange={weekday => setF({ ...f, weekday })}
          options={[{ value: '', label: 'Todo dia' }, ...days.map((d, i) => ({ value: String(i), label: d }))]} />}
        {f.kind !== 'webhook' && <input className="input narrow-input" type={f.kind === 'daily' ? 'time' : 'number'} min={5} value={f.when} onChange={e => setF({ ...f, when: e.target.value })} aria-label={f.kind === 'daily' ? 'Horário' : 'Minutos'} />}
      </div>
      {f.kind === 'webhook' && <label className="field">Segredo do webhook (opcional)<input value={f.secret} onChange={e => setF({ ...f, secret: e.target.value })} placeholder="O mesmo “Secret” configurado no GitHub" /><small>Com segredo, eventos sem a assinatura correta (X-Hub-Signature-256) são recusados.</small></label>}
      <label className="switch-row"><span><b>Só avisar se houver novidade</b><small>Sem nada relevante, a execução não deixa conversa nem notificação.</small></span><Switch checked={f.quiet} onChange={quiet => setF({ ...f, quiet })} label="Só avisar se houver novidade" /></label>
      <button type="button" className="btn btn-primary" onClick={add}><Icon name="plus" size={16} />Criar rotina</button>
    </div>
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
          <Appearance v={v} set={set} />
          <Basics v={v} set={set} categories={S.categories} />
          <div className="field"><span>Status</span>
            <Select label="Status" value={v.status} onChange={status => set({ status })} options={[
              { value: 'online', label: 'Ativo', hint: 'Responde e roda rotinas', icon: <i className="dot dot-ok" /> },
              { value: 'paused', label: 'Pausado', hint: 'Responde, mas as rotinas não rodam', icon: <i className="dot" /> }]} />
          </div>
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
        </>}
        {tab === 'routines' && <Routines agent={agent} />}
      </div>
      {confirmNode}
    </div>
  );
}
