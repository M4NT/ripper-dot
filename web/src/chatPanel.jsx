import { useEffect, useMemo, useRef, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import { api, fmtAgo, TOOL_INFO } from './lib.js';
import { AgentAvatar, Icon, Menu, Segmented, StatusDot } from './ui.jsx';
import { useApp } from './app.jsx';
import { uploadFile } from './composer.jsx';
import { ResizeHandle } from './resize.jsx';
import { effortLabel } from './modelPicker.jsx';
import { ArtifactList } from './actions.jsx';
import ConversationMedia from './ConversationMedia.jsx';
const COMP_LABEL = { running: 'Ligado', stopped: 'Parado', 'not started': 'Ainda não iniciado', local: 'Pasta local', off: 'Desligado', 'no key': 'Falta a chave do boat.dev', unknown: 'Sem resposta da VM' };

/** Engrenagem: as ferramentas de cada agente ficam "anexadas" aqui, sem ocupar o painel. */
function ToolsMenu({ members }) {
  return (
    <Menu align="right" className="tools-menu" trigger={({ toggle, open }) => (
      <button className="icon-btn" onClick={toggle} aria-expanded={open} aria-label="Ferramentas e configurações" title="Ferramentas e configurações"><Icon name="gear" /></button>
    )}>
      <div className="tools-pop">
        {members.map(a => (
          <div key={a.id} className="tools-agent">
            <div className="tools-agent-head"><AgentAvatar agent={a} size={22} paused /><b>{a.name}</b>
              <a role="menuitem" className="tools-edit" href={`#/agents/${a.id}/settings`}>Configurar</a></div>
            <ul>
              {Object.entries(TOOL_INFO).map(([k, t]) => {
                const on = a.tools.includes(k);
                return <li key={k} className={on ? 'on' : ''}><Icon name={t.icon} size={15} /><span>{t.label}</span><small>{on ? 'Ligada' : 'Desligada'}</small></li>;
              })}
            </ul>
            <a role="menuitem" className="tools-more" href={`#/agents/${a.id}/settings?tab=tools`}><Icon name="plus" size={14} />Gerenciar ferramentas</a>
          </div>
        ))}
      </div>
    </Menu>
  );
}

function Details({ members, project, S }) {
  const group = members.length > 1;
  const routines = S.routines.filter(r => members.some(a => a.id === r.agentId));
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  return (
    <div className="panel-tab">
      {group ? (
        <ul className="member-list">
          {members.map(a => (
            <li key={a.id}><AgentAvatar agent={a} size={30} paused /><span><b>{a.name}</b><small>{a.description || a.category}</small></span></li>
          ))}
        </ul>
      ) : <p className="panel-desc">{members[0].description || 'Sem descrição.'}</p>}
      {group && <p className="panel-note">Quem fala é escolhido pelo pedido. Com <b>@Nome</b> você chama alguém direto; eles se delegam entre si.</p>}

      <dl className="facts compact">
        {!group && <><dt>Modelo</dt><dd>{S.models[members[0].model]?.label || 'Ripper Auto'} · {effortLabel(members[0].effort)}</dd></>}
        {project && <><dt>Projeto</dt><dd><a className="link" href={`#/p/${project.id}`}>{project.name}</a></dd></>}
        <dt>Memórias</dt><dd>{S.memoriesByAgent ? members.reduce((n, a) => n + (S.memoriesByAgent[a.id] || 0), 0) : '—'}</dd>
      </dl>

      <p className="panel-label">Rotinas</p>
      {routines.length === 0
        ? <p className="muted small">Nenhuma. Peça no chat: “todo dia às 9, me mande…”.</p>
        : <ul className="mini-list">{routines.map(r => (
          <li key={r.id}><Icon name="clock" size={14} /><span><b>{r.name}</b><small>{r.everyMinutes ? `A cada ${r.everyMinutes} min` : `${r.weekday != null ? days[r.weekday] + ', ' : 'Todo dia, '}${r.dailyAt}`}</small></span></li>
        ))}</ul>}
      {!group && <a className="btn btn-block btn-sm" href={`#/agents/${members[0].id}/settings?tab=routines`}><Icon name="plus" size={14} />Nova rotina</a>}
    </div>
  );
}

function Files({ members, project, chatId, files, refresh, toast }) {
  const input = useRef(null);
  async function add(list) {
    for (const f of list) { try { await uploadFile(members[0].id, chatId, f, project?.id); } catch (e) { toast(e.message, 'error'); } }
    refresh();
  }
  const emptyHint = `Nenhum arquivo nesta conversa.${members.length > 1 ? ' Todos os participantes veem o que for enviado.' : ''}`;
  return (
    <>
      <ConversationMedia
        files={files}
        canUpload={!!chatId}
        emptyHint={emptyHint}
        onAdd={() => input.current?.click()}
        onRemove={f => api(`/api/files/${f.id}`, { method: 'DELETE' }).then(refresh)}
      />
      <input ref={input} type="file" multiple hidden onChange={e => { add([...e.target.files]); e.target.value = ''; }} />
    </>
  );
}

/**
 * Tela da VM ao vivo (noVNC). Por padrão só assiste; "Assumir controle" libera mouse e teclado
 * para você mostrar ao agente como fazer algo. Tudo roda na sua máquina, sem custo.
 */
function LiveScreen({ agent, working }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(null);
  const [control, setControl] = useState(false);
  const [big, setBig] = useState(false);
  const [loading, setLoading] = useState(false);
  async function connect() {
    setLoading(true); setErr(null);
    try { setUrl((await api(`/api/agents/${agent.id}/vnc`)).url); }
    catch (e) { setErr(e.message); }
    setLoading(false);
  }
  // Liga sozinho quando o agente começa a trabalhar nesta conversa.
  useEffect(() => { if (working && !url && !loading) connect(); }, [working]);
  const src = url && `${url}&view_only=${control ? 0 : 1}`;
  const frame = src && <iframe key={src} src={src} title={`Tela de ${agent.name}`} allow="clipboard-read; clipboard-write" />;
  return <>
    <div className={`agent-screen live-vnc ${working ? 'live' : ''} ${control ? 'controlling' : ''}`}>
      <div className="pc-bar">
        <i /><i /><i /><span>tela · {agent.name}</span>
        {working && <span className="live-dot">trabalhando</span>}
        {url && <>
          <button className={`vnc-btn ${control ? 'on' : ''}`} onClick={() => setControl(c => !c)} title={control ? 'Voltar a só assistir' : 'Usar mouse e teclado na VM'}>
            <Icon name={control ? 'x' : 'edit'} size={12} />{control ? 'Soltar controle' : 'Assumir controle'}
          </button>
          <button className="vnc-btn icon" onClick={() => setBig(true)} title="Tela cheia" aria-label="Tela cheia"><Icon name="share" size={12} /></button>
        </>}
      </div>
      {frame && !big ? frame : (
        <div className="vnc-off">
          {err ? <p className="pc-idle">{err}</p> : <p className="pc-idle">{big ? 'Aberta em tela cheia.' : `Veja e controle a tela da VM de ${agent.name}. Liga o computador se estiver desligado.`}</p>}
          {!big && <button className="btn btn-sm" onClick={connect} disabled={loading}>{loading ? 'Ligando a VM…' : 'Ver tela ao vivo'}</button>}
        </div>
      )}
    </div>
    {big && (
      <div className="vnc-full" role="dialog" aria-label={`Tela de ${agent.name}`}>
        <div className="vnc-full-bar">
          <b>Tela de {agent.name}</b>{working && <span className="live-dot">trabalhando</span>}
          <div className="grow" />
          <button className={`btn btn-sm ${control ? 'btn-primary' : ''}`} onClick={() => setControl(c => !c)}>{control ? 'Soltar controle' : 'Assumir controle'}</button>
          <button className="btn btn-sm" onClick={() => setBig(false)}><Icon name="x" size={14} />Fechar</button>
        </div>
        {frame}
        <p className="vnc-hint">{control ? 'Você está no controle: mouse e teclado vão para a VM. Mostre a tarefa e depois peça ao agente para repetir.' : 'Só assistindo. Clique em “Assumir controle” para usar mouse e teclado.'}</p>
      </div>
    )}
  </>;
}

/** A "tela" do computador: estado da VM e o que o agente executou nesta conversa. */
function Computer({ members, messages, busy, S_mode }) {
  const withPc = members.filter(a => a.tools.includes('computer'));
  const [status, setStatus] = useState({});
  useEffect(() => {
    let alive = true;
    const load = () => Promise.all(withPc.map(a => api(`/api/agents/${a.id}/computer`).then(r => [a.id, r]).catch(() => [a.id, { status: 'unknown' }])))
      .then(r => alive && setStatus(Object.fromEntries(r)));
    load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, [withPc.map(a => a.id).join()]);
  const log = useMemo(() => messages.flatMap(m => (m.steps || [])
    .filter(s => /^(computer_|browser_)/.test(s.tool || ''))
    .map(s => ({ ...s, agentId: m.agentId, at: s.at || m.at }))), [messages]);
  const screen = useRef(null);
  useEffect(() => { screen.current?.scrollTo({ top: 1e9 }); }, [log.length]);

  if (!withPc.length) return (
    <div className="panel-tab"><div className="pc-empty"><Icon name="terminal" size={22} /><b>Sem computador</b><p>Ligue a ferramenta Computador nas configurações do agente para ele instalar, rodar e mostrar coisas aqui.</p></div></div>
  );
  const working = withPc.some(a => busy[a.id]);
  return (
    <div className="panel-tab">
      {withPc.map(a => {
        const st = status[a.id];
        return (
          <div key={a.id} className="pc-status">
            <AgentAvatar agent={a} size={20} paused />
            <span>{a.name}</span>
            <small className={`comp comp-${(st?.status || '').replace(' ', '-')}`}>{st ? COMP_LABEL[st.status] || st.status : '…'}</small>
          </div>
        );
      })}
      {S_mode === 'docker' && withPc.map(a => <LiveScreen key={a.id} agent={a} working={!!busy[a.id]} />)}
      <div className={`pc-screen ${working ? 'live' : ''}`} ref={screen} aria-label="Tela do computador" role="log">
        <div className="pc-bar"><i /><i /><i /><span>{withPc.length > 1 ? 'computadores' : withPc[0].name.toLowerCase().replace(/\s+/g, '-')}</span>{working && <ThinkingOrb state="working" size={20} />}</div>
        {log.length === 0
          ? <p className="pc-idle">{working ? 'Aguardando comandos…' : 'Nada executado nesta conversa ainda. Quando o agente usar o computador, os comandos aparecem aqui ao vivo.'}</p>
          : log.map((s, i) => (
            <div key={i} className="pc-line">
              <span className="pc-prompt">{s.tool === 'computer_share' ? 'link' : s.tool?.startsWith('browser_') ? 'web' : '$'}</span>
              <code>{s.detail || s.tool}</code>
              <time>{fmtAgo(s.at)}</time>
            </div>
          ))}
      </div>
      {S_mode !== 'docker' && <p className="muted small">A tela ao vivo precisa do computador em modo Docker (Configurações → Computador).</p>}
    </div>
  );
}

export default function ChatPanel({ members, project, chatId, messages, files, onCollapse }) {
  const { S, refresh, toast, busy: busyAgents, busyChats } = useApp();
  // Nesta tela, "trabalhando" é desta conversa (não de outra em que o agente esteja).
  const busy = chatId && busyChats[chatId] ? busyAgents : {};
  const [tab, setTab] = useState('details');
  useEffect(() => { const show = () => setTab('computer'); addEventListener('ripper:computer', show); return () => removeEventListener('ripper:computer', show); }, []);
  const group = members.length > 1, a = members[0];
  const working = members.some(x => busy[x.id]);
  const arts = S.artifacts.filter(x => project ? x.projectId === project.id : chatId && x.chatId === chatId);
  const pcUses = messages.reduce((n, m) => n + (m.steps || []).filter(s => (s.tool || '').startsWith('computer_')).length, 0);
  return (
    <aside className="agent-panel v2" data-resizable aria-label={group ? 'Conversa em grupo' : `Sobre ${a.name}`}>
      <ResizeHandle side="right" cssVar="panel-w" min={280} max={620} label="Largura do painel" onCollapse={onCollapse} />
      <div className="panel-head">
        <div className="panel-id">
          {group ? <span className="avatar-stack lg">{members.slice(0, 3).map(x => <AgentAvatar key={x.id} agent={x} size={40} state={busy[x.id] ? 'working' : undefined} />)}</span>
            : <AgentAvatar agent={a} size={56} state={working ? 'working' : undefined} />}
          <div>
            <h2>{group ? 'Grupo' : a.name}</h2>
            {working ? <span className="status status-online"><i />respondendo…</span> : group ? <small className="muted">{members.length} agentes</small> : <StatusDot status={a.status} />}
          </div>
        </div>
        <ToolsMenu members={members} />
        <button className="icon-btn" onClick={onCollapse} aria-label="Recolher painel" title="Recolher painel"><Icon name="sidebar" /></button>
      </div>
      <Segmented label="Seções do painel" value={tab} onChange={setTab} size="sm" className="panel-tabs"
        items={[['details', 'Detalhes'], ['artifacts', 'Artefatos', arts.length || null], ['files', 'Arquivos', files.length || null], ['computer', 'Computador', pcUses || null]]} />
      {tab === 'details' && <Details members={members} project={project} S={S} />}
      {tab === 'artifacts' && <div className="panel-tab">
        <ArtifactList items={arts} empty={project ? 'Nenhum artefato no projeto ainda. Peça: “salve isso como artefato”. Todos os agentes do projeto veem.' : 'Nenhum artefato ainda. Peça: “salve isso como artefato”.'} />
        {arts.length > 0 && <p className="muted small">{project ? 'Compartilhados com todos os agentes do projeto.' : 'Salvos nesta conversa.'}</p>}
      </div>}
      {tab === 'files' && <Files members={members} project={project} chatId={chatId} files={files} refresh={refresh} toast={toast} />}
      {tab === 'computer' && <Computer members={members} messages={messages} busy={busy} S_mode={S.settings.computer.mode} />}
    </aside>
  );
}
