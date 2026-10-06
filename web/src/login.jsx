import { useState } from 'react';
import { api } from './lib.js';

/** Senha única do Ripper: cria na primeira vez (só no próprio computador), depois só entra. */
export default function Login({ status, onDone }) {
  const setup = !status.configured;
  const [pw, setPw] = useState(''), [pw2, setPw2] = useState(''), [code, setCode] = useState('');
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault();
    if (setup && pw !== pw2) return setErr('As senhas não são iguais.');
    setBusy(true); setErr('');
    try { await api(setup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', body: setup ? { password: pw, code } : { password: pw } }); onDone(); }
    catch (x) { setErr(x.message); setBusy(false); }
  };
  if (setup && !status.canSetup) return (
    <div className="boot login"><h1>Ripper</h1><p className="muted">Crie a senha abrindo o Ripper no computador onde ele roda.</p></div>
  );
  return (
    <form className="boot login" onSubmit={submit}>
      <h1>Ripper</h1>
      <p className="muted">{setup ? 'Crie a senha que vai proteger o seu Ripper.' : 'Digite a senha para entrar.'}</p>
      <label className="field"><span>Senha</span>
        <input type="password" autoFocus autoComplete={setup ? 'new-password' : 'current-password'} value={pw} onChange={e => setPw(e.target.value)} minLength={8} required />
      </label>
      {setup && <label className="field"><span>Código de configuração (aparece no terminal)</span>
        <input autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX-XXXX" value={code} onChange={e => setCode(e.target.value)} required />
        <small className="muted">Também fica em <code>data/setup-code.txt</code>, na pasta do Ripper.</small>
      </label>}
      {setup && <label className="field"><span>Repita a senha</span>
        <input type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} minLength={8} required />
      </label>}
      {err && <p className="login-err" role="alert">{err}</p>}
      <button className="btn btn-primary" disabled={busy}>{setup ? 'Criar senha e entrar' : 'Entrar'}</button>
      {!setup && <details className="small muted"><summary>Esqueci a senha</summary><p>No computador do Ripper, rode no terminal: <code>node scripts/senha.mjs</code></p></details>}
    </form>
  );
}
