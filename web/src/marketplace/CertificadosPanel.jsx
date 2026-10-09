import { useEffect, useState } from 'react';
import { api } from '../lib.js';
import { Icon, EmptyState, useConfirm } from '../ui.jsx';

const fmtCnpj = d => String(d).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmtData = iso => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const STATUS = {
  ok: { label: 'Válido', cls: 'on' },
  vence_em_breve: { label: 'Vence em breve', cls: '' },
  vencido: { label: 'Vencido', cls: '' }
};

/** Lê o arquivo do certificado como base64 (sem o prefixo data:). */
function readBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
    r.readAsDataURL(file);
  });
}

/** Certificado digital A1 por empresa (NF-e recebidas). O .pfx e a senha vão cifrados ao cofre e nunca voltam para a tela. */
export default function CertificadosPanel() {
  const [confirm, confirmNode] = useConfirm();
  const [data, setData] = useState(null); // { certificados, vaultConfigured }
  const [form, setForm] = useState(null); // { cnpj, file, password } ou null
  const [busy, setBusy] = useState(''); // '' | 'save' | 'remove:<cnpj>'
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    api('/api/certificados').then(setData).catch(e => setErr(e.message));
  }, []);

  async function save(e) {
    e.preventDefault();
    setErr(''); setNote('');
    const cnpj = form.cnpj.replace(/\D/g, '');
    if (cnpj.length !== 14) return setErr('Informe o CNPJ com 14 dígitos.');
    if (!form.file) return setErr('Escolha o arquivo .pfx ou .p12 do certificado.');
    if (!form.password) return setErr('Informe a senha do certificado.');
    setBusy('save');
    try {
      const pfxBase64 = await readBase64(form.file);
      const r = await api(`/api/certificados/${cnpj}`, { method: 'POST', body: { pfxBase64, password: form.password } });
      setData(d => ({ ...d, certificados: r.certificados }));
      setForm(null);
      setNote(`Certificado de ${r.certificado.titular} guardado. Vale até ${fmtData(r.certificado.validTo)}.`);
    } catch (x) {
      setErr(x.message);
      setForm(f => (f ? { ...f, password: '' } : f)); // a senha não fica na tela depois de uma tentativa
    }
    setBusy('');
  }

  async function remove(cnpj) {
    if (!(await confirm({ title: `Remover o certificado da empresa ${fmtCnpj(cnpj)}?`, body: 'As notas já baixadas continuam guardadas.', danger: true, action: 'Remover' }))) return;
    setBusy('remove:' + cnpj); setErr(''); setNote('');
    try {
      const r = await api(`/api/certificados/${cnpj}`, { method: 'DELETE' });
      setData(d => ({ ...d, certificados: r.certificados }));
    } catch (x) { setErr(x.message); }
    setBusy('');
  }

  const certs = data?.certificados || [];

  return (
    <>
      {confirmNode}
    <section className="set-card mp-omie" aria-labelledby="cert-title">
      <header>
        <h3 id="cert-title">Certificado digital (NF-e recebidas)</h3>
        <p className="set-card-desc">
          Certificado A1 (ICP-Brasil) de cada empresa, para o Ripper consultar as notas recebidas na Receita. A consulta é só leitura.
          O arquivo e a senha ficam cifrados no cofre do Ripper e nunca aparecem na tela.
        </p>
      </header>
      {data && !data.vaultConfigured && (
        <p className="form-error" role="alert">Cofre indisponível: defina RIPPER_VAULT_KEY ou RIPPER_TOKEN no servidor para guardar o certificado.</p>
      )}
      {data && certs.length === 0 && !form
        ? <EmptyState title="Nenhum certificado" body="Envie o certificado A1 da empresa para o Ripper buscar as notas recebidas." />
        : (
          <ul className="rows flat">
            {certs.map(c => (
              <li key={c.cnpj} className="row-item">
                <span className="thumb file-ico"><Icon name="grid" size={18} /></span>
                <div className="row-main">
                  <b>{c.titular}</b>
                  <div className="muted">CNPJ {fmtCnpj(c.cnpj)} · válido até {fmtData(c.validTo)}</div>
                </div>
                <span className={`pill${STATUS[c.status]?.cls ? ' ' + STATUS[c.status].cls : ''}`}>
                  {c.status === 'vence_em_breve' ? `Vence em ${c.diasRestantes} dias` : STATUS[c.status]?.label}
                </span>
                <button type="button" className="icon-btn sm" aria-label={`Remover certificado de ${c.titular}`} disabled={!!busy} onClick={() => remove(c.cnpj)}>
                  <Icon name="trash" size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      {form && (
        <form className="mp-social-form" onSubmit={save}>
          <label className="field">CNPJ da empresa<input className="input" inputMode="numeric" value={form.cnpj} onChange={e => setForm({ ...form, cnpj: e.target.value })} placeholder="00.000.000/0001-00" autoComplete="off" maxLength={18} /></label>
          <label className="field">Arquivo do certificado (.pfx ou .p12)<input className="input" type="file" accept=".pfx,.p12,application/x-pkcs12" onChange={e => setForm({ ...form, file: e.target.files?.[0] || null })} /></label>
          <label className="field">Senha do certificado<input className="input" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} autoComplete="off" /></label>
          <div className="set-actions">
            <button type="button" className="btn" disabled={!!busy} onClick={() => { setForm(null); setErr(''); }}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={!!busy}>{busy === 'save' ? 'Conferindo…' : 'Guardar certificado'}</button>
          </div>
        </form>
      )}
      {!form && (
        <div className="set-actions">
          <button type="button" className="btn btn-sm" disabled={!data || !!busy} onClick={() => { setForm({ cnpj: '', file: null, password: '' }); setErr(''); }}>
            <Icon name="plus" size={14} /> Enviar certificado
          </button>
        </div>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
      {note && <p className="set-card-desc">{note}</p>}
    </section>
    </>
  );
}
