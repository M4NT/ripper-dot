import { useEffect, useState, useRef } from 'react';
import { MetalBadge } from 'metal-fx';
import { useApp } from '../app.jsx';
import { useOv } from '../overlay.jsx';
import { api, apiUpload, go, useDark, brandLogoSrc, TONES, FORMALITIES } from '../lib.js';
import { Icon, Switch, Select, EmptyState } from '../ui.jsx';
import { AdvancedBlock, HelpTip } from '../disclosure.jsx';
import { ApprovalHistory } from '../approvals.jsx';
import { MODEL_DESC, EffortScale, EFFORTS } from '../modelPicker.jsx';

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
  const backup = s.backup || { enabled: false, intervalHours: 24, keepCount: 5 };
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
          <Row title="Manter no disco"><div className="input-unit"><input className="input" type="number" min={1} max={50} value={backup.keepCount ?? 5} onChange={e => set('backup', { ...backup, keepCount: +e.target.value })} /><span>snapshots</span></div></Row>
        </>}
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

/** Linha de configuração: rótulo e explicação à esquerda, controle à direita. */
function Row({ title, desc, children, stack, tip }) {
  return (
    <div className={`set-row ${stack ? 'stack' : ''}`}>
      <div className="set-label"><b>{title}</b>{tip && <HelpTip text={tip} />}{desc && <small>{desc}</small>}</div>
      <div className="set-control">{children}</div>
    </div>
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
  const [sandboxSt, setSandboxSt] = useState(null);
  useEffect(() => {
    if (tab === 'computer') api('/api/computer/docker').then(r => { setDocker(r.version); setImage(r.image); }).catch(() => setDocker(null));
    if (tab === 'models') api('/api/julia/status').then(r => setJulia(r.online)).catch(() => setJulia(false));
    if (tab === 'security') api('/api/sandbox/status').then(setSandboxSt).catch(() => setSandboxSt(null));
  }, [tab]);
  const current = allowedTabs.find(([k]) => k === tab) || allowedTabs[0];

  return (
    <div className="settings-page">
      <nav className="settings-nav" aria-label={tr('settings.navLabel')}>
        <h1>{tr('settings.title')}</h1>
        {allowedTabs.map(([k, l, ic, hint]) => (
          <a key={k} href={`#/settings/${k}`} className={k === tab ? 'on' : ''} aria-current={k === tab ? 'page' : undefined}>
            <Icon name={ic} size={17} /><span><b>{l}</b><small>{hint}</small></span>
          </a>
        ))}
        {!enterprise && (
          <p className="settings-simple-hint muted small">Modelos, Docker, plugins e backup ficam no <a href="#/settings/appearance">modo Enterprise</a>.</p>
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
        </>}

        {tab === 'models' && <>
          <Card title="Modelos disponíveis" desc="Desligue as IAs que você não quer usar e limite o esforço de cada uma. O Ripper Auto e a Julia 1 só escolhem dentro disso, e nenhum pedido passa do teto.">
            {Object.entries(S.models).filter(([k]) => k !== 'auto').map(([k, m]) => {
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
          <Card title="Padrão para agentes novos">
            <Row title="Modelo" desc="Cada agente e cada conversa podem trocar depois.">
              <Select label="Modelo padrão" value={s.defaultModel} onChange={v => set('defaultModel', v)} options={Object.entries(S.models).filter(([k]) => k === 'auto' || s.models?.enabled?.[k] !== false).map(([k, m]) => ({ value: k, label: m.label, hint: MODEL_DESC[k] }))} />
            </Row>
          </Card>
          <Card title="Claude" badge={<span className="tag">Opus 5.5 · Sonnet 5.5 · Fable 5.1</span>}>
            <Row title="Como conectar">
              <div className="seg-choice">
                {[['subscription', 'Assinatura', 'claude login desta máquina'], ['api', 'API key', 'paga por token']].map(([k, l, h]) => (
                  <button key={k} type="button" className={s.claude.mode === k ? 'on' : ''} onClick={() => set('claude.mode', k)}><b>{l}</b><small>{h}</small></button>
                ))}
              </div>
            </Row>
            {s.claude.mode === 'api' && <Row title="Anthropic API key"><input className="input" type="password" autoComplete="off" value={s.claude.apiKey} onChange={e => set('claude.apiKey', e.target.value)} placeholder="sk-ant-…" /></Row>}
            <Row title="Conectores do claude.ai" desc="Gmail, Drive e outros. Carregar custa tokens: só vale para agentes com Plugins MCP."><Switch checked={s.claude.useConnectors} onChange={v => set('claude.useConnectors', v)} label="Conectores do claude.ai" /></Row>
          </Card>
          <Card title="Fila de entrada" desc="Mensagens seguidas no composer são agrupadas num único turno. Enter reinicia a janela; o botão Enviar manda na hora.">
            <Row title="Agrupar mensagens consecutivas"><Switch checked={s.inputQueue?.enabled !== false} onChange={v => set('inputQueue', { ...(s.inputQueue || {}), enabled: v })} label="Coalescing ativo" /></Row>
            <Row title="Janela de agrupamento" desc="Tempo de espera após Enter antes de mandar ao agente (0 desliga o atraso quando o coalescing está ativo).">
              <div className="input-unit"><input className="input" type="number" min={0} max={10} step={0.5} value={(s.inputQueue?.windowMs ?? 2500) / 1000} onChange={e => set('inputQueue', { ...(s.inputQueue || {}), windowMs: Math.round(+e.target.value * 1000) })} /><span>segundos</span></div>
            </Row>
          </Card>
          <Card title="ChatGPT" badge={<span className="tag">Codex</span>}>
            <Row title="Login" desc="Rode codex login uma vez nesta máquina. Sem o Codex instalado, o Ripper Auto usa só o Claude."><code className="inline-code">npm i -g @openai/codex</code></Row>
            <Row title="Apps conectados do ChatGPT" desc="Quando houver suporte."><Switch checked={s.chatgpt.useConnectedApps} onChange={v => set('chatgpt.useConnectedApps', v)} label="Apps do ChatGPT" /></Row>
          </Card>
          <Card title="Ripper Auto" badge={<><MetalBadge theme={dark ? 'dark' : 'light'}>Julia 1</MetalBadge>{julia === null ? <span className="tag" role="status">Verificando…</span> : <span className={`tag ${julia ? 'tag-ok' : 'tag-warn'}`}>{julia ? 'no ar' : 'fora do ar'}</span>}</>} desc="A Julia 1 escolhe modelo e prioridades antes do modelo grande. Fora do ar, as regras de reserva decidem.">
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
              {docker === null && <p className="form-error">Abra o Docker Desktop e recarregue esta página.</p>}
              <Row title="Imagem de referência" desc="ripper-agent:1 já vem com Chromium, tela virtual (noVNC), Node 22 e Python 3." tip="Cada agente ganha um contêiner isolado; arquivos ficam na pasta do agente, não na sua máquina.">
                <div className="row">{image && <span className={`tag ${image === 'ready' ? 'tag-ok' : 'tag-warn'}`}>{image === 'ready' ? 'pronta' : image === 'building' ? 'construindo…' : 'não construída'}</span>}
                  {image === 'missing' && <button className="btn btn-sm" onClick={() => api('/api/computer/image', { method: 'POST' }).then(r => setImage(r.image))}>Construir agora</button>}</div>
              </Row>
              <AdvancedBlock settings={s} hint="Imagem customizada e tempo ocioso" className="in-card">
                <Row title="Imagem usada" desc="Deixe ripper-agent:1, a não ser que você tenha uma imagem própria."><input className="input" value={['', 'node:22-bookworm'].includes(s.computer.dockerImage || '') ? 'ripper-agent:1' : s.computer.dockerImage} onChange={e => set('computer.dockerImage', e.target.value)} /></Row>
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
        {tab === 'plugins' && enterprise && (() => {
          const w = s.whatsapp || {};
          const setW = (k, v) => set('whatsapp', { ...w, [k]: v });
          const hook = `${location.origin}/api/channels/whatsapp/webhook`;
          return (
            <Card title="Canal WhatsApp" desc="Um agente responde quem escreve no seu número do WhatsApp Business (API oficial da Meta, WhatsApp Cloud API). Cada contato vira uma conversa aqui, que você acompanha e pode assumir.">
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

        {tab === 'backup' && <DataBackup s={s} set={set} />}

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
