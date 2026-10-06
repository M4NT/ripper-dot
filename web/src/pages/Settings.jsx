import { useEffect, useState, useRef } from 'react';
import { MetalBadge } from 'metal-fx';
import { useApp } from '../app.jsx';
import { useOv } from '../overlay.jsx';
import { WhatsappWebPanel } from '../whatsappWeb.jsx';
import { api, apiUpload, go, useDark, brandLogoSrc, TONES, FORMALITIES, useRoute } from '../lib.js';
import { Icon, Switch, Select, EmptyState, Segmented, useConfirm } from '../ui.jsx';
import { AdvancedBlock, HelpTip } from '../disclosure.jsx';
import { ApprovalHistory } from '../approvals.jsx';
import { MODEL_DESC, EffortScale, EFFORTS } from '../modelPicker.jsx';
import { PROVIDERS, ProviderGrid, ProviderHeader } from '../providersCatalog.jsx';
import SettingsSearch from '../settingsSearch.jsx';

const EFFORT_CAPS = EFFORTS.filter(([k]) => k !== 'auto');
import { useSettingsDraft } from '../settingsForm.js';
import UiModeToggle from '../uiModeToggle.jsx';
import { isEnterpriseMode, isSettingsTabAllowed } from '../uiMode.js';
import { useT, settingsTabs } from '../i18n/index.jsx';

export function SaveBar({ dirty, saving, save, reset }) {
  const tr = useT();
  if (!dirty) return null;
  return (
    <div className="save-bar" role="region" aria-label={tr('settings.unsavedRegion')}>
      <span>{tr('settings.unsaved')}</span>
      <button className="btn" onClick={reset}>{tr('common.discard')}</button>
      <button className="btn btn-primary" disabled={saving} onClick={() => save()}>{saving ? tr('common.saving') : tr('common.save')}</button>
    </div>
  );
}

function DataBackup({ s, set }) {
  const { refresh, toast } = useApp();
  const ov = useOv();
  const [auto, setAuto] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [busy, setBusy] = useState('');
  const fileRef = useRef(null);
  const reloadList = () => api('/api/backup/list').then(r => {
    setAuto(r.auto || []);
    setSnapshots(r.snapshots || []);
  }).catch(() => { setAuto([]); setSnapshots([]); });
  useEffect(() => { reloadList(); }, []);
  const download = async () => {
    setBusy('export');
    try {
      const snap = await api('/api/data/backup');
      const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ripper-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Backup JSON baixado (sensível — só db.json)');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(''); }
  };
  const createSnapshot = async () => {
    setBusy('snapshot');
    try {
      await api('/api/backup', { method: 'POST' });
      await reloadList();
      toast('Snapshot completo gravado em RIPPER_DATA/backups');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(''); }
  };
  const restoreSnapshot = async id => {
    if (!(await ov.confirm({ title: 'Restaurar este snapshot?', body: 'Isso sobrescreve os dados vivos em RIPPER_DATA (db.json, SQLite, sandbox, etc.).', action: 'Restaurar', danger: true }))) return;
    setBusy(`restore-${id}`);
    try {
      await api('/api/backup/restore', { method: 'POST', body: { confirm: true, id } });
      await refresh();
      await reloadList();
      toast('Dados restaurados a partir do snapshot');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(''); }
  };
  const restoreJson = async file => {
    if (!file) return;
    setBusy('import');
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      await api('/api/data/restore', { method: 'POST', body: { confirm: true, backup } });
      await refresh();
      toast('db.json restaurado (SQLite e pastas não mudam)');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  };
  const backup = s.backup || { enabled: true, intervalHours: 24, keepCount: 7 };
  return (
    <>
      <Card title="Snapshot completo (RIPPER_DATA)" desc="Arquivo .tar.gz em RIPPER_DATA/backups com db.json, usage/julia SQLite, sandbox e anexos. Restaurar substitui os dados vivos — pare outros processos Ripper no mesmo diretório.">
        <Row title="Backup manual">
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={createSnapshot} aria-busy={busy === 'snapshot'}>{busy === 'snapshot' ? 'Criando…' : 'Criar snapshot agora'}</button>
        </Row>
        <Row title="Agendamento" desc="Snapshots automáticos na pasta backups/; os mais antigos são removidos conforme manter abaixo.">
          <Switch checked={!!backup.enabled} onChange={v => set('backup', { ...backup, enabled: v })} label="Backup automático" />
        </Row>
        {backup.enabled && <>
          <Row title="Intervalo"><div className="input-unit"><input className="input" type="number" min={1} max={168} value={backup.intervalHours ?? 24} onChange={e => set('backup', { ...backup, intervalHours: +e.target.value })} /><span>horas</span></div></Row>
          <Row title="Manter no disco"><div className="input-unit"><input className="input" type="number" min={1} max={50} value={backup.keepCount ?? 7} onChange={e => set('backup', { ...backup, keepCount: +e.target.value })} /><span>snapshots</span></div></Row>
          <Row title="Cópia extra em outra pasta" desc="Recomendado: uma pasta sincronizada (OneDrive, Google Drive, Dropbox) ou um disco externo. Assim, se este disco falhar, o backup não vai junto. Caminho completo; deixe vazio para não copiar." stack>
            <input className="input" value={backup.copyTo || ''} onChange={e => set('backup', { ...backup, copyTo: e.target.value })} placeholder="Ex.: C:\Users\voce\OneDrive\Ripper-backups" aria-label="Pasta da cópia extra" />
          </Row>
        </>}
        <Row title="Último backup">{snapshots[0] ? <span>{new Date(snapshots[0].createdAt).toLocaleString('pt-BR')} · {(snapshots[0].bytes / 1048576).toFixed(1).replace('.', ',')} MB</span> : <span className="tag tag-warn">nenhum ainda</span>}</Row>
        {snapshots.length > 0 && (
          <Row title="Snapshots no servidor" stack>
            <ul className="rows flat">
              {snapshots.map(row => (
                <li key={row.id} className="row-item">
                  <div className="row-main"><b className="mono small">{row.fileName}</b><small>{new Date(row.createdAt).toLocaleString()} · {(row.bytes / 1024).toFixed(1)} KB</small></div>
                  <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => restoreSnapshot(row.id)} aria-busy={busy === `restore-${row.id}`}>Restaurar</button>
                </li>
              ))}
            </ul>
          </Row>
        )}
      </Card>
      <Card title="Exportar só db.json" desc="JSON leve (agentes, chats, configurações). Não inclui usage.sqlite nem arquivos em sandbox/.">
        <Row title="Download JSON">
          <button type="button" className="btn" disabled={!!busy} onClick={download} aria-busy={busy === 'export'}>{busy === 'export' ? 'Gerando…' : 'Baixar JSON'}</button>
        </Row>
        <Row title="Restaurar JSON" desc="Grava db.pre-restore.*.backup.json antes de substituir só o db.json." tip="Substitui conversas e configurações atuais. Guarde o JSON em lugar seguro.">
          <div className="row">
            <input ref={fileRef} type="file" hidden accept="application/json,.json" onChange={e => restoreJson(e.target.files?.[0])} />
            <button type="button" className="btn" disabled={!!busy} onClick={() => fileRef.current?.click()} aria-busy={busy === 'import'}><Icon name="upload" size={16} />{busy === 'import' ? 'Restaurando…' : 'Escolher arquivo…'}</button>
          </div>
        </Row>
        {auto?.length > 0 && (
          <Row title="Backups automáticos de db.json" desc="Migração de schema ou antes de restaurar." stack>
            <ul className="rows flat">{auto.map(n => <li key={n} className="row-item"><div className="row-main"><b className="mono small">{n}</b></div></li>)}</ul>
          </Row>
        )}
      </Card>
    </>
  );
}

/** Notificações no celular (Web Push) para aprovações e avisos da Caixa. */
function PushCard() {
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const usable = supported && window.isSecureContext;
  const [status, setStatus] = useState(!supported ? 'Este navegador não suporta notificações.' : !usable ? 'Precisa de HTTPS para funcionar aqui.' : '');
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!usable) return;
    navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).then(sub => {
      const ok = !!sub && Notification.permission === 'granted';
      setOn(ok);
      setStatus(ok ? 'Ativadas neste aparelho.' : Notification.permission === 'denied' ? 'Bloqueadas no navegador. Libere nas permissões do site.' : 'Desativadas neste aparelho.');
    }).catch(() => {});
  }, []);
  const enable = async () => {
    try {
      if (await Notification.requestPermission() !== 'granted') return setStatus('Permissão negada. Libere nas permissões do site.');
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await api('/api/push/key');
      const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
      setOn(true); setStatus('Ativadas neste aparelho.');
    } catch (e) { setStatus(`Não deu para ativar: ${e.message}`); }
  };
  const disable = async () => {
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) { await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
      setOn(false); setStatus('Desativadas neste aparelho.');
    } catch (e) { setStatus(e.message); }
  };
  const test = () => api('/api/push/test', { method: 'POST' }).then(() => setStatus('Teste enviado. Deve chegar em segundos.'), e => setStatus(e.message));
  return (
    <Card title="Notificações neste aparelho" desc="Avisa quando um agente precisa da sua aprovação, quando há alerta do sistema ou quando um limite de uso é atingido.">
      <Row title="Notificações" desc={status}>
        {usable && (on
          ? <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-sm" onClick={test}>Enviar teste</button><button className="btn btn-sm" onClick={disable}>Desativar</button></div>
          : <button className="btn btn-sm btn-primary" onClick={enable}>Ativar</button>)}
      </Row>
      <small style={{ opacity: 0.7 }}>No celular, abra o Ripper por um endereço HTTPS (ou instale a partir dele): por http num IP da rede local não funciona. No computador, localhost funciona. No iPhone, adicione à tela inicial antes.</small>
    </Card>
  );
}

/** Celular na mesma rede: liga o acesso pelo Wi-Fi, mostra o QR de pareamento e lista os aparelhos. */
function DevicesCard() {
  const [st, setSt] = useState(null);
  const [qr, setQr] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api('/api/pair').then(setSt, e => setErr(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!qr) return;
    const t = setTimeout(() => setQr(null), qr.expiresAt - Date.now());
    return () => clearTimeout(t);
  }, [qr]);
  const run = p => p.then(() => setErr(''), e => setErr(e.message));
  const toggleLan = on => run(api('/api/pair/lan', { method: 'POST', body: { on } }).then(() => { if (!on) setQr(null); return load(); }));
  const newQr = () => run(api('/api/pair/invite', { method: 'POST' }).then(setQr));
  const drop = id => run(api(`/api/pair/devices/${id}`, { method: 'DELETE' }).then(load));
  if (!st) return null;
  const { lan, devices, local } = st;
  return (
    <Card title="Celular na mesma rede" desc="Abra o Ripper no celular pelo Wi-Fi de casa, sem digitar senha: gere o QR Code aqui e aponte a câmera.">
      {local && (
        <Row title="Acesso pela rede Wi-Fi" desc={lan.fixed ? 'Aberto pela variável HOST.' : lan.error || (lan.on ? `Aberto em ${lan.address}.` : 'Desligado: só este computador acessa.')}>
          {!lan.fixed && <button className={`btn btn-sm ${lan.on ? '' : 'btn-primary'}`} onClick={() => toggleLan(!lan.on)}>{lan.on ? 'Desligar' : 'Ligar'}</button>}
        </Row>
      )}
      {local && lan.on && (
        <Row title="Parear um celular" desc={qr ? `Vale por 10 minutos e uma só vez. Gerar outro cancela este.` : 'O convite expira em 10 minutos.'} stack={!!qr}>
          {qr
            ? <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
                <div style={{ width: 220, background: '#fff', borderRadius: 8 }} role="img" aria-label="QR Code de pareamento" dangerouslySetInnerHTML={{ __html: qr.svg }} />
                <button className="btn btn-sm" onClick={newQr}>Gerar outro</button>
              </div>
            : <button className="btn btn-sm btn-primary" onClick={newQr}>Mostrar QR Code</button>}
        </Row>
      )}
      <Row title="Aparelhos pareados" desc={devices.length ? null : 'Nenhum ainda.'} stack={devices.length > 0}>
        {devices.length > 0 && (
          <ul className="rows flat">{devices.map(d => (
            <li key={d.id} className="row-item">
              <div className="row-main"><b>{d.name}</b><small className="muted"> · pareado em {new Date(d.createdAt).toLocaleDateString()}</small></div>
              <button className="btn btn-sm" onClick={() => drop(d.id)}>Desconectar este aparelho</button>
            </li>
          ))}</ul>
        )}
      </Row>
      {err && <small className="error">{err}</small>}
      <small style={{ opacity: 0.7 }}>Na mesma rede a conexão é direta, por http. Fora de casa e cifrado de ponta a ponta vem numa próxima versão.</small>
    </Card>
  );
}

/** Linha de configuração: rótulo e explicação à esquerda, controle à direita. */
function Row({ title, desc, children, stack, tip }) {
  return (
    <div className={`set-row ${stack ? 'stack' : ''}`}>
      <div className="set-label"><b>{title}</b>{tip && <HelpTip text={tip} />}{desc && <small>{desc}</small>}</div>
      <div className="set-control">{children}</div>
    </div>
  );
}
/** Contas do Claude por assinatura: botões lado a lado (como "Como conectar"); clicar troca na hora. */
function ClaudeAccountsCard({ s, set, S }) {
  const { refresh, toast } = useApp();
  const [rows, setRows] = useState(null);
  const [info, setInfo] = useState({}); // id → { ok, email, plan, error }
  const [adding, setAdding] = useState(null); // nome da conta nova sendo digitado
  const [busy, setBusy] = useState('');
  const [manage, setManage] = useState(false);
  const saved = S.settings.claude || {};
  const current = saved.defaultAccount || 'principal';
  const accounts = [{ id: 'principal', label: 'Conta pessoal' }, ...(saved.accounts || [])];

  const load = () => api('/api/claude/accounts').then(r => {
    setRows(r);
    for (const a of r) if (a.loggedIn && !info[a.id]) api(`/api/claude/accounts/${a.id}/test`, { method: 'POST' }).then(x => setInfo(i => ({ ...i, [a.id]: x }))).catch(() => {});
  }).catch(() => setRows([]));
  useEffect(() => { load(); }, [saved.accounts?.length]);

  // Salva já (sem esperar o "Salvar alterações") e mantém o rascunho da tela igual ao salvo.
  async function saveClaude(patch) {
    const next = { ...saved, ...patch };
    const r = await api('/api/settings', { method: 'PUT', body: { claude: next } });
    set('claude', r.claude); // rascunho = salvo (ids das contas vêm do servidor)
    await refresh();
  }
  async function login(id) {
    const r = await api(`/api/claude/accounts/${id}/login`, { method: 'POST' });
    toast(r.opened ? 'Abri um terminal: faça o login lá. Depois clique na conta de novo.' : `Rode no terminal: ${r.command}`);
  }
  async function choose(id) {
    if (id === current) return;
    const row = rows?.find(r => r.id === id);
    setBusy(id);
    try {
      if (!row?.loggedIn) return await login(id);
      await saveClaude({ defaultAccount: id });
      toast(`Agora o Ripper usa a conta "${accounts.find(a => a.id === id)?.label}".`);
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(''); }
  }
  async function add() {
    const label = (adding || '').trim();
    if (!label) return;
    setBusy('add');
    try {
      await saveClaude({ accounts: [...(saved.accounts || []), { label }] });
      const r = await api('/api/claude/accounts');
      setRows(r); setAdding(null);
      const created = r.find(a => a.label === label);
      if (created) await login(created.id);
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(''); }
  }
  async function remove(id) {
    try { await saveClaude({ accounts: saved.accounts.filter(a => a.id !== id), defaultAccount: current === id ? 'principal' : current }); }
    catch (e) { toast(e.message, 'error'); }
  }
  const sub = id => {
    const r = rows?.find(x => x.id === id), t = info[id];
    if (r?.limitedUntil) return `no limite até ${new Date(r.limitedUntil).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    if (busy === id) return 'abrindo…';
    if (t?.ok) return [t.plan, t.email].filter(Boolean).join(' · ');
    return r?.loggedIn ? 'conectada' : 'clique para fazer login';
  };

  return (
    <Card title="Conta do Claude" desc="Qual assinatura o Ripper usa. Clique para trocar; conta nova pede login uma vez.">
      <div className="seg-choice claude-accs" style={{ gridTemplateColumns: `repeat(${Math.min(accounts.length + 1, 4)}, 1fr)` }}>
        {accounts.map(a => (
          <button key={a.id} type="button" className={current === a.id ? 'on' : ''} aria-pressed={current === a.id} onClick={() => choose(a.id)} disabled={!!busy}>
            <b>{a.label}</b><small>{sub(a.id)}</small>
          </button>
        ))}
        {adding === null
          ? <button type="button" onClick={() => setAdding(accounts.some(a => /teams/i.test(a.label)) ? '' : 'Teams')} disabled={!!busy}><b>+ Adicionar</b><small>outra conta (ex.: Teams)</small></button>
          : <form className="claude-acc-new" onSubmit={e => { e.preventDefault(); add(); }}>
              <input className="input" autoFocus value={adding} maxLength={40} onChange={e => setAdding(e.target.value)} placeholder="Nome da conta" aria-label="Nome da conta nova" />
              <small className="muted" role="note">Assinatura pessoal (Pro/Max) costuma ser para uso de uma pessoa: atender clientes ou dividir pode contrariar os termos do provedor. Conta da empresa (Teams, Enterprise) só com autorização de quem a administra. Não use a conta de outra pessoa. A responsabilidade pelos termos de cada provedor é sua.</small>
              <div className="row"><button type="submit" className="btn btn-sm btn-primary" disabled={!adding.trim() || busy === 'add'}>Adicionar e entrar</button><button type="button" className="btn btn-sm" onClick={() => setAdding(null)}>Cancelar</button></div>
            </form>}
      </div>
      <Row title="Trocar sozinho no limite" desc="Se a conta em uso bater o limite, o Ripper continua pela outra e avisa no chat.">
        <Switch checked={saved.autoSwitch !== false} onChange={v => saveClaude({ autoSwitch: v }).catch(e => toast(e.message, 'error'))} label="Trocar sozinho no limite" />
      </Row>
      <button type="button" className="btn btn-sm claude-acc-manage" onClick={() => setManage(m => !m)} aria-expanded={manage}>{manage ? 'Fechar' : 'Gerenciar contas'}</button>
      {manage && (
        <ul className="rows flat">
          {accounts.map(a => (
            <li key={a.id} className="row-item">
              <div className="row-main"><b>{a.label}</b><small>{info[a.id]?.error || sub(a.id)}{rows?.find(r => r.id === a.id)?.agents?.length ? ` · usada por ${rows.find(r => r.id === a.id).agents.join(', ')}` : ''}</small></div>
              <div className="row">
                <button type="button" className="btn btn-sm" onClick={() => login(a.id).catch(e => toast(e.message, 'error'))}>Trocar login</button>
                {a.id !== 'principal' && <button type="button" className="btn btn-sm" onClick={() => remove(a.id)}>Remover</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const PAID_BODY = 'O Ripper funciona pela sua assinatura (Claude, ChatGPT) sem custo extra. Com o uso pago ativado, cada resposta de um modelo pago (OpenRouter, OpenAI, Gemini ou Claude por chave de API) é cobrada em dólar na conta do provedor, inclusive o que os agentes fizerem sozinhos (rotinas, WhatsApp). Os limites diários abaixo pausam o gasto quando atingidos.';

/** Uso pago: consentimento explícito, limites diários e o gasto de hoje. Sem consentimento, modelo pago não roda. */
function PaidUsageCard({ s, set, S }) {
  const [confirm, confirmNode] = useConfirm();
  const b = s.billing || {};
  const on = !!S.settings.billing?.paidConsentAt;
  const pending = b.paidConsent === true && !on;
  const spent = S.paidSpend?.total || 0;
  const usd = n => `US$ ${(+n || 0).toFixed(2).replace('.', ',')}`;
  async function enable() {
    if (await confirm({ title: 'Ativar uso pago?', body: `${PAID_BODY} Você pode desativar quando quiser.`, action: 'Entendo, ativar uso pago', danger: true })) set('billing', { ...b, paidConsent: true });
  }
  return (
    <Card title="Uso pago" badge={on ? <span className="tag tag-warn">ativo · gasta créditos</span> : pending ? <span className="tag tag-warn">salve para ativar</span> : <span className="tag tag-ok">desligado · só assinatura</span>}>
      <div className={`paid-box ${on ? 'is-on' : ''}`} role="note">
        <Icon name="bolt" size={18} />
        <p><b>{on ? 'Os agentes podem gastar dinheiro.' : 'Isto gasta dinheiro.'}</b> {PAID_BODY}</p>
      </div>
      {on && <Row title="Gasto pago de hoje" desc={`Desde ${new Date(S.settings.billing.paidConsentAt).toLocaleDateString('pt-BR')} com uso pago ativo. Zera à meia-noite.`}><b className="mono">{usd(spent)} de {usd(b.totalDailyUsd ?? 10)}</b></Row>}
      <Row title="Limite por agente, por dia" desc="Ao atingir, o agente para de usar modelos pagos até amanhã e você recebe um aviso na Caixa.">
        <div className="input-unit"><span>US$</span><input className="input" type="number" min={0} step={0.5} value={b.perAgentDailyUsd ?? 2} onChange={e => set('billing', { ...b, perAgentDailyUsd: e.target.value })} aria-label="Limite diário por agente em dólares" /></div>
      </Row>
      <Row title="Limite de todos os agentes, por dia">
        <div className="input-unit"><span>US$</span><input className="input" type="number" min={0} step={1} value={b.totalDailyUsd ?? 10} onChange={e => set('billing', { ...b, totalDailyUsd: e.target.value })} aria-label="Limite diário total em dólares" /></div>
      </Row>
      <div className="row">
        {on || pending
          ? <button type="button" className="btn" onClick={() => set('billing', { ...b, paidConsent: false })}>Desativar uso pago</button>
          : <button type="button" className="btn btn-danger" onClick={enable}>Ativar uso pago…</button>}
      </div>
      {confirmNode}
    </Card>
  );
}

/** Provedores compatíveis com OpenAI: OpenRouter, OpenAI, Gemini (chave) e Ollama (local, endereço). */
const COMPAT_UI = {
  openrouter: { title: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys', keyHost: 'openrouter.ai/keys', ph: 'sk-or-…', search: 'gpt, gemini, deepseek, llama…',
    desc: 'Uma chave só para usar GPT, Gemini, DeepSeek, Llama e centenas de outros modelos, com as ferramentas do Ripper (computador, navegador, memória). Pago por uso na sua conta do OpenRouter.' },
  openai: { title: 'OpenAI API', keyUrl: 'https://platform.openai.com/api-keys', keyHost: 'platform.openai.com/api-keys', ph: 'sk-…', search: 'gpt-5, gpt-4.1, o4…',
    desc: 'GPT direto pela chave da OpenAI, com as ferramentas do Ripper. Pago por uso na sua conta da OpenAI (o custo aqui é estimado pelos tokens).' },
  gemini: { title: 'Gemini', keyUrl: 'https://aistudio.google.com/apikey', keyHost: 'aistudio.google.com/apikey', ph: 'AIza…', search: 'flash, pro…',
    desc: 'Modelos Gemini pela chave do Google AI Studio (os mesmos do Antigravity), com as ferramentas do Ripper. O AI Studio tem cota grátis; acima dela, pago por uso (custo estimado pelos tokens).' },
  ollama: { title: 'Ollama', local: true, search: 'llama, qwen, deepseek…',
    desc: 'Modelos rodando nesta máquina: grátis, offline e nada sai do computador. Instale em ollama.com, baixe um modelo (ex.: ollama pull qwen3) e adicione aqui. Prefira modelos que aceitam ferramentas (qwen3, llama3.1+, mistral).' }
};

function OpenRouterCard({ s, set, prov = 'openrouter' }) {
  const ui = COMPAT_UI[prov];
  const or = s[prov] || { apiKey: '', models: [], url: '' };
  const [check, setCheck] = useState(null); // null | 'testing' | { ok, error, usage }
  const [catalog, setCatalog] = useState(null);
  const [q, setQ] = useState('');
  const setOr = patch => set(prov, { ...or, ...patch });
  const connected = ui.local || !!or.apiKey;
  async function test() {
    setCheck('testing');
    try { setCheck(await api(`/api/providers/${prov}/test`, { method: 'POST', body: { apiKey: or.apiKey, url: or.url } })); }
    catch (e) { setCheck({ ok: false, error: e.message }); }
  }
  async function openCatalog() {
    try { setCatalog(await api(`/api/providers/${prov}/models`)); } catch (e) { setCheck({ ok: false, error: e.message }); }
  }
  const chosen = new Set(or.models.map(m => m.id));
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const found = (catalog || []).filter(m => m.tools && !chosen.has(m.id) && words.every(w => `${m.id} ${m.label}`.toLowerCase().includes(w))).slice(0, 30);
  const price = n => (n < 1 ? n.toFixed(2) : n.toFixed(1)).replace('.', ',');
  const status = check === 'testing' ? <span className="tag" role="status">Testando…</span>
    : check?.ok ? <span className="tag tag-ok">conectado</span>
    : check ? <span className="tag tag-warn">{check.error}</span>
    : ui.local ? <span className="tag">local</span> : or.apiKey ? <span className="tag">chave salva</span> : <span className="tag">não conectado</span>;
  return (
    <Card title={ui.title} badge={status} desc={ui.desc}>
      {!ui.local && !s.billing?.paidConsentAt && <p className="paid-inline"><Icon name="bolt" size={14} />Os modelos do {ui.title} só respondem com o uso pago ativado (acima).</p>}
      {ui.local ? (
        <Row title="Endereço do Ollama" desc="Padrão desta máquina. Mude só se o Ollama roda em outro computador da rede.">
          <div className="row">
            <input className="input" value={or.url || 'http://127.0.0.1:11434'} onChange={e => { setOr({ url: e.target.value }); setCheck(null); }} aria-label="Endereço do Ollama" />
            <button type="button" className="btn" disabled={check === 'testing'} onClick={test}>Testar</button>
          </div>
        </Row>
      ) : (
        <Row title="Chave da API" desc={<>Crie em <a href={ui.keyUrl} target="_blank" rel="noopener">{ui.keyHost}</a>.</>}>
          <div className="row">
            <input className="input" type="password" autoComplete="off" value={or.apiKey} onChange={e => { setOr({ apiKey: e.target.value }); setCheck(null); }} placeholder={ui.ph} aria-label={`Chave do ${ui.title}`} />
            <button type="button" className="btn" disabled={!or.apiKey || check === 'testing'} onClick={test}>Testar</button>
          </div>
        </Row>
      )}
      {ui.local && <LocalModelPick onDone={m => !or.models.some(x => x.id === m.id) && setOr({ models: [...or.models, { id: m.id, label: m.label }] })} />}
      <Row title="Modelos em uso" desc="Aparecem no seletor de modelo das conversas e dos agentes depois de salvar." stack>
        {or.models.length ? (
          <ul className="rows flat">{or.models.map(m => (
            <li key={m.id} className="row-item">
              <div className="row-main"><b>{m.label}</b><small className="mono">{m.id}</small></div>
              <button type="button" className="btn btn-sm" onClick={() => setOr({ models: or.models.filter(x => x.id !== m.id) })}>Remover</button>
            </li>
          ))}</ul>
        ) : <p className="muted small">Nenhum ainda.</p>}
        {catalog ? (
          <div className="or-catalog">
            <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder={`Buscar: ${ui.search}`} aria-label={`Buscar modelo no ${ui.title}`} autoFocus />
            <ul className="rows flat">{found.map(m => (
              <li key={m.id} className="row-item">
                <div className="row-main"><b>{m.label}</b><small className="mono">{m.id}{m.priceIn > 0 ? ` · US$ ${price(m.priceIn)} / ${price(m.priceOut)} por milhão de tokens` : ui.local ? ' · grátis' : ''}</small></div>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setOr({ models: [...or.models, { id: m.id, label: m.label }] })}>Adicionar</button>
              </li>
            ))}</ul>
            {!found.length && <p className="muted small">{ui.local && !(catalog || []).length ? 'Nenhum modelo baixado. Rode, por exemplo: ollama pull qwen3' : 'Nada encontrado.'}</p>}
          </div>
        ) : <button type="button" className="btn" disabled={!connected} onClick={openCatalog}><Icon name="plus" size={16} />Adicionar modelos</button>}
      </Row>
    </Card>
  );
}

// Recomenda o melhor modelo local para este computador e baixa pelo Ollama com 1 clique.
function LocalModelPick({ onDone }) {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api('/api/local-models').then(setInfo, e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const pull = info?.pull;
  useEffect(() => {
    if (!pull?.running) { if (pull?.status === 'pronto') onDone(info.models.find(m => m.id === pull.model)); return; }
    const t = setTimeout(load, 1000); return () => clearTimeout(t);
  }, [pull?.running, pull?.pct, pull?.status]);
  if (!info) return err ? <p className="muted small">{err}</p> : null;
  const { hardware: hw, pick } = info;
  const desc = `${hw.ramGb} GB de RAM${hw.gpu ? ` · ${hw.gpu} (${hw.vramGb} GB)` : hw.appleSilicon ? ' · Apple Silicon' : ''}`;
  async function start() {
    setErr('');
    try { await api('/api/local-models/pull', { method: 'POST', body: { model: pick.id } }); load(); } catch (e) { setErr(e.message); }
  }
  return (
    <Row title="Modelo recomendado para este computador" desc={desc}>
      {!pick ? <p className="muted small">Este computador não tem memória para um modelo local útil.</p>
        : !info.ollama ? <p className="muted small">Instale o Ollama em <a href="https://ollama.com" target="_blank" rel="noopener">ollama.com</a> e abra-o; depois volte aqui.</p>
        : pull?.running ? <span className="tag" role="status">Baixando {pull.model}… {pull.pct ?? 0}%</span>
        : <div className="row"><b>{pick.label}</b><button type="button" className="btn btn-primary" onClick={start}>Baixar e usar</button></div>}
      {(err || pull?.error) && <p className="muted small">{err || pull.error}</p>}
    </Row>
  );
}

/** Versão do Ripper: confere se há nova, mostra as novidades e atualiza com um clique. */
function UpdateCard() {
  const { toast } = useApp();
  const [info, setInfo] = useState(null);
  const [checking, setChecking] = useState(false);
  const load = (check = false) => { setChecking(check); return api(`/api/update${check ? '?check=1' : ''}`).then(setInfo).catch(e => toast(e.message, 'error')).finally(() => setChecking(false)); };
  useEffect(() => { load(); }, []);
  // Enquanto atualiza, acompanha o passo; quando o servidor reinicia, recarrega a página
  useEffect(() => {
    if (!info?.applying || info.applying.done || info.applying.error) return;
    const t = setInterval(() => api('/api/update').then(setInfo).catch(() => { clearInterval(t); setTimeout(() => location.reload(), 4000); }), 2000);
    return () => clearInterval(t);
  }, [info?.applying?.step]);
  const apply = () => api('/api/update', { method: 'POST' }).then(r => setInfo(i => ({ ...i, ...r }))).catch(e => toast(e.message, 'error'));
  const a = info?.applying;
  return (
    <Card title="Versão do Ripper" desc={info?.reason === 'no-git' ? 'Esta instalação não veio do Git; atualize baixando a versão nova.' : info?.reason === 'offline' ? 'Não consegui conferir a versão oficial agora (sem internet ou sem acesso ao repositório).' : info?.current ? `Versão instalada: ${info.current}` : 'Conferindo…'}>
      {info?.available && <>
        <p className="small"><b>{info.behind} novidade{info.behind > 1 ? 's' : ''}</b> na versão nova:</p>
        <ul className="update-notes">{info.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      </>}
      {info?.current && !info.available && !a && <p className="small muted">Você está na versão mais recente.</p>}
      {a && <p className={`small ${a.error ? 'warn-text' : 'muted'}`}>{a.step}{!a.done && !a.error ? '…' : ''}</p>}
      <div className="row-actions">
        {info?.available && !a && <button className="btn btn-primary" onClick={apply}><Icon name="download" size={15} />Atualizar agora</button>}
        <button className="btn" disabled={checking || (a && !a.error && !a.done)} onClick={() => load(true)}>{checking ? 'Conferindo…' : 'Procurar versão nova'}</button>
      </div>
      {info?.available && !info.supervised && !a && <p className="small muted">O Ripper não está rodando como serviço: depois de atualizar, feche e abra de novo.</p>}
    </Card>
  );
}

const Card = ({ title, badge, children, desc }) => (
  <section className="set-card">
    {title && <header><h3>{title}</h3>{badge}</header>}
    {desc && <p className="set-card-desc">{desc}</p>}
    {children}
  </section>
);

function BrandMarca({ s, set, toast }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const brand = s.brand || { displayName: '', logoUrl: '', accentColor: '', tagline: '', links: {} };
  const setBrand = (key, value) => set('brand', { ...brand, [key]: value });
  const setLink = (key, value) => set('brand', { ...brand, links: { ...(brand.links || {}), [key]: value } });
  const logoSrc = brandLogoSrc(brand.logoUrl);
  const previewName = brand.displayName?.trim() || 'Ripper';
  const previewStyle = brand.accentColor ? { '--brand-accent': brand.accentColor } : undefined;
  async function onLogoFile(file) {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { logoUrl } = await apiUpload('/api/brand/logo', fd);
      setBrand('logoUrl', logoUrl);
      toast('Logo enviado — salve para aplicar');
    } catch (e) { toast(e.message, 'error'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  return <>
    <Card title="Marca" desc="Nome, logo e cor de destaque na barra lateral. Deixe em branco para o visual padrão do Ripper.">
      <div className="brand-preview" style={previewStyle}>
        {logoSrc
          ? <img className="brand-logo" src={logoSrc} width="40" height="40" alt="" />
          : <svg viewBox="0 0 32 32" width="40" height="40" aria-hidden="true"><rect width="32" height="32" rx="8" className="brand-bg" /><path d="M11 23V9h6.2a4.3 4.3 0 0 1 .9 8.5L22 23" className="brand-r" /></svg>}
        <div><b>{previewName}</b>{brand.tagline?.trim() && <small className="muted">{brand.tagline.trim()}</small>}</div>
      </div>
      <Row title="Nome exibido" desc="Aparece no topo da barra lateral."><input className="input" value={brand.displayName || ''} maxLength={80} onChange={e => setBrand('displayName', e.target.value)} placeholder="Ripper" /></Row>
      <Row title="Tagline" desc="Opcional; só na prévia aqui (não na barra lateral)."><input className="input" value={brand.tagline || ''} maxLength={160} onChange={e => setBrand('tagline', e.target.value)} placeholder="Agentes de IA para o seu time" /></Row>
      <Row title="Cor de destaque" desc="Usada no ícone padrão quando não há logo.">
        <div className="row">
          <input className="input" type="color" value={/^#[0-9a-fA-F]{6}$/.test(brand.accentColor || '') ? brand.accentColor : '#161513'} onChange={e => setBrand('accentColor', e.target.value)} aria-label="Cor de destaque" />
          <input className="input" value={brand.accentColor || ''} onChange={e => setBrand('accentColor', e.target.value)} placeholder="#161513" style={{ maxWidth: 120 }} />
          {brand.accentColor && <button type="button" className="btn btn-sm" onClick={() => setBrand('accentColor', '')}>Padrão</button>}
        </div>
      </Row>
      <Row title="Logo" desc="URL pública (https) ou envie um arquivo (PNG, JPEG, WebP ou GIF, até 2 MB).">
        <div className="row stack">
          <input className="input" value={brand.logoUrl || ''} onChange={e => setBrand('logoUrl', e.target.value)} placeholder="https://… ou brand/logo-….png" />
          <div className="row">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Enviar logo" onChange={e => onLogoFile(e.target.files?.[0])} disabled={uploading} />
            {uploading && <span className="muted" role="status">Enviando…</span>}
            {brand.logoUrl && <button type="button" className="btn btn-sm" onClick={() => setBrand('logoUrl', '')}>Remover logo</button>}
          </div>
        </div>
      </Row>
      <Row title="Redes e site" desc="Links opcionais (só para referência futura; não aparecem na barra lateral no MVP).">
        <div className="row stack">
          <input className="input" value={brand.links?.website || ''} onChange={e => setLink('website', e.target.value)} placeholder="Site (https://…)" />
          <input className="input" value={brand.links?.linkedin || ''} onChange={e => setLink('linkedin', e.target.value)} placeholder="LinkedIn (https://…)" />
          <input className="input" value={brand.links?.twitter || ''} onChange={e => setLink('twitter', e.target.value)} placeholder="X / Twitter (https://…)" />
        </div>
      </Row>
    </Card>
  </>;
}

function Plugins({ s, set }) {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [err, setErr] = useState('');
  function add(e) {
    e.preventDefault();
    if (!/^[\w-]{1,40}$/.test(name)) return setErr('Nome: só letras, números, - e _.');
    if (!target.trim()) return setErr('Informe a URL ou o comando.');
    if (s.plugins.some(p => p.name === name)) return setErr('Já existe um plugin com esse nome.');
    const [command, ...args] = target.trim().split(/\s+/);
    set('plugins', [...s.plugins, /^https?:\/\//.test(target) ? { name, type: 'http', url: target.trim(), enabled: true } : { name, type: 'stdio', command, args, enabled: true }]);
    setName(''); setTarget(''); setErr('');
  }
  return <>
    <Card title="Plugins instalados" desc="Plugins são servidores MCP: dão aos agentes ferramentas como GitHub, Linear ou a sua própria API. Só agentes com “Plugins MCP” ligado usam.">
      {s.plugins.length === 0
        ? <EmptyState title="Nenhum plugin" body="Adicione o primeiro abaixo." />
        : <ul className="rows flat">{s.plugins.map((p, i) => (
          <li key={p.name} className="row-item">
            <span className="thumb file-ico"><Icon name="plug" size={18} /></span>
            <div className="row-main"><b>{p.name} <span className="tag">{p.type}</span></b><small className="mono">{p.url || [p.command, ...(p.args || [])].join(' ')}</small></div>
            <Switch checked={p.enabled !== false} onChange={v => set('plugins', s.plugins.map((x, j) => j === i ? { ...x, enabled: v } : x))} label={`Ativar ${p.name}`} />
            <button className="icon-btn sm" aria-label={`Remover ${p.name}`} onClick={() => set('plugins', s.plugins.filter((_, j) => j !== i))}><Icon name="trash" size={16} /></button>
          </li>
        ))}</ul>}
    </Card>
    <AdvancedBlock settings={s} hint="URL, comando stdio e nome técnico">
      <Card title="Adicionar plugin">
        <form onSubmit={add}>
          <Row title="Nome" desc="Letras, números, - e _."><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="github" /></Row>
          <Row title="URL ou comando" desc="Endereço HTTP do servidor MCP ou o comando que o inicia."><input className="input" value={target} onChange={e => setTarget(e.target.value)} placeholder="npx -y @modelcontextprotocol/server-github" /></Row>
          {err && <p className="form-error" role="alert">{err}</p>}
          <div className="set-actions"><button className="btn"><Icon name="plus" size={16} />Adicionar plugin</button></div>
        </form>
      </Card>
    </AdvancedBlock>
  </>;
}

export default function Settings({ theme, toggleTheme, tab: initial }) {
  const { S, refresh, toast } = useApp();
  const ov = useOv();
  // abre no tipo de conexão que você usa (QR configurado → QR)
  const [waMode, setWaMode] = useState(() => (S.settings.whatsappWeb?.agentId || !S.settings.whatsapp?.agentId ? 'qr' : 'api'));
  const tr = useT();
  const SETTINGS_TABS = settingsTabs(tr);
  const d = useSettingsDraft();
  const { s, set } = d;
  const dark = useDark();
  const enterprise = isEnterpriseMode(S.settings);
  const allowedTabs = SETTINGS_TABS.filter(([k]) => isSettingsTabAllowed(k, S.settings));
  const tab = allowedTabs.some(([k]) => k === initial) ? initial : 'profile';
  const [docker, setDocker] = useState(undefined);
  const [image, setImage] = useState(null);
  const [julia, setJulia] = useState(null);
  const [prov, setProv] = useState(null); // provedor aberto em Provedores de IA
  const provQuery = useRoute().query.get('prov'); // #/settings/models?prov=claude abre direto (busca de configurações)
  useEffect(() => { if (provQuery) setProv(provQuery); }, [provQuery]);
  const P = PROVIDERS.find(p => p.id === prov);
  const provCounts = Object.values(S.models).reduce((o, m) => (m.provider && (o[m.provider] = (o[m.provider] || 0) + 1), o), {});
  const provStatus = {
    julia: julia === null ? { tone: 'off', label: 'verificando…' } : julia ? { tone: 'ok', label: 'no ar' } : { tone: 'warn', label: 'fora do ar' },
    claude: s.claude.mode === 'api' && !s.claude.apiKey ? { tone: 'warn', label: 'falta a chave' } : { tone: 'ok', label: s.claude.mode === 'api' ? 'API key' : 'assinatura' },
    codex: S.meta?.codexInstalled ? { tone: 'ok', label: 'conectado' } : { tone: 'warn', label: 'não instalado' },
    openrouter: s.openrouter?.apiKey ? { tone: 'ok', label: 'chave salva' } : { tone: 'off', label: 'não conectado' },
    openai: s.openai?.apiKey ? { tone: 'ok', label: 'chave salva' } : { tone: 'off', label: 'não conectado' },
    gemini: s.gemini?.apiKey ? { tone: 'ok', label: 'chave salva' } : { tone: 'off', label: 'não conectado' },
    ollama: s.ollama?.models?.length ? { tone: 'ok', label: `${s.ollama.models.length} modelo(s)` } : { tone: 'off', label: 'sem modelos' }
  };
  const [sandboxSt, setSandboxSt] = useState(null);
  useEffect(() => {
    if (tab === 'computer') api('/api/computer/docker').then(r => { setDocker(r.version); setImage(r.outdated && r.image === 'missing' ? 'outdated' : r.image); }).catch(() => setDocker(null));
    if (tab === 'models') api('/api/julia/status').then(r => setJulia(r.online)).catch(() => setJulia(false));
    if (tab === 'security') api('/api/sandbox/status').then(setSandboxSt).catch(() => setSandboxSt(null));
  }, [tab]);
  const current = allowedTabs.find(([k]) => k === tab) || allowedTabs[0];

  return (
    <div className="settings-page">
      <nav className="settings-nav" aria-label={tr('settings.navLabel')}>
        <h1>{tr('settings.title')}</h1>
        <SettingsSearch allowed={new Set(allowedTabs.map(([k]) => k))} />
        {allowedTabs.map(([k, l, ic, hint]) => (
          <a key={k} href={`#/settings/${k}`} className={k === tab ? 'on' : ''} aria-current={k === tab ? 'page' : undefined}>
            <Icon name={ic} size={17} /><span><b>{l}</b><small>{hint}</small></span>
          </a>
        ))}
        {!enterprise && (
          <p className="settings-simple-hint muted small">Computador, conectores e opções técnicas ficam no <a href="#/settings/appearance">modo Enterprise</a>.</p>
        )}
      </nav>

      <div className="settings-main">
        <header className="settings-head"><h2>{current[1]}</h2><p>{current[3]}</p></header>

        {tab === 'profile' && <>
          <Card>
            <Row title="Seu nome" desc="Os agentes usam isso quando falam com você."><input className="input" value={s.name} maxLength={80} onChange={e => set('name', e.target.value)} placeholder="Ex.: Rafael" /></Row>
            <Row stack title="Instruções gerais" desc="Entram em toda conversa, junto das instruções de cada agente e da skill token-the-ripper.">
              <textarea className="input" rows={6} value={s.customInstructions} maxLength={8000} onChange={e => set('customInstructions', e.target.value)} placeholder="Ex.: Sou dev frontend em SP. Respostas curtas, TypeScript no código." />
            </Row>
          </Card>
          <Card title="Voz padrão dos agentes" desc="Agentes sem perfil de voz próprio herdam estes valores no prompt do modelo.">
            <Row title="Tom">
              <div className="pills">
                {TONES.map(([k, l]) => <button key={k} type="button" className={`pill ${(s.defaults?.agentStyle?.tone || 'direto') === k ? 'on' : ''}`} onClick={() => set('defaults', { ...s.defaults, agentStyle: { ...(s.defaults?.agentStyle || {}), tone: k } })}>{l}</button>)}
              </div>
            </Row>
            <Row title="Formalidade">
              <div className="pills">
                {FORMALITIES.map(([k, l]) => <button key={k} type="button" className={`pill ${(s.defaults?.agentStyle?.formality || 'neutro') === k ? 'on' : ''}`} onClick={() => set('defaults', { ...s.defaults, agentStyle: { ...(s.defaults?.agentStyle || {}), formality: k } })}>{l}</button>)}
              </div>
            </Row>
            <Row title="Dicas extras" stack>
              <textarea className="input" rows={2} maxLength={500} value={s.defaults?.agentStyle?.customHints || ''} onChange={e => set('defaults', { ...s.defaults, agentStyle: { ...(s.defaults?.agentStyle || {}), customHints: e.target.value } })} placeholder="Ex.: sempre em português do Brasil." />
            </Row>
          </Card>
          <PushCard />
          <DevicesCard />
          <Card title="Resumo do dia" desc="Todo dia, na Caixa: o que cada agente fez, o que espera você e quanto gastou. Montado sem gastar tokens.">
            <Row title="Receber o resumo"><Switch checked={s.pulse?.enabled !== false} onChange={v => set('pulse', { ...(s.pulse || {}), enabled: v })} label="Resumo do dia" /></Row>
            {s.pulse?.enabled !== false && <Row title="Horário">
              <select className="select" value={s.pulse?.hour ?? 8} onChange={e => set('pulse', { ...(s.pulse || {}), hour: +e.target.value })}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </Row>}
            {s.pulse?.enabled !== false && (s.whatsappWeb?.enabled || s.whatsapp?.agentId) && <Row title="Também no meu WhatsApp" desc="Só para o seu próprio número, com DDI e DDD. Nunca vai para outra pessoa.">
              <Switch checked={!!s.pulse?.whatsapp} onChange={v => set('pulse', { ...(s.pulse || {}), whatsapp: v })} label="Resumo no WhatsApp" />
            </Row>}
            {s.pulse?.enabled !== false && s.pulse?.whatsapp && <Row title="Meu número">
              <input className="input" inputMode="tel" placeholder="+55 16 99999-9999" value={s.pulse?.whatsappTo || ''} onChange={e => set('pulse', { ...(s.pulse || {}), whatsappTo: e.target.value })} />
            </Row>}
          </Card>
        </>}

        {tab === 'models' && !P && <>
          <ProviderGrid status={provStatus} counts={provCounts} dark={dark} onOpen={setProv} />
          <Card title="Padrão para agentes novos">
            <Row title="Modelo" desc="Cada agente e cada conversa podem trocar depois.">
              <Select label="Modelo padrão" value={s.defaultModel} onChange={v => set('defaultModel', v)} options={Object.entries(S.models).filter(([k]) => k === 'auto' || s.models?.enabled?.[k] !== false).map(([k, m]) => ({ value: k, label: m.label, hint: MODEL_DESC[k] }))} />
            </Row>
          </Card>
          <Card title="Fila de entrada" desc="Mensagens seguidas no composer são agrupadas num único turno. Enter reinicia a janela; o botão Enviar manda na hora.">
            <Row title="Agrupar mensagens consecutivas"><Switch checked={s.inputQueue?.enabled !== false} onChange={v => set('inputQueue', { ...(s.inputQueue || {}), enabled: v })} label="Coalescing ativo" /></Row>
            <Row title="Janela de agrupamento" desc="Tempo de espera após Enter antes de mandar ao agente (0 desliga o atraso quando o coalescing está ativo).">
              <div className="input-unit"><input className="input" type="number" min={0} max={10} step={0.5} value={(s.inputQueue?.windowMs ?? 2500) / 1000} onChange={e => set('inputQueue', { ...(s.inputQueue || {}), windowMs: Math.round(+e.target.value * 1000) })} /><span>segundos</span></div>
            </Row>
          </Card>
        </>}
        {tab === 'models' && P && <>
          <ProviderHeader p={P} status={provStatus} dark={dark} onBack={() => setProv(null)} />
          {P.id === 'claude' && <>
          <Card title="Conexão" badge={<span className="tag">Opus 5.5 · Sonnet 5.5 · Fable 5.1</span>}>
            <Row title="Como conectar">
              <div className="seg-choice">
                {[['subscription', 'Assinatura', 'claude login desta máquina'], ['api', 'API key', 'pago por uso: gasta créditos']].map(([k, l, h]) => (
                  <button key={k} type="button" className={s.claude.mode === k ? 'on' : ''} onClick={() => set('claude.mode', k)}><b>{l}</b><small>{h}</small></button>
                ))}
              </div>
            </Row>
            {s.claude.mode === 'api' && <p className="paid-inline"><Icon name="bolt" size={14} />Com chave de API, cada resposta do Claude é cobrada na sua conta da Anthropic. Precisa do uso pago ativado (abaixo).</p>}
            {s.claude.mode === 'api' && <Row title="Anthropic API key"><input className="input" type="password" autoComplete="off" value={s.claude.apiKey} onChange={e => set('claude.apiKey', e.target.value)} placeholder="sk-ant-…" /></Row>}
            <Row title="Conectores do claude.ai" desc="Gmail, Drive e outros. Carregar custa tokens: só vale para agentes com Plugins MCP."><Switch checked={s.claude.useConnectors} onChange={v => set('claude.useConnectors', v)} label="Conectores do claude.ai" /></Row>
          </Card>
          </>}
          {P.id === 'claude' && s.claude.mode !== 'api' && <ClaudeAccountsCard s={s} set={set} S={S} />}
          {P.id === 'claude' && s.claude.mode === 'api' && <PaidUsageCard s={s} set={set} S={S} />}
          {P.id === 'codex' && <>
          <Card title="Conexão" badge={<span className="tag">Codex</span>}>
            <Row title="Login" desc="Rode codex login uma vez nesta máquina. Sem o Codex instalado, o Ripper Auto usa só o Claude."><code className="inline-code">npm i -g @openai/codex</code></Row>
            <Row title="Apps conectados do ChatGPT" desc="Quando houver suporte."><Switch checked={s.chatgpt.useConnectedApps} onChange={v => set('chatgpt.useConnectedApps', v)} label="Apps do ChatGPT" /></Row>
          </Card>
          </>}
          {['openrouter', 'openai', 'gemini'].includes(P.id) && <><PaidUsageCard s={s} set={set} S={S} /><OpenRouterCard s={s} set={set} prov={P.id} /></>}
          {P.id === 'ollama' && <OpenRouterCard s={s} set={set} prov="ollama" />}
          {P.id === 'julia' && <>
          <Card title="Como a Julia trabalha" badge={<><MetalBadge theme={dark ? 'dark' : 'light'}>Julia 1</MetalBadge>{julia === null ? <span className="tag" role="status">Verificando…</span> : <span className={`tag ${julia ? 'tag-ok' : 'tag-warn'}`}>{julia ? 'no ar' : 'fora do ar'}</span>}</>} desc="A Julia 1 escolhe modelo e prioridades antes do modelo grande. Fora do ar, as regras de reserva decidem.">
            <AdvancedBlock settings={s} hint="Limites de API, Julia e detalhes do Codex" className="in-card">
              <p className="set-card-desc">Quando a API devolve rate limit (429), o Ripper espera antes de tentar de novo ou mudar de modelo.</p>
              <Row title="Tentativas por modelo" desc="Inclui a primeira chamada. Depois disso, pode haver fallback para outro provedor.">
                <div className="input-unit"><input className="input" type="number" min={1} max={6} value={s.providerRetry?.maxAttempts ?? 3} onChange={e => set('providerRetry', { ...(s.providerRetry || {}), maxAttempts: +e.target.value })} /><span>tentativas</span></div>
              </Row>
              <Row title="Espera máxima entre tentativas"><div className="input-unit"><input className="input" type="number" min={1} max={120} value={Math.round((s.providerRetry?.maxDelayMs ?? 60000) / 1000)} onChange={e => set('providerRetry', { ...(s.providerRetry || {}), maxDelayMs: +e.target.value * 1000 })} /><span>segundos</span></div></Row>
              <Row title="Endereço do Julia 1" desc="Serviço local de triagem (npm run julia)."><input className="input" value={s.julia.url} onChange={e => set('julia.url', e.target.value)} /></Row>
              <Row title="Ferramentas Ripper no Codex" desc="Com o Codex, remember, artefatos, inbox e o MCP ripper vão por stdio. WebSearch do Claude e conectores claude.ai não existem no Codex." />
            </AdvancedBlock>
          </Card>
          </>}
          {P.provider && (provCounts[P.provider] || 0) > 0 && <>
          <Card title="Modelos" desc="Desligue os que você não quer usar e limite o esforço de cada um. O Ripper Auto e a Julia 1 só escolhem dentro disso.">
            {Object.entries(S.models).filter(([k, m]) => k !== 'auto' && m.provider === P.provider).map(([k, m]) => {
              const on = s.models?.enabled?.[k] !== false;
              const connected = m.provider === 'codex' ? S.meta?.codexInstalled : true;
              const others = Object.keys(S.models).filter(x => x !== 'auto' && x !== k && s.models?.enabled?.[x] !== false);
              const setModels = patch => set('models', { enabled: { ...(s.models?.enabled || {}) }, maxEffort: { ...(s.models?.maxEffort || {}) }, ...patch(s.models || {}) });
              return (
                <Row key={k} title={<>{m.label}{!connected && <span className="tag warn model-conn">não instalado</span>}</>} desc={MODEL_DESC[k]}>
                  <div className="model-policy-ctrl">
                    <Select label={`Esforço máximo de ${m.label}`} value={s.models?.maxEffort?.[k] || ''} disabled={!on}
                      onChange={v => setModels(cur => ({ maxEffort: { ...(cur.maxEffort || {}), [k]: v || undefined } }))}
                      options={[{ value: '', label: 'Sem limite' }, ...EFFORT_CAPS.map(([v, l]) => ({ value: v, label: `Até ${l.toLowerCase()}` }))]} />
                    <Switch checked={on} disabled={on && !others.length} label={`Usar ${m.label}`}
                      onChange={v => setModels(cur => ({ enabled: { ...(cur.enabled || {}), [k]: v } }))} />
                  </div>
                </Row>
              );
            })}
          </Card>
          </>}
        </>}

        {tab === 'computer' && <>
          <Card title="Onde os agentes executam">
            <div className="mode-grid">
              {[['docker', 'Docker', 'Grátis', 'Um contêiner Linux por agente nesta máquina (sandbox).', 'terminal'],
                ['boat', 'boat.dev', 'Pago', 'Uma VM na nuvem por agente, com links públicos.', 'globe'],
                ['local', 'Pasta local', 'Sem isolamento', 'Roda na sua máquina. Todo comando pede aprovação.', 'folder'],
                ['off', 'Desligado', '', 'Sem computador. Ainda pesquisam e lembram.', 'x']].map(([k, t, tag, dsc, ic]) => (
                <button key={k} type="button" className={`mode ${s.computer.mode === k ? 'on' : ''}`} onClick={() => set('computer.mode', k)} aria-pressed={s.computer.mode === k}>
                  <span className="mode-ico"><Icon name={ic} size={18} /></span>
                  <b>{t}{tag && <span className={`tag ${k === 'docker' ? 'tag-ok' : ''}`}>{tag}</span>}</b>
                  <small>{dsc}</small>
                </button>
              ))}
            </div>
          </Card>
          {s.computer.mode === 'docker' && (
            <Card title="Docker" badge={docker === undefined ? <span className="tag" role="status">Verificando…</span> : docker ? <span className="tag tag-ok">Docker {docker} ativo</span> : <span className="tag tag-warn">Docker não encontrado</span>} aria-busy={docker === undefined}>
              {docker === null && <p className="form-error">Modo sem computador: enquanto o Docker não estiver rodando, os agentes conversam, pesquisam e lembram, mas não rodam comandos, não abrem navegador nem criam arquivos. Abra o Docker Desktop e recarregue esta página.</p>}
              <Row title="Imagem de referência" desc="A imagem do Ripper já vem com Chromium, tela virtual (noVNC), Node 22 e Python 3." tip="Cada agente ganha um contêiner isolado; arquivos ficam na pasta do agente, não na sua máquina.">
                <div className="row">{image && <span className={`tag ${image === 'ready' ? 'tag-ok' : 'tag-warn'}`}>{image === 'ready' ? 'pronta' : image === 'building' ? 'construindo…' : image === 'outdated' ? 'desatualizada' : 'não construída'}</span>}
                  {(image === 'missing' || image === 'outdated') && <button className="btn btn-sm" onClick={() => api('/api/computer/image', { method: 'POST' }).then(r => setImage(r.image === 'missing' ? 'building' : r.image))}>{image === 'outdated' ? 'Atualizar imagem' : 'Construir agora'}</button>}</div>
              </Row>
              <AdvancedBlock settings={s} hint="Imagem customizada e tempo ocioso" className="in-card">
                <Row title="Imagem usada" desc="Deixe em branco para usar a imagem do Ripper (sempre a versão atual). Só preencha se tiver uma imagem própria."><input className="input" value={/^(node:22-bookworm|ripper-agent:\d+)?$/.test(s.computer.dockerImage || '') ? '' : s.computer.dockerImage} placeholder="Imagem do Ripper (padrão)" onChange={e => set('computer.dockerImage', e.target.value)} /></Row>
                <Row title="Parar ocioso após" desc="O contêiner para; os arquivos ficam na pasta do agente."><div className="input-unit"><input className="input" type="number" min={1} max={1440} value={s.computer.idleStopMinutes} onChange={e => set('computer.idleStopMinutes', +e.target.value)} /><span>min</span></div></Row>
              </AdvancedBlock>
            </Card>
          )}
          {s.computer.mode === 'boat' && (
            <Card title="boat.dev">
              <Row title="API key" desc="Crie no painel do boat.dev."><input className="input" type="password" autoComplete="off" value={s.computer.boatApiKey} onChange={e => set('computer.boatApiKey', e.target.value)} placeholder="boat_…" /></Row>
              <Row title="Tamanho da VM">
                <Select label="Tamanho da VM" value={s.computer.vmSize} onChange={v => set('computer.vmSize', v)} options={[
                  { value: 'small', label: 'Pequena', hint: '2 vCPU · 4 GB' }, { value: 'default', label: 'Padrão', hint: '4 vCPU · 8 GB' }, { value: 'large', label: 'Grande', hint: '8 vCPU · 16 GB' }]} />
              </Row>
              <Row title="Parar ociosa após" desc="Fica em snapshot e volta quando precisar."><div className="input-unit"><input className="input" type="number" min={1} max={1440} value={s.computer.idleStopMinutes} onChange={e => set('computer.idleStopMinutes', +e.target.value)} /><span>min</span></div></Row>
            </Card>
          )}
          {s.computer.mode === 'local' && (
            <Card title="Pasta local">
              <Row title="Permitir comandos locais" desc="Os agentes acessam arquivos e programas desta máquina. Cada comando pede sua aprovação." tip="Sem sandbox Docker: um comando errado pode alterar arquivos reais. Mantenha aprovações ligadas."><Switch checked={!!s.computer.allowLocalCommands} onChange={v => set('computer.allowLocalCommands', v)} label="Permitir comandos locais" /></Row>
            </Card>
          )}
        </>}

        {tab === 'plugins' && <Plugins s={s} set={set} />}
        {tab === 'channels' && <EmailCard s={s} set={set} toast={toast} />}
        {tab === 'channels' && <GithubCard s={s} toast={toast} refresh={refresh} />}
        {tab === 'channels' && !enterprise && <p className="muted small">WhatsApp fica no <a href="#/settings/appearance">modo Enterprise</a>.</p>}
        {tab === 'channels' && enterprise && (() => {
          const w = s.whatsapp || {};
          const setW = (k, v) => set('whatsapp', { ...w, [k]: v });
          const hook = `${location.origin}/api/channels/whatsapp/webhook`;
          return (
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
          );
        })()}

        {tab === 'security' && <>
          <Card
            title="Sandbox Docker"
            badge={sandboxSt == null ? <span className="tag" role="status">Verificando…</span> : sandboxSt.ready ? <span className="tag tag-ok">Pronto</span> : <span className="tag tag-warn">Docker ausente</span>}
            desc="Isola comandos do modo Pasta local em contêiner efêmero (sem privileged, sem rede do host por padrão). Modos Docker e boat.dev já rodam fora do host.">
            <Row title="Ativar sandbox" desc="Comandos no computador local usam docker run --rm em vez do shell do host.">
              <Switch checked={!!s.sandbox?.enabled} onChange={v => set('sandbox', { enabled: false, image: 'node:22-alpine', network: 'none', memory: '512m', cpus: '1', timeoutSeconds: 300, ...s.sandbox, enabled: v })} label="Sandbox Docker" />
            </Row>
            {s.sandbox?.enabled && (
              <>
                {sandboxSt?.fallback && <p className="form-error" role="alert">{sandboxSt.fallback}</p>}
                <Row title="Imagem" desc="Padrão leve com Node (node:22-alpine)."><input className="input mono" value={s.sandbox?.image || 'node:22-alpine'} onChange={e => set('sandbox', { ...s.sandbox, image: e.target.value })} /></Row>
                <Row title="Rede" desc="none isola da rede; bridge permite saída (menos seguro).">
                  <Select label="Rede do contêiner" value={s.sandbox?.network || 'none'} onChange={v => set('sandbox', { ...s.sandbox, network: v })} options={[{ value: 'none', label: 'Nenhuma (recomendado)' }, { value: 'bridge', label: 'Bridge' }]} />
                </Row>
                <Row title="Memória / CPUs"><div className="row gap"><input className="input" value={s.sandbox?.memory || '512m'} onChange={e => set('sandbox', { ...s.sandbox, memory: e.target.value })} aria-label="Limite de memória" /><input className="input" value={s.sandbox?.cpus ?? '1'} onChange={e => set('sandbox', { ...s.sandbox, cpus: e.target.value })} aria-label="Limite de CPUs" /></div></Row>
                <Row title="Timeout por comando"><div className="input-unit"><input className="input" type="number" min={5} max={3600} value={s.sandbox?.timeoutSeconds ?? 300} onChange={e => set('sandbox', { ...s.sandbox, timeoutSeconds: +e.target.value })} /><span>seg</span></div></Row>
              </>
            )}
          </Card>
          <Card title={tr('settings.security.approvalTitle')} desc={tr('settings.security.approvalDesc')}>
            <div className="mode-grid three">
              {[['risky', tr('settings.security.approval.risky'), tr('settings.security.approval.riskyTag'), tr('settings.security.approval.riskyDesc')],
                ['always', tr('settings.security.approval.always'), '', tr('settings.security.approval.alwaysDesc')],
                ['never', tr('settings.security.approval.never'), tr('settings.security.approval.neverTag'), tr('settings.security.approval.neverDesc')]].map(([k, tit, tag, dsc]) => (
                <button key={k} type="button" className={`mode ${(s.approvalPolicy || 'risky') === k ? 'on' : ''}`} onClick={() => set('approvalPolicy', k)} aria-pressed={(s.approvalPolicy || 'risky') === k}
                  title={k === 'never' ? 'Comandos destrutivos podem rodar sem pausa. Use só se confia em tudo que o agente faz.' : undefined}>
                  <b>{tit}{tag && <span className={`tag ${k === 'risky' ? 'tag-ok' : 'tag-warn'}`}>{tag}</span>}</b><small>{dsc}</small>
                </button>
              ))}
            </div>
          </Card>
          <Card title="LGPD — dados pessoais" desc="Opt-in: antes de enviar texto a Claude, Codex ou Julia 1, o Ripper pode substituir CPF, contas, documentos e contatos por [PII]. Conversas locais continuam com o texto original.">
            <Row title="Exportar tudo" desc="Pacote legível (.tar.gz): conversas em Markdown, agentes, rotinas, arquivos e artefatos. Senhas e chaves ficam de fora.">
              <a className="btn" href="/api/data/export-all" download><Icon name="download" size={16} />Baixar pacote</a>
            </Row>
            <Row title="Mascaramento antes do modelo" desc="Recomendado se você cola dados de clientes no chat."><Switch checked={!!s.lgpd?.enabled} onChange={v => set('lgpd', { ...(s.lgpd || {}), enabled: v })} label="Ativar mascaramento LGPD" /></Row>
            {s.lgpd?.enabled && <>
              <Row title="Também em avisos do servidor" desc="SSE warn/erro e logs do Node quando ligado."><Switch checked={!!s.lgpd?.redactInLogs} onChange={v => set('lgpd', { ...(s.lgpd || {}), redactInLogs: v })} label="Mascarar PII em logs" /></Row>
              <Row title="Eliminar meus dados" desc="Direito de eliminação (art. 18): apaga conversas, memórias, anexos e telemetria local. Agentes e plugins permanecem.">
                <button type="button" className="btn btn-danger" onClick={async () => {
                  if (!(await ov.confirm({ title: 'Eliminar meus dados?', body: 'Apaga conversas, memórias, anexos e seu nome/instruções. Não dá para desfazer.', action: 'Eliminar', danger: true }))) return;
                  try {
                    await api('/api/lgpd/erasure', { method: 'POST', body: { confirm: 'ERASE', scope: 'all' } });
                    await refresh();
                    toast('Dados pessoais eliminados nesta instalação');
                  } catch (e) { toast(e.message, 'error'); }
                }}>Solicitar eliminação</button>
              </Row>
            </>}
          </Card>
          {enterprise && <>
            <Card title={tr('settings.security.historyTitle')} desc={tr('settings.security.historyDesc')}>
              <ApprovalHistory limit={15} />
            </Card>
            {s.flags?.socialWebhooks && (
              <Card title="Publicação social" desc="Webhooks HTTP para posts externos. Tokens na URL são armazenados localmente; publicar pede aprovação nas políticas acima (exceto “Nunca pedir” ou autonomia total no Enterprise).">
                <div className="set-actions"><button type="button" className="btn btn-sm" onClick={() => go('/connectors')}><Icon name="share" size={16} />Gerenciar webhooks sociais</button></div>
              </Card>
            )}
            <AdvancedBlock settings={s} hint="Limite de taxa">
              <Card title="Limite de taxa" desc="Evita loops acidentais no chat e em APIs pesadas (backup, restore, export de metering). Contadores ficam na memória deste processo — várias réplicas não compartilham o mesmo limite. Variáveis RIPPER_RATE_* no servidor têm prioridade.">
                <Row title="Ativar limite de taxa" desc="Respostas 429 com Retry-After quando exceder."><Switch checked={!!s.rateLimit?.enabled} onChange={v => set('rateLimit', { ...(s.rateLimit || {}), enabled: v })} label="Limite de taxa" /></Row>
                <Row title="Chat (POST /api/chat)" desc="Por token e por IP na janela abaixo."><div className="input-unit"><input className="input" type="number" min={1} max={10000} value={s.rateLimit?.chatPerMinute ?? 30} onChange={e => set('rateLimit', { ...(s.rateLimit || {}), chatPerMinute: +e.target.value })} /><span>req / janela</span></div></Row>
                <Row title="APIs pesadas" desc="Backup, restore, export de metering e rotas de teste de carga."><div className="input-unit"><input className="input" type="number" min={1} max={10000} value={s.rateLimit?.apiPerMinute ?? 20} onChange={e => set('rateLimit', { ...(s.rateLimit || {}), apiPerMinute: +e.target.value })} /><span>req / janela</span></div></Row>
                <Row title="Janela" desc="Duração da janela em memória."><div className="input-unit"><input className="input" type="number" min={1} max={3600} value={Math.round((s.rateLimit?.windowMs ?? 60000) / 1000)} onChange={e => set('rateLimit', { ...(s.rateLimit || {}), windowMs: +e.target.value * 1000 })} /><span>segundos</span></div></Row>
              </Card>
            </AdvancedBlock>
            <AdvancedBlock settings={s} hint="Limites de mensagens entre agentes">
              <Card title={tr('settings.security.inboxTitle')} desc={tr('settings.security.inboxDesc')}>
                <Row title="Máximo por agente, por hora"><div className="input-unit"><input className="input" type="number" min={1} max={200} value={s.inbox?.maxPerHour ?? 20} onChange={e => set('inbox', { ...(s.inbox || {}), maxPerHour: +e.target.value })} /><span>mensagens</span></div></Row>
                <Row title="Profundidade máxima de uma troca" desc="Quantas vezes uma resposta pode gerar outra mensagem (saltos inbox)." tip="Valores altos podem gerar longas cadeias de mensagens automáticas entre agentes."><div className="input-unit"><input className="input" type="number" min={1} max={10} value={s.inbox?.maxHops ?? 3} onChange={e => set('inbox', { ...(s.inbox || {}), maxHops: +e.target.value })} /><span>saltos</span></div></Row>
                <Row title="Timeout de call_agent" desc="Quanto esperar por uma chamada síncrona entre agentes (5–300 s)."><div className="input-unit"><input className="input" type="number" min={5} max={300} value={s.inbox?.callTimeoutSeconds ?? 120} onChange={e => set('inbox', { ...(s.inbox || {}), callTimeoutSeconds: +e.target.value })} /><span>segundos</span></div></Row>
              </Card>
            </AdvancedBlock>
            <AdvancedBlock settings={s} hint="Chaos / testes de resiliência">
              <Card title="Chaos / testes de resiliência" desc="Simula falhas controladas para validar fallbacks. Desligado por padrão; nunca use em produção real.">
                <div className="chaos-banner" role="alert">
                  <strong>Atenção:</strong> com chaos ativo, conversas e conectores MCP podem falhar ou ficar lentos de propósito. Só ligue em ambiente de desenvolvimento ou teste.
                </div>
                <Row title="Ativar chaos" desc="Requer NODE_ENV ≠ production ou RIPPER_CHAOS_ALLOW_PROD=1 no servidor.">
                  <Switch checked={!!s.chaos?.enabled} onChange={v => set('chaos', { ...(s.chaos || {}), enabled: v })} label="Chaos ativo" />
                </Row>
                <Row title="Taxa de falha do provedor" desc="0 = nunca; 1 = sempre (antes de chamar o modelo).">
                  <div className="input-unit"><input className="input" type="number" min={0} max={1} step={0.05} disabled={!s.chaos?.enabled} value={s.chaos?.providerFailRate ?? 0} onChange={e => set('chaos', { ...(s.chaos || {}), providerFailRate: +e.target.value })} /><span>0–1</span></div>
                </Row>
                <Row title="Atraso SSE" desc="Milissegundos extras antes de cada evento enviado ao navegador.">
                  <div className="input-unit"><input className="input" type="number" min={0} max={60000} disabled={!s.chaos?.enabled} value={s.chaos?.sseDelayMs ?? 0} onChange={e => set('chaos', { ...(s.chaos || {}), sseDelayMs: +e.target.value })} /><span>ms</span></div>
                </Row>
                <Row title="Desconectar MCP" desc="Próximas sondas MCP e chamadas da ponte ripper falham como se a sessão tivesse caído.">
                  <Switch checked={!!s.chaos?.mcpDisconnect} disabled={!s.chaos?.enabled} onChange={v => set('chaos', { ...(s.chaos || {}), mcpDisconnect: v })} label="Simular queda MCP" />
                </Row>
              </Card>
            </AdvancedBlock>
          </>}
          <Card title="Retenção de dados" desc="Apaga automaticamente conversas, eventos de uso, histórico de aprovações em db.json, artefatos e anexos órfãos após o prazo. Hard-delete no disco. Não altera audit-trail.sqlite (WORM), se existir.">
            <Row title="Retenção automática" desc="Job periódico no servidor (padrão a cada 6 h)."><Switch checked={!!s.retention?.enabled} onChange={v => set('retention', { ...(s.retention || {}), enabled: v })} label="Ativar retenção" /></Row>
            <Row title="Conversas" desc="Usa a data da última mensagem (updatedAt)."><div className="input-unit"><input className="input" type="number" min={1} max={3650} value={s.retention?.chatDays ?? 90} onChange={e => set('retention', { ...(s.retention || {}), chatDays: +e.target.value })} /><span>dias</span></div></Row>
            <Row title="Eventos de uso" desc="Linhas em usage.sqlite (não os contadores em db.json)."><div className="input-unit"><input className="input" type="number" min={1} max={3650} value={s.retention?.usageEventsDays ?? 90} onChange={e => set('retention', { ...(s.retention || {}), usageEventsDays: +e.target.value })} /><span>dias</span></div></Row>
            <Row title="Auditoria local" desc="Entradas em db.json (auditLog). WORM audit-trail.sqlite nunca é apagado aqui."><div className="input-unit"><input className="input" type="number" min={1} max={3650} value={s.retention?.auditDays ?? 180} onChange={e => set('retention', { ...(s.retention || {}), auditDays: +e.target.value })} /><span>dias</span></div></Row>
            <Row title="Artefatos e anexos" desc="Metadados em db.json, blobs em artifacts/ e uploads órfãos."><div className="input-unit"><input className="input" type="number" min={1} max={3650} value={s.retention?.artifactsDays ?? 90} onChange={e => set('retention', { ...(s.retention || {}), artifactsDays: +e.target.value })} /><span>dias</span></div></Row>
            {s.retention?.lastPurgeAt && (
              <Row title="Última purga" desc={s.retention.lastReport ? `${s.retention.lastReport.chats ?? 0} conversas, ${s.retention.lastReport.usageEvents ?? 0} eventos de uso, ${s.retention.lastReport.auditLog ?? 0} auditoria, ${s.retention.lastReport.artifacts ?? 0} artefatos.` : ''}>
                <span className="muted">{new Date(s.retention.lastPurgeAt).toLocaleString('pt-BR')}</span>
              </Row>
            )}
          </Card>
        </>}

        {tab === 'backup' && <><UpdateCard /><DataBackup s={s} set={set} /></>}

        {tab === 'memory' && <>
          <Card>
            <Row title="Memória" desc="Deixa os agentes guardarem fatos úteis e usarem em conversas futuras."><Switch checked={s.memory} onChange={v => set('memory', v)} label="Memória" /></Row>
            <AdvancedBlock settings={s} hint="Quantos registros entram no contexto" className="in-card">
              <Row title="Registro recente no contexto" desc="Quantas anotações datadas (as mais novas) entram em cada conversa. O perfil estável entra sempre."><div className="input-unit"><input className="input" type="number" min={0} max={50} value={s.memoryLogInContext ?? 10} onChange={e => set('memoryLogInContext', +e.target.value)} /><span>itens</span></div></Row>
            </AdvancedBlock>
            <AdvancedBlock settings={s} hint="Resume histórico longo só no envio ao modelo" className="in-card">
              <Row title="Poda dinâmica de contexto" desc="Antes de enviar ao modelo, resume mensagens antigas quando o histórico passa dos limites abaixo. As últimas trocas ficam intactas; o chat salvo não é alterado."><Switch checked={!!s.contextPruning?.enabled} onChange={v => set('contextPruning', { ...(s.contextPruning || {}), enabled: v })} label="Poda de contexto" /></Row>
              {s.contextPruning?.enabled && <>
                <Row title="Limite de mensagens" desc="Acima disso, mensagens mais antigas viram um resumo no envio."><div className="input-unit"><input className="input" type="number" min={8} max={200} value={s.contextPruning?.maxMessages ?? 48} onChange={e => set('contextPruning', { ...(s.contextPruning || {}), enabled: true, maxMessages: +e.target.value })} /><span>mensagens</span></div></Row>
                <Row title="Limite estimado de tokens" desc="Estimativa local (~4 caracteres por token) sobre o histórico enviado."><div className="input-unit"><input className="input" type="number" min={2000} max={500000} step={1000} value={s.contextPruning?.maxTokens ?? 32000} onChange={e => set('contextPruning', { ...(s.contextPruning || {}), enabled: true, maxTokens: +e.target.value })} /><span>tokens</span></div></Row>
                <Row title="Trocas recentes intactas" desc="Quantas mensagens do fim do histórico nunca entram no resumo."><div className="input-unit"><input className="input" type="number" min={2} max={100} value={s.contextPruning?.keepRecent ?? 14} onChange={e => set('contextPruning', { ...(s.contextPruning || {}), enabled: true, keepRecent: +e.target.value })} /><span>mensagens</span></div></Row>
              </>}
            </AdvancedBlock>
          </Card>
          {enterprise && (
            <Card title="Como funciona" desc="Perfil: fatos estáveis sobre você (preferências, contexto). Registro: anotações datadas do que aconteceu. Gerencie tudo na Biblioteca.">
              <div className="set-actions"><button className="btn" onClick={() => go('/library')}><Icon name="book" size={16} />Abrir Biblioteca</button></div>
            </Card>
          )}
        </>}

        {tab === 'advanced' && <>
          <Card title="Enterprise" desc="Flags locais desta instalação. Úteis para liberar UI ou APIs experimentais sem trocar de branch.">
            {(S.meta?.flags?.catalog || []).map(({ key, label, desc }) => (
              <Row key={key} title={label} desc={desc}>
                <Switch
                  checked={s.flags?.[key] === true}
                  onChange={v => set('flags', { ...(s.flags || {}), [key]: v })}
                  label={label}
                />
              </Row>
            ))}
            <Row title="Flags personalizadas" desc="Quando ligado, chaves extras booleanas em settings.flags são preservadas (via API ou backup). A interface só lista as conhecidas.">
              <Switch
                checked={s.flags?.allowCustom === true}
                onChange={v => set('flags', { ...(s.flags || {}), allowCustom: v })}
                label="Permitir flags personalizadas"
              />
            </Row>
          </Card>
        </>}

        {tab === 'appearance' && <>
          <Card title="Experiência">
            <UiModeToggle />
          </Card>
          {enterprise && <BrandMarca s={s} set={set} toast={toast} />}
          <Card>
            <Row title={tr('settings.appearance.locale')} desc={tr('settings.appearance.localeDesc')}>
              <Select label={tr('settings.appearance.locale')} value={s.ui?.locale || 'pt-BR'} onChange={v => set('ui.locale', v)} options={[
                { value: 'pt-BR', label: tr('settings.appearance.localePt') },
                { value: 'en', label: tr('settings.appearance.localeEn') }
              ]} />
            </Row>
            <Row title={tr('settings.appearance.theme')} desc={tr('settings.appearance.themeDesc', { theme: theme === 'dark' ? tr('settings.appearance.themeCurrentDark') : tr('settings.appearance.themeCurrentLight') })}><button className="btn" onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />{tr('settings.appearance.useTheme', { theme: theme === 'dark' ? tr('settings.appearance.themeCurrentLight') : tr('settings.appearance.themeCurrentDark') })}</button></Row>
          </Card>
          <Card title={tr('settings.appearance.shortcuts')}>
            <dl className="keys">
              <dt><kbd>Ctrl</kbd><kbd>K</kbd></dt><dd>Buscar conversas, agentes e ações</dd>
              <dt><kbd>Ctrl</kbd><kbd>,</kbd></dt><dd>Abrir configurações</dd>
              <dt><kbd>Ctrl</kbd><kbd>B</kbd></dt><dd>Recolher a barra lateral</dd>
              <dt><kbd>Ctrl</kbd><kbd>.</kbd></dt><dd>Recolher o painel da conversa</dd>
              <dt><kbd>Enter</kbd></dt><dd>Enviar mensagem</dd>
              <dt><kbd>Shift</kbd><kbd>Enter</kbd></dt><dd>Nova linha</dd>
              <dt><kbd>Esc</kbd></dt><dd>Parar a resposta</dd>
              <dt>Botão direito</dt><dd>Ações da conversa (renomear, exportar, apagar)</dd>
            </dl>
          </Card>
        </>}
        <SaveBar {...d} />
      </div>
    </div>
  );
}

// E-mail como canal. Gmail: o caminho de 1 clique é o conector Gmail da conta Claude (login Google de verdade).
// Senha de app (IMAP/SMTP) serve para qualquer provedor; "Outro" mostra os servidores.
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
  const [gmailClaude, setGmailClaude] = useState(null); // conector Gmail do claude.ai: conectado?
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

// Guardião do GitHub: token + repositórios → um agente que revisa PRs, investiga CI e delega correções.
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
