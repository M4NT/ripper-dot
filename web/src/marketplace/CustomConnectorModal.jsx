import { useState } from 'react';
import { api } from '../lib.js';
import { Dialog, Icon } from '../ui.jsx';
import { runMcpOAuthLogin } from './mcpOAuth.js';
import BlindCredentialInput, { isSensitiveFieldName } from '../vault/BlindCredentialInput.jsx';
import '../styles/telas/marketplace/CustomConnectorModal.css';

const AUTH_MODES = [
  ['oauth_now', 'Entrar agora', 'Cada usuário faz login pelo fluxo OAuth do servidor antes de usar ferramentas.'],
  ['oauth_lazy', 'Fazer login quando necessário', 'Conecta sem credenciais e pede login só quando o servidor exigir.'],
  ['none', 'Sem login', 'Servidor aberto ou autenticação por chave de API nos cabeçalhos.']
];

const OAUTH_CLIENT = [
  ['published', 'Usar identidade publicada do Ripper', 'Recomendado quando o servidor aceita client_id dinâmico (CIMD).'],
  ['dcr', 'Registrar automaticamente', 'Registro dinâmico de clientes OAuth (DCR).'],
  ['custom', 'Use seu próprio cliente OAuth', 'Informe Client ID e segredo manualmente.']
];

export default function CustomConnectorModal({ open, onClose, onSaved }) {
  const [step, setStep] = useState('form');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [verify, setVerify] = useState(null);
  const [busy, setBusy] = useState(false);
  const [authMode, setAuthMode] = useState('oauth_now');
  const [oauthClient, setOauthClient] = useState('published');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [headers, setHeaders] = useState([]);
  const [clientSecretRef, setClientSecretRef] = useState('');

  function reset() {
    setStep('form'); setName(''); setUrl(''); setVerify(null); setBusy(false);
    setAuthMode('oauth_now'); setOauthClient('published'); setClientId(''); setClientSecret(''); setClientSecretRef(''); setHeaders([]);
  }

  function close() { reset(); onClose(); }

  const canContinue = name.trim().length > 0 && /^https:\/\/.+/i.test(url.trim());
  const oauthNeeded = verify?.login?.found && authMode !== 'none';

  async function runVerify() {
    setBusy(true);
    setStep('verify');
    try {
      const r = await api('/api/mcp/verify', { method: 'POST', body: { url: url.trim() } });
      setVerify(r);
      if (r.ok || r.oauthRequired) setStep('auth');
    } catch (e) {
      setVerify({ ok: false, steps: [{ id: 'connect', status: 'error', detail: e.message }], warning: e.message });
    }
    setBusy(false);
  }

  async function save() {
    setBusy(true);
    try {
      const trimmed = name.trim();
      const hdr = Object.fromEntries(headers.filter(h => h.name).map(h => [h.name, h.value]));
      await api('/api/mcp/connectors', {
        method: 'POST',
        body: {
          name: trimmed,
          type: 'http',
          url: url.trim(),
          enabled: true,
          auth: {
            mode: authMode,
            oauthClient,
            clientId: oauthClient === 'custom' ? clientId : '',
            clientSecret: oauthClient === 'custom' ? (clientSecretRef || clientSecret) : ''
          },
          headers: hdr
        }
      });

      if (oauthNeeded && authMode === 'oauth_now' && verify?.login?.discovery?.authorizationServer) {
        await runMcpOAuthLogin({
          pluginName: trimmed,
          url: url.trim(),
          discovery: verify.login.discovery
        });
      }

      onSaved?.();
      close();
    } catch (e) {
      setVerify(v => ({ ...(v || {}), saveError: e.message }));
    }
    setBusy(false);
  }

  function stepIcon(st) {
    if (st.status === 'ok') return <span className="verify-ico ok">✓</span>;
    if (st.status === 'error') return <span className="verify-ico err">✕</span>;
    return <span className="verify-ico skip">−</span>;
  }

  return (
    <Dialog open={open} onClose={close} className="conn-modal" label="Adicionar conector personalizado">
      <header className="conn-modal-head">
        <h2>Adicionar conector personalizado</h2>
        <button type="button" className="icon-btn sm" aria-label="Fechar" onClick={close}><Icon name="x" /></button>
      </header>
      <p className="conn-modal-lede">Conecte o Ripper aos seus dados e ferramentas. <a href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer">Saiba mais sobre conectores</a> ou explore conectores pré-construídos no Marketplace.</p>

      {(step === 'form' || step === 'verify') && (
        <>
          <label className="conn-field">
            <input className="input" placeholder="Nome" value={name} onChange={e => setName(e.target.value)} />
            <small>Exibido na lista de conectores.</small>
          </label>
          <label className="conn-field">
            <input className="input" placeholder="URL do servidor MCP" value={url} onChange={e => setUrl(e.target.value)} />
            <small>O endereço HTTPS onde o servidor aceita requisições MCP, por exemplo https://mcp.example.com/mcp.</small>
          </label>
          {step === 'verify' && verify && (
            <>
              <p className="conn-verify-title">Verificando o servidor…</p>
              <ul className="conn-verify-list">
                {(verify.steps || []).map(s => (
                  <li key={s.id}>
                    {stepIcon(s)}
                    <span><b>{s.id === 'connect' ? 'Conectando ao servidor' : s.id === 'login_meta' ? 'Procurando configurações de login' : 'Verificando o provedor de login'}</b><small>{s.detail}</small></span>
                    {s.httpStatus && <span className="tag warn">{s.httpStatus}</span>}
                  </li>
                ))}
              </ul>
              {!verify.ok && !verify.oauthRequired && verify.warning && (
                <div className="conn-warn">
                  <Icon name="stop" size={18} />
                  <div><b>Não foi possível verificar o servidor</b><p>{verify.warning} Selecione <b>Continuar mesmo assim</b> para configurar manualmente.</p></div>
                </div>
              )}
            </>
          )}
          <p className="conn-trust">Use apenas conectores de desenvolvedores em quem você confia. O Ripper não controla essas ferramentas.</p>
          <footer className="conn-modal-foot">
            <button type="button" className="btn" onClick={close}>Cancelar</button>
            {step === 'form' && <button type="button" className="btn btn-primary" disabled={!canContinue || busy} onClick={runVerify}>Continuar</button>}
            {step === 'verify' && !verify?.ok && !verify?.oauthRequired && <button type="button" className="btn btn-primary" onClick={() => setStep('auth')}>Continuar mesmo assim</button>}
            {step === 'verify' && (verify?.ok || verify?.oauthRequired) && <button type="button" className="btn btn-primary" onClick={() => setStep('auth')}>Continuar</button>}
          </footer>
        </>
      )}

      {step === 'auth' && (
        <>
          <div className="conn-readonly"><b>{name}</b><code>{url}</code></div>
          <section className="conn-section">
            <h3><Icon name="globe" size={14} /> Autenticação</h3>
            {AUTH_MODES.map(([k, label, desc]) => (
              <label key={k} className="conn-radio">
                <input type="radio" name="auth" checked={authMode === k} onChange={() => setAuthMode(k)} />
                <span><b>{label}</b><small>{desc}</small></span>
              </label>
            ))}
          </section>
          {authMode !== 'none' && (
            <section className="conn-section">
              <h3><Icon name="globe" size={14} /> Cliente OAuth</h3>
              {OAUTH_CLIENT.map(([k, label, desc]) => (
                <label key={k} className="conn-radio">
                  <input type="radio" name="oauth" checked={oauthClient === k} onChange={() => setOauthClient(k)} />
                  <span><b>{label}{k === 'published' && <em className="tag">Recomendado</em>}</b><small>{desc}</small></span>
                </label>
              ))}
              {oauthClient === 'custom' && (
                <div className="conn-custom-oauth">
                  <input className="input" placeholder="Client ID" value={clientId} onChange={e => setClientId(e.target.value)} />
                  {clientSecretRef ? (
                    <BlindCredentialInput label="Client secret" purpose="oauth" vaultRef={clientSecretRef} onVaultRef={setClientSecretRef} />
                  ) : (
                    <>
                      <BlindCredentialInput label="Client secret" purpose="oauth" onVaultRef={setClientSecretRef} />
                      <input className="input" placeholder="Ou digite legado (não recomendado)" type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} />
                    </>
                  )}
                  <small>Registre o redirect URI <code>{typeof window !== 'undefined' ? `${window.location.origin}/api/mcp/oauth/callback` : '/api/mcp/oauth/callback'}</code> no seu provedor.</small>
                </div>
              )}
            </section>
          )}
          {oauthNeeded && authMode === 'oauth_now' && (
            <p className="muted small">Ao concluir, o Ripper abrirá o navegador para você autorizar o acesso.</p>
          )}
          <section className="conn-section">
            <h3>Cabeçalhos de requisição</h3>
            <p className="muted small">Enviados em cada requisição (máx. 4). Valores sensíveis: use o cofre (referência vlt_…).</p>
            {headers.map((h, i) => (
              <div key={i} className="conn-header-row">
                <input className="input" placeholder="Nome" value={h.name} onChange={e => setHeaders(rs => rs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                {isSensitiveFieldName(h.name) || /^vlt_/.test(h.value || '') ? (
                  <BlindCredentialInput
                    label={h.name || 'Cabeçalho'}
                    purpose="connector-header"
                    vaultRef={/^vlt_/.test(h.value || '') ? h.value : ''}
                    onVaultRef={ref => setHeaders(rs => rs.map((x, j) => j === i ? { ...x, value: ref } : x))}
                  />
                ) : (
                  <input className="input" placeholder="Valor" value={h.value} onChange={e => setHeaders(rs => rs.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                )}
              </div>
            ))}
            {headers.length < 4 && (
              <button type="button" className="btn btn-sm" onClick={() => setHeaders(h => [...h, { name: '', value: '' }])}><Icon name="plus" size={14} /> Adicionar cabeçalho</button>
            )}
          </section>
          {verify?.saveError && <p className="form-error">{verify.saveError}</p>}
          <footer className="conn-modal-foot">
            <button type="button" className="btn" onClick={() => setStep('form')}>Voltar</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? (oauthNeeded && authMode === 'oauth_now' ? 'Aguardando login…' : 'Salvando…') : 'Concluir'}</button>
          </footer>
        </>
      )}
    </Dialog>
  );
}
