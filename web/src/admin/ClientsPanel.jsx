import { useEffect, useState } from 'react';
import { api } from '../lib.js';
import { useConfirm } from '../ui.jsx';

const iso = d => d.toISOString().slice(0, 10);
const brl = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDoc = d => d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  : d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : d;
const EMPTY = { name: '', document: '', tag: '', projectIds: [], monthlyFeeBrl: '' };
const RATE_KEY = 'ripper.finops.usdBrl';
const readRate = () => { try { return Number(localStorage.getItem(RATE_KEY)) || 5.5; } catch { return 5.5; } };

/** Clientes (FinOps): quem é cada cliente, como as conversas chegam nele e margem estimada dos últimos 30 dias. */
export default function ClientsPanel() {
  const [data, setData] = useState(null);
  const [costs, setCosts] = useState({});
  const [draft, setDraft] = useState(null); // null = fechado; { id? , ...campos }
  const [err, setErr] = useState('');
  const [rate, setRate] = useState(readRate);

  const load = () => {
    api('/api/admin/clients').then(setData).catch(e => setErr(e.message));
    const to = new Date();
    api(`/api/admin/usage?from=${iso(new Date(to - 29 * 86400_000))}&to=${iso(to)}&group=client`)
      .then(d => setCosts(Object.fromEntries(d.rows.map(r => [r.key, r])))).catch(() => {});
  };
  useEffect(load, []);
  useEffect(() => { try { localStorage.setItem(RATE_KEY, String(rate)); } catch {} }, [rate]);

  const save = async e => {
    e.preventDefault();
    setErr('');
    const { id, ...b } = draft;
    try {
      await api(id ? `/api/admin/clients/${id}` : '/api/admin/clients', { method: id ? 'PUT' : 'POST', body: b });
      setDraft(null); load();
    } catch (e2) { setErr(e2.message); }
  };
  const remove = async c => {
    if (!(await confirm({ title: `Excluir o cliente ${c.name}?`, body: 'O uso dele passa a aparecer em Sem cliente.', danger: true, action: 'Excluir' }))) return;
    try { await api(`/api/admin/clients/${c.id}`, { method: 'DELETE' }); load(); } catch (e) { setErr(e.message); }
  };

  if (!data) return err ? <p className="form-error" role="alert">{err}</p> : <p className="muted" role="status">Carregando…</p>;
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const projName = id => data.projects.find(p => p.id === id)?.name || 'projeto excluído';

  const [confirm, confirmNode] = useConfirm();
  return (
    <>
      {confirmNode}
    <div className="metering-panel">
      <div className="usage-report-filters">
        <button type="button" className="btn btn-sm" onClick={() => setDraft({ ...EMPTY })}>Novo cliente</button>
        <label className="muted small">Cotação US$ → R$ (estimativa) <input className="input" type="number" min={0.01} step={0.01} value={rate} onChange={e => setRate(Number(e.target.value) || 0)} style={{ width: 90 }} /></label>
      </div>
      {err && <p className="form-error" role="alert">{err}</p>}

      {draft && (
        <form onSubmit={save}>
          <div className="set-row"><div className="set-label"><b>Nome</b></div><div className="set-control"><input className="input" required value={draft.name} onChange={e => set('name', e.target.value)} /></div></div>
          <div className="set-row"><div className="set-label"><b>CNPJ ou CPF</b><small>Opcional.</small></div><div className="set-control"><input className="input" inputMode="numeric" placeholder="00.000.000/0000-00" value={draft.document} onChange={e => set('document', e.target.value)} onBlur={e => set('document', fmtDoc(e.target.value.replace(/\D/g, '')))} /></div></div>
          <div className="set-row"><div className="set-label"><b>Tag da conversa</b><small>Conversas com esta tag contam para o cliente.</small></div><div className="set-control">
            <select className="input" value={draft.tag} onChange={e => set('tag', e.target.value)}>
              <option value="">Nenhuma</option>
              {[...new Set([...data.tags, draft.tag].filter(Boolean))].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div></div>
          <div className="set-row"><div className="set-label"><b>Projetos</b><small>Conversas destes projetos contam para o cliente.</small></div><div className="set-control">
            {data.projects.length ? data.projects.map(p => (
              <label key={p.id} className="small" style={{ display: 'block' }}>
                <input type="checkbox" checked={draft.projectIds.includes(p.id)} onChange={e => set('projectIds', e.target.checked ? [...draft.projectIds, p.id] : draft.projectIds.filter(x => x !== p.id))} /> {p.name}
              </label>
            )) : <span className="muted small">Nenhum projeto.</span>}
          </div></div>
          <div className="set-row"><div className="set-label"><b>Valor cobrado por mês</b><small>Opcional, para a margem estimada.</small></div><div className="set-control"><div className="input-unit"><span>R$</span><input className="input" type="number" min={0} step={0.01} value={draft.monthlyFeeBrl} onChange={e => set('monthlyFeeBrl', e.target.value)} /></div></div></div>
          <div className="usage-report-filters">
            <button type="submit" className="btn btn-sm">{draft.id ? 'Salvar' : 'Adicionar'}</button>
            <button type="button" className="btn btn-sm" onClick={() => setDraft(null)}>Cancelar</button>
          </div>
        </form>
      )}

      {data.clients.length === 0 ? <p className="muted">Nenhum cliente cadastrado.</p> : (
        <div className="usage-table-box">
          <table className="metering-table">
            <thead><tr><th scope="col">Cliente</th><th scope="col">Liga por</th><th scope="col">Custo 30 dias</th><th scope="col">Cobrado/mês</th><th scope="col">Margem (est.)</th><th scope="col">Ações</th></tr></thead>
            <tbody>
              {data.clients.map(c => {
                const r = costs[c.id], costBrl = (r?.costUsd || 0) * rate;
                return (
                  <tr key={c.id}>
                    <td>{c.name}{c.document && <div className="muted small">{fmtDoc(c.document)}</div>}</td>
                    <td className="small">{[c.tag && `tag “${c.tag}”`, ...c.projectIds.map(projName)].filter(Boolean).join(', ') || '—'}</td>
                    <td>{r?.costEstimated ? '~' : ''}{brl(costBrl)}</td>
                    <td>{c.monthlyFeeBrl ? brl(c.monthlyFeeBrl) : '—'}</td>
                    <td>{c.monthlyFeeBrl ? `~${brl(c.monthlyFeeBrl - costBrl)}` : '—'}</td>
                    <td>
                      <button type="button" className="btn btn-sm" onClick={() => setDraft({ ...EMPTY, ...c, document: fmtDoc(c.document || ''), monthlyFeeBrl: c.monthlyFeeBrl || '' })}>Editar</button>{' '}
                      <button type="button" className="btn btn-sm" onClick={() => remove(c)}>Excluir</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">Tudo aqui é estimativa: custo dos últimos 30 dias convertido pela cotação acima (~ = parte do custo estimada pelo catálogo; respostas pagas usam o custo real). Uso anterior ao cadastro do cliente só entra se a conversa tiver a tag ou projeto.</p>
    </div>
    </>
  );
}
