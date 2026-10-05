import { useEffect, useState } from 'react';
import { api, fmtAgo } from '../lib.js';
import { useApp } from '../app.jsx';
import { AgentAvatar, Select, EmptyState } from '../ui.jsx';

const APPROVED = { user: 'aprovado por você', auto: 'automático (contato liberado)', rule: 'liberado pela autonomia' };
const PERIODS = [['1', 'Últimas 24 h'], ['7', '7 dias'], ['30', '30 dias'], ['0', 'Tudo']];

/** Registro de ações externas: tudo que os agentes fizeram fora do Ripper em seu nome. Não dá para apagar. */
export default function ExternalLog() {
  const { S } = useApp();
  const [data, setData] = useState(null);
  const [kind, setKind] = useState('');
  const [agentId, setAgentId] = useState('');
  const [days, setDays] = useState('7');
  // "since" é calculado na hora da busca (fora do render): Date.now() na dependência refaria a busca sem parar.
  const query = () => new URLSearchParams({ ...(kind && { kind }), ...(agentId && { agentId }), ...(+days && { since: String(Date.now() - +days * 86_400_000) }) }).toString();
  useEffect(() => { setData(null); api(`/api/external-actions?${query()}`).then(setData).catch(() => setData({ kinds: {}, entries: [] })); }, [kind, agentId, days]);
  const agent = id => S.agents.find(a => a.id === id);
  return (
    <div className="page extlog-page">
      <header className="page-head">
        <div><h1>Ações externas</h1><p className="lede">Tudo o que os agentes fizeram fora do Ripper em seu nome: mensagens, publicações, ações no navegador e links públicos. Este registro não pode ser apagado nem editado.</p></div>
        <a className="btn" href="/api/external-actions.csv" download onClick={e => { e.currentTarget.href = `/api/external-actions.csv?${query()}`; }}>Exportar CSV</a>
      </header>
      <div className="toolbar extlog-filters">
        <Select label="Tipo" value={kind} onChange={setKind} options={[{ value: '', label: 'Todos os tipos' }, ...Object.entries(data?.kinds || {}).map(([v, l]) => ({ value: v, label: l }))]} />
        <Select label="Agente" value={agentId} onChange={setAgentId} options={[{ value: '', label: 'Todos os agentes' }, ...S.agents.map(a => ({ value: a.id, label: a.name }))]} />
        <Select label="Período" value={days} onChange={setDays} options={PERIODS.map(([v, l]) => ({ value: v, label: l }))} />
      </div>
      {!data ? <p className="muted">Carregando…</p>
        : data.entries.length === 0 ? <EmptyState title="Nenhuma ação externa" body="Quando um agente mandar uma mensagem, publicar algo ou agir no navegador em seu nome, fica registrado aqui." />
        : <ol className="extlog-list">{data.entries.map(e => {
            const a = agent(e.agentId);
            return (
              <li key={e.id} className={`extlog-item ${e.ok === false ? 'is-failed' : ''}`}>
                <span className="extlog-av">{a ? <AgentAvatar agent={a} size={28} /> : null}</span>
                <div className="extlog-main">
                  <p><b>{data.kinds[e.action] || e.action}</b>{e.target && <> · <span className="mono">{e.target}</span></>}{e.ok === false && <span className="tag tag-warn">falhou</span>}</p>
                  {e.preview && <p className="extlog-preview">{e.preview}</p>}{e.chars > 0 && <p className="extlog-preview muted">{e.chars} caracteres · o texto fica só na conversa</p>}
                  <small>{a?.name || (e.agentId ? 'Agente removido' : 'Você')}{APPROVED[e.approved] ? ` · ${APPROVED[e.approved]}` : ''}{e.error ? ` · ${e.error}` : ''}</small>
                </div>
                <time dateTime={new Date(e.at).toISOString()} title={new Date(e.at).toLocaleString('pt-BR')}>{fmtAgo(e.at)}</time>
              </li>
            );
          })}</ol>}
    </div>
  );
}
