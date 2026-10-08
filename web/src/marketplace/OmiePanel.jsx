import { useEffect, useState } from 'react';
import { api } from '../lib.js';
import { Icon, EmptyState } from '../ui.jsx';

/** Empresas do Omie: uma entrada por empresa, com chave e segredo guardados no cofre cifrado. */
export default function OmiePanel() {
  const [data, setData] = useState(null); // { companies: [{ slug, status }], vaultConfigured }
  const [form, setForm] = useState(null); // { slug, appKey, appSecret } ou null
  const [busy, setBusy] = useState(''); // '' | 'save' | 'test:<nome>' | 'remove:<nome>'
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    api('/api/omie').then(setData).catch(e => setErr(e.message));
  }, []);

  async function add(e) {
    e.preventDefault();
    setErr(''); setNote('');
    if (!form.slug.trim() || !form.appKey.trim() || !form.appSecret.trim()) return setErr('Preencha o nome Omie, a chave e o segredo.');
    setBusy('save');
    try {
      const r = await api('/api/omie/companies', { method: 'POST', body: { slug: form.slug.trim(), appKey: form.appKey.trim(), appSecret: form.appSecret.trim() } });
      setData(d => ({ ...d, companies: r.companies }));
      setForm(null);
      setNote('Empresa salva. Use Testar conexão para conferir.');
    } catch (x) { setErr(x.message); }
    setBusy('');
  }

  async function test(slug) {
    setBusy('test:' + slug); setErr(''); setNote('');
    try { await api(`/api/omie/companies/${slug}/test`, { method: 'POST' }); setNote(`Conexão com ${slug} funcionando.`); }
    catch (x) { setErr(x.message); }
    setBusy('');
  }

  async function remove(slug) {
    if (!confirm(`Remover ${slug}? A chave dela sai do cofre.`)) return;
    setBusy('remove:' + slug); setErr(''); setNote('');
    try { const r = await api(`/api/omie/companies/${slug}`, { method: 'DELETE' }); setData(d => ({ ...d, companies: r.companies })); }
    catch (x) { setErr(x.message); }
    setBusy('');
  }

  const companies = data?.companies || [];

  return (
    <section className="set-card mp-omie" aria-labelledby="omie-title">
      <header>
        <h3 id="omie-title">Empresas no Omie</h3>
        <p className="set-card-desc">
          Cada empresa usa a chave do aplicativo que o administrador dela gerou no Omie. A chave e o segredo ficam cifrados no cofre do Ripper e nunca aparecem na tela.
        </p>
      </header>
      {data && !data.vaultConfigured && (
        <p className="form-error" role="alert">Cofre indisponível: defina RIPPER_VAULT_KEY ou RIPPER_TOKEN no servidor para guardar as chaves.</p>
      )}
      {data && companies.length === 0 && !form
        ? <EmptyState title="Nenhuma empresa" body="Adicione a primeira empresa do Omie para os agentes operarem o ERP dela." />
        : (
          <ul className="rows flat">
            {companies.map(c => (
              <li key={c.slug} className="row-item">
                <span className="thumb file-ico"><Icon name="grid" size={18} /></span>
                <div className="row-main"><b>{c.slug}</b></div>
                <span className={`pill${c.status === 'conectada' ? ' on' : ''}`}>{c.status}</span>
                <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => test(c.slug)}>
                  {busy === 'test:' + c.slug ? 'Testando…' : 'Testar conexão'}
                </button>
                <button type="button" className="icon-btn sm" aria-label={`Remover ${c.slug}`} disabled={!!busy} onClick={() => remove(c.slug)}>
                  <Icon name="trash" size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      {form && (
        <form className="mp-social-form" onSubmit={add}>
          <label className="field">Nome Omie da empresa<input className="input" value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} placeholder="ecmach" autoComplete="off" maxLength={60} /></label>
          <label className="field">Chave do aplicativo<input className="input" value={form.appKey} onChange={e => setForm({ ...form, appKey: e.target.value })} autoComplete="off" /></label>
          <label className="field">Segredo do aplicativo<input className="input" type="password" value={form.appSecret} onChange={e => setForm({ ...form, appSecret: e.target.value })} autoComplete="new-password" /></label>
          <div className="set-actions">
            <button type="button" className="btn" disabled={!!busy} onClick={() => setForm(null)}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={!!busy}>{busy === 'save' ? 'Salvando…' : 'Salvar empresa'}</button>
          </div>
        </form>
      )}
      {!form && (
        <div className="set-actions">
          <button type="button" className="btn btn-sm" disabled={!data || !!busy} onClick={() => { setForm({ slug: '', appKey: '', appSecret: '' }); setErr(''); }}>
            <Icon name="plus" size={14} /> Adicionar empresa
          </button>
        </div>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
      {note && <p className="set-card-desc">{note}</p>}
    </section>
  );
}
