import { useEffect, useState } from 'react';
import { useApp } from '../app.jsx';
import { WhatsappWebPanel } from '../whatsappWeb.jsx';
import { api } from '../lib.js';
import { Icon, Switch, Select, Segmented } from '../ui.jsx';
import { isEnterpriseMode } from '../uiMode.js';
import { EnterpriseHint } from '../uiModeToggle.jsx';
import { Card, Row } from './shared.jsx';

const MAIL_PROVIDERS = [
  { id: 'gmail', label: 'Gmail', domain: 'gmail.com', appPass: 'https://myaccount.google.com/apppasswords' },
  { id: 'outlook', label: 'Outlook / Hotmail', domain: 'outlook.com', appPass: 'https://account.live.com/proofs/AppPassword' },
  { id: 'icloud', label: 'iCloud', domain: 'icloud.com', appPass: 'https://account.apple.com/account/manage' },
  { id: 'yahoo', label: 'Yahoo', domain: 'yahoo.com', appPass: 'https://login.yahoo.com/myaccount/security/app-password' },
  { id: 'other', label: 'Outro (IMAP)', domain: '' }
];
const providerOf = user => {
  const d = String(user || '').split('@')[1] || '';
  return /gmail|googlemail/.test(d) ? 'gmail' : /outlook|hotmail|live/.test(d) ? 'outlook' : /icloud|me\.com/.test(d) ? 'icloud' : /yahoo/.test(d) ? 'yahoo' : d ? 'other' : null;
};

function EmailCard({ s, set, toast }) {
  const e = s.email || {};
  const setE = patch => set('email', { ...e, ...patch });
  const [pick, setPick] = useState(() => providerOf(e.user));
  const [testing, setTesting] = useState(false);
  const [gmailClaude, setGmailClaude] = useState(null);
  const prov = MAIL_PROVIDERS.find(p => p.id === pick);
  useEffect(() => {
    if (pick !== 'gmail') return;
    api('/api/claude/connectors').then(r => setGmailClaude((r.connectors || []).some(c => /gmail/i.test(c.name) && c.status === 'connected'))).catch(() => setGmailClaude(false));
  }, [pick]);
  async function test() {
    setTesting(true);
    try { const r = await api('/api/email/test', { method: 'POST', body: e }); toast(`Conectado (${r.imapHost})`); setE({ enabled: true }); }
    catch (err) { toast(err.message, 'error'); }
    finally { setTesting(false); }
  }
  return (
    <Card title="E-mail" desc="Os agentes leem, resumem e respondem seus e-mails. Nada é copiado: eles consultam a caixa na hora. Todo envio espera a sua aprovação na Caixa.">
      <div className="mail-providers" role="radiogroup" aria-label="Seu e-mail">
        {MAIL_PROVIDERS.map(p => (
          <button key={p.id} type="button" role="radio" aria-checked={pick === p.id} className={`pill ${pick === p.id ? 'on' : ''}`} onClick={() => setPick(p.id)}>{p.label}</button>
        ))}
      </div>
      {pick === 'gmail' && (
        <Row title="Entrar com Google" desc={gmailClaude ? 'O Gmail já está conectado na sua conta Claude: os agentes já podem usar. Nada mais a fazer.' : 'Sem senha: conecte o Gmail na sua conta Claude (login Google) e os agentes passam a usar.'}>
          {gmailClaude ? <span className="tag ok">Conectado</span>
            : <a className="btn btn-sm btn-primary" href="https://claude.ai/settings/connectors" target="_blank" rel="noreferrer"><Icon name="plug" size={14} />Conectar Gmail</a>}
        </Row>
      )}
      {prov && <>
        {pick === 'gmail' && <p className="muted small">Ou, se preferir, com senha de app:</p>}
        <Row title="Seu e-mail"><input className="input" type="email" autoComplete="off" value={e.user || ''} onChange={ev => setE({ user: ev.target.value })} placeholder={prov.domain ? `voce@${prov.domain}` : 'voce@empresa.com.br'} /></Row>
        <Row title={prov.appPass ? 'Senha de app' : 'Senha'} desc={prov.appPass ? `É uma senha só para o Ripper, gerada no ${prov.label}. A sua senha normal não funciona aqui.` : 'A senha do e-mail (ou senha de app, se o provedor exigir).'}>
          <div className="row">
            <input className="input grow" type="password" autoComplete="new-password" value={e.pass || ''} onChange={ev => setE({ pass: ev.target.value })} placeholder="••••••••" />
            {prov.appPass && <a className="btn btn-sm" href={prov.appPass} target="_blank" rel="noreferrer">Gerar senha</a>}
          </div>
        </Row>
        {pick === 'other' && <>
          <Row title="Servidor IMAP (ler)"><input className="input" value={e.imapHost || ''} onChange={ev => setE({ imapHost: ev.target.value })} placeholder={(e.user || '').includes('@') ? `imap.${e.user.split('@')[1]}` : 'imap.seudominio.com'} /></Row>
          <Row title="Servidor SMTP (enviar)"><input className="input" value={e.smtpHost || ''} onChange={ev => setE({ smtpHost: ev.target.value })} placeholder={(e.user || '').includes('@') ? `smtp.${e.user.split('@')[1]}` : 'smtp.seudominio.com'} /></Row>
        </>}
        <Row title={e.enabled ? 'Conectado' : 'Conectar'} desc={e.enabled ? 'Os agentes já usam este e-mail.' : 'Confere o acesso e liga o e-mail. Depois é só salvar.'}>
          <div className="row">
            <button type="button" className="btn btn-sm btn-primary" disabled={!e.user || !e.pass || testing} onClick={test}><Icon name="plug" size={14} />{testing ? 'Conectando…' : e.enabled ? 'Testar de novo' : 'Conectar'}</button>
            {e.enabled && <button type="button" className="btn btn-sm" onClick={() => setE({ enabled: false })}>Desligar</button>}
          </div>
        </Row>
      </>}
    </Card>
  );
}

function GithubCard({ s, toast, refresh }) {
  const g = s.github || {};
  const [token, setToken] = useState(g.token || '');
  const [repos, setRepos] = useState((g.repos || []).join('\n'));
  const [busy, setBusy] = useState(false);
  const { S } = useApp();
  const guardian = S.agents.find(a => a.id === g.agentId);
  async function create() {
    setBusy(true);
    try {
      await api('/api/settings', { method: 'PUT', body: { github: { token, repos: repos.split(/[\s,]+/).filter(Boolean) } } });
      const r = await api('/api/github/guardian', { method: 'POST' });
      toast(`Guardião ativo como ${r.login} em ${r.repos.length} repositório(s)`);
      refresh();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }
  return (
    <Card title="GitHub — Guardião" desc="Um agente vigia seus repositórios: revisa cada PR, investiga CI quebrado, organiza issues e delega correções aos colegas. Ele consulta o GitHub a cada 5 minutos (não precisa expor o Ripper). Comentar ou abrir issue sempre pede a sua aprovação.">
      <Row title="Token do GitHub" desc="Token fine-grained com leitura de código, PRs, issues e Actions, e escrita em PRs e issues.">
        <div className="row">
          <input className="input grow" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="github_pat_…" />
          <a className="btn btn-sm" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Criar token</a>
        </div>
      </Row>
      <Row title="Repositórios" desc="Um por linha: dono/repositório ou o link." stack>
        <textarea className="input" rows={3} value={repos} onChange={e => setRepos(e.target.value)} placeholder="minha-empresa/site&#10;https://github.com/minha-empresa/api" />
      </Row>
      <Row title={guardian ? 'Guardião ativo' : 'Ativar'} desc={guardian
        ? (g.lastError ? `Última consulta falhou: ${g.lastError}` : g.lastCheck ? `Última consulta: ${new Date(g.lastCheck).toLocaleString('pt-BR')}` : 'A primeira consulta sai em até 5 minutos.')
        : 'Confere o token e o acesso aos repositórios e cria o agente Guardião com a rotina de eventos.'}>
        <div className="row">
          <button type="button" className="btn btn-sm btn-primary" disabled={!token || !repos.trim() || busy} onClick={create}><Icon name="plug" size={14} />{busy ? 'Conferindo…' : guardian ? 'Atualizar' : 'Criar o Guardião'}</button>
          {guardian && <a className="btn btn-sm" href={`#/agents/${guardian.id}/settings`}>Ver agente</a>}
        </div>
      </Row>
    </Card>
  );
}

export default function ChannelsSection({ s, set }) {
  const { S, refresh, toast } = useApp();
  const enterprise = isEnterpriseMode(S.settings);
  const [waMode, setWaMode] = useState(() => (S.settings.whatsappWeb?.agentId || !S.settings.whatsapp?.agentId ? 'qr' : 'api'));
  const w = s.whatsapp || {};
  const setW = (k, v) => set('whatsapp', { ...w, [k]: v });
  const hook = `${location.origin}/api/channels/whatsapp/webhook`;
  return (
    <>
      <EmailCard s={s} set={set} toast={toast} />
      <GithubCard s={s} toast={toast} refresh={refresh} />
      {!enterprise && <p className="muted small"><EnterpriseHint>O WhatsApp (atender clientes, receber recados e o resumo diário) fica no modo Enterprise.</EnterpriseHint></p>}
      {enterprise && (
        <Card title="Canal WhatsApp" desc="Um agente responde quem escreve no seu WhatsApp. A conversa fica no WhatsApp; o que precisar de você chega na Caixa.">
          <Segmented label="Tipo de conexão" value={waMode} onChange={setWaMode} size="sm" className="wa-mode"
            items={[['api', 'API oficial (Meta)'], ['qr', 'WhatsApp Web (QR)']]} />
          {waMode === 'qr' ? <WhatsappWebPanel w={s.whatsappWeb || {}} setW={(k, v) => set('whatsappWeb', { ...(s.whatsappWeb || {}), [k]: v })} Row={Row} /> : <>
          <Row title="Ativar canal" desc="Desligado, o webhook responde 404 e nada é enviado.">
            <Switch checked={!!w.enabled} onChange={v => setW('enabled', v)} label="Ativar canal WhatsApp" />
          </Row>
          <Row title="Agente que responde" desc="Prefira um agente sem computador: quem escreve é gente de fora.">
            <Select label="Agente do WhatsApp" value={w.agentId || ''} onChange={v => setW('agentId', v)} options={S.agents.map(a => ({ value: a.id, label: a.name }))} />
          </Row>
          <Row title="Phone number ID" desc="No painel da Meta: WhatsApp → Configuração da API."><input className="input" value={w.phoneNumberId || ''} onChange={e => setW('phoneNumberId', e.target.value)} placeholder="123456789012345" /></Row>
          <Row title="Token de acesso" desc="Token permanente de um usuário do sistema."><input className="input" type="password" autoComplete="off" value={w.accessToken || ''} onChange={e => setW('accessToken', e.target.value)} placeholder="EAAG…" /></Row>
          <Row title="App secret" desc="Configurações do app → Básico. Usado para conferir a assinatura de cada webhook."><input className="input" type="password" autoComplete="off" value={w.appSecret || ''} onChange={e => setW('appSecret', e.target.value)} /></Row>
          <Row title="Token de verificação" desc="Você inventa; cole o mesmo valor na Meta."><input className="input" value={w.verifyToken || ''} onChange={e => setW('verifyToken', e.target.value)} placeholder="uma-frase-secreta" /></Row>
          <Row title="URL do webhook" desc="Cole na Meta (assine o campo messages). Precisa ser HTTPS público: use um túnel (Cloudflare Tunnel, ngrok) apontando para esta porta." stack>
            <div className="row"><code className="mono small grow">{hook}</code><button type="button" className="btn btn-sm" onClick={() => { navigator.clipboard.writeText(hook); toast('URL copiada'); }}><Icon name="copy" size={14} />Copiar</button></div>
          </Row>
          </>}
        </Card>
      )}
    </>
  );
}
