import { useEffect, useState, useRef } from 'react';
import { MetalBadge } from 'metal-fx';
import { useApp } from '../app.jsx';
import { api, go, useDark } from '../lib.js';
import { Icon, Switch, Select, EmptyState } from '../ui.jsx';
import { AdvancedBlock, HelpTip } from '../disclosure.jsx';
import { ApprovalHistory } from '../approvals.jsx';
import { MODEL_DESC, EffortScale } from '../modelPicker.jsx';
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
    if (!window.confirm('Restaurar este snapshot? Isso sobrescreve os dados vivos em RIPPER_DATA (db.json, SQLite, sandbox, etc.).')) return;
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
            <input ref={fileRef} type="file" accept="application/json,.json" aria-label="Arquivo de backup JSON" onChange={e => restoreJson(e.target.files?.[0])} disabled={!!busy} />
            {busy === 'import' && <span className="muted" role="status">Restaurando…</span>}
          </div>
        </Row>
        {auto?.length > 0 && (
          <Row title="Backups automáticos de db.json" desc="Migração de schema ou antes de restaurar.">
            <ul className="mono small">{auto.map(n => <li key={n}>{n}</li>)}</ul>
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
  const { S } = useApp();
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
  useEffect(() => {
    if (tab === 'computer') api('/api/computer/docker').then(r => { setDocker(r.version); setImage(r.image); }).catch(() => setDocker(null));
    if (tab === 'models') api('/api/julia/status').then(r => setJulia(r.online)).catch(() => setJulia(false));
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
        </>}

        {tab === 'models' && <>
          <Card title="Padrão para agentes novos">
            <Row title="Modelo" desc="Cada agente e cada conversa podem trocar depois.">
              <Select label="Modelo padrão" value={s.defaultModel} onChange={v => set('defaultModel', v)} options={Object.entries(S.models).map(([k, m]) => ({ value: k, label: m.label, hint: MODEL_DESC[k] }))} />
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

        {tab === 'security' && <>
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
          {enterprise && <>
            <Card title={tr('settings.security.historyTitle')} desc={tr('settings.security.historyDesc')}>
              <ApprovalHistory limit={15} />
            </Card>
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
              </Card>
            </AdvancedBlock>
          </>}
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
