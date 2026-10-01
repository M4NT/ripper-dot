import { useEffect, useState, useRef } from 'react';
import { MetalBadge } from 'metal-fx';
import { useApp } from '../app.jsx';
import { api, go, useDark } from '../lib.js';
import { Icon, Switch, Select, EmptyState } from '../ui.jsx';
import { ApprovalHistory } from '../approvals.jsx';
import { MODEL_DESC, EffortScale } from '../modelPicker.jsx';
import { useSettingsDraft } from '../settingsForm.js';

export function SaveBar({ dirty, saving, save, reset }) {
  if (!dirty) return null;
  return (
    <div className="save-bar" role="region" aria-label="Alterações não salvas">
      <span>Você tem alterações não salvas.</span>
      <button className="btn" onClick={reset}>Descartar</button>
      <button className="btn btn-primary" disabled={saving} onClick={() => save()}>{saving ? 'Salvando…' : 'Salvar alterações'}</button>
    </div>
  );
}

function DataBackup() {
  const { refresh, toast } = useApp();
  const [auto, setAuto] = useState(null);
  const [busy, setBusy] = useState('');
  const fileRef = useRef(null);
  useEffect(() => { api('/api/data/backups').then(r => setAuto(r.auto || [])).catch(() => setAuto([])); }, []);
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
      toast('Backup baixado (inclui segredos — guarde com cuidado)');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(''); }
  };
  const restore = async file => {
    if (!file) return;
    setBusy('import');
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      await api('/api/data/restore', { method: 'POST', body: { confirm: true, backup } });
      await refresh();
      toast('Estado restaurado a partir do backup');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  };
  return (
    <Card title="Backup e restauração" desc="Exporta ou substitui db.json (agentes, conversas, configurações). Arquivos em sandbox/ e usage.sqlite não entram no JSON — copie a pasta RIPPER_DATA inteira para backup completo.">
      <Row title="Exportar" desc="JSON com chaves de API e tokens OAuth (sensível).">
        <button type="button" className="btn" disabled={!!busy} onClick={download} aria-busy={busy === 'export'}>{busy === 'export' ? 'Gerando…' : 'Baixar backup'}</button>
      </Row>
      <Row title="Restaurar" desc="Grava db.pre-restore.*.backup.json antes de substituir.">
        <div className="row">
          <input ref={fileRef} type="file" accept="application/json,.json" aria-label="Arquivo de backup JSON" onChange={e => restore(e.target.files?.[0])} disabled={!!busy} />
          {busy === 'import' && <span className="muted" role="status">Restaurando…</span>}
        </div>
      </Row>
      {auto?.length > 0 && (
        <Row title="Backups automáticos" desc="Criados na migração de schema ou antes de restaurar.">
          <ul className="mono small">{auto.map(n => <li key={n}>{n}</li>)}</ul>
        </Row>
      )}
    </Card>
  );
}

export const SETTINGS_TABS = [
  ['profile', 'Perfil', 'agents', 'Seu nome e instruções gerais'],
  ['models', 'Modelos', 'bolt', 'Claude, ChatGPT e Ripper Auto'],
  ['computer', 'Computador', 'terminal', 'Onde os agentes executam'],
  ['plugins', 'Plugins', 'plug', 'Servidores MCP'],
  ['security', 'Segurança', 'key', 'Aprovações e limites'],
  ['memory', 'Memória', 'brain', 'O que os agentes lembram'],
  ['appearance', 'Aparência', 'sun', 'Tema e atalhos']
];

/** Linha de configuração: rótulo e explicação à esquerda, controle à direita. */
function Row({ title, desc, children, stack }) {
  return (
    <div className={`set-row ${stack ? 'stack' : ''}`}>
      <div className="set-label"><b>{title}</b>{desc && <small>{desc}</small>}</div>
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
    <Card title="Adicionar plugin">
      <form onSubmit={add}>
        <Row title="Nome" desc="Letras, números, - e _."><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="github" /></Row>
        <Row title="URL ou comando" desc="Endereço HTTP do servidor MCP ou o comando que o inicia."><input className="input" value={target} onChange={e => setTarget(e.target.value)} placeholder="npx -y @modelcontextprotocol/server-github" /></Row>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="set-actions"><button className="btn"><Icon name="plus" size={16} />Adicionar plugin</button></div>
      </form>
    </Card>
  </>;
}

export default function Settings({ theme, toggleTheme, tab: initial }) {
  const { S } = useApp();
  const d = useSettingsDraft();
  const { s, set } = d;
  const dark = useDark();
  const tab = SETTINGS_TABS.some(t => t[0] === initial) ? initial : 'profile';
  const [docker, setDocker] = useState(undefined);
  const [image, setImage] = useState(null);
  const [julia, setJulia] = useState(null);
  useEffect(() => {
    if (tab === 'computer') api('/api/computer/docker').then(r => { setDocker(r.version); setImage(r.image); }).catch(() => setDocker(null));
    if (tab === 'models') api('/api/julia/status').then(r => setJulia(r.online)).catch(() => setJulia(false));
  }, [tab]);
  const current = SETTINGS_TABS.find(t => t[0] === tab);

  return (
    <div className="settings-page">
      <nav className="settings-nav" aria-label="Seções de configuração">
        <h1>Configurações</h1>
        {SETTINGS_TABS.map(([k, l, ic, hint]) => (
          <a key={k} href={`#/settings/${k}`} className={k === tab ? 'on' : ''} aria-current={k === tab ? 'page' : undefined}>
            <Icon name={ic} size={17} /><span><b>{l}</b><small>{hint}</small></span>
          </a>
        ))}
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
          <Card title="Limites do provedor" desc="Quando a API devolve rate limit (429), o Ripper espera de forma honesta antes de tentar de novo ou mudar de modelo. Não inventamos cotas — só usamos o que o erro informar.">
            <Row title="Tentativas por modelo" desc="Inclui a primeira chamada. Depois disso, pode haver fallback para outro provedor.">
              <div className="input-unit"><input className="input" type="number" min={1} max={6} value={s.providerRetry?.maxAttempts ?? 3} onChange={e => set('providerRetry', { ...(s.providerRetry || {}), maxAttempts: +e.target.value })} /><span>tentativas</span></div>
            </Row>
            <Row title="Espera máxima entre tentativas"><div className="input-unit"><input className="input" type="number" min={1} max={120} value={Math.round((s.providerRetry?.maxDelayMs ?? 60000) / 1000)} onChange={e => set('providerRetry', { ...(s.providerRetry || {}), maxDelayMs: +e.target.value * 1000 })} /><span>segundos</span></div></Row>
          </Card>
          <Card title="ChatGPT" badge={<span className="tag">Codex</span>}>
            <Row title="Login" desc="Rode codex login uma vez nesta máquina. Sem o Codex instalado, o Ripper Auto usa só o Claude."><code className="inline-code">npm i -g @openai/codex</code></Row>
            <Row title="Ferramentas Ripper" desc="Com o Codex, remember, artefatos, inbox e o resto do MCP ripper vão por stdio (como plugins). WebSearch do Claude e conectores claude.ai não existem no Codex; plugins HTTP MCP funcionam nos dois." />
            <Row title="Apps conectados do ChatGPT" desc="Quando houver suporte."><Switch checked={s.chatgpt.useConnectedApps} onChange={v => set('chatgpt.useConnectedApps', v)} label="Apps do ChatGPT" /></Row>
          </Card>
          <Card title="Ripper Auto" badge={<><MetalBadge theme={dark ? 'dark' : 'light'}>Julia 1</MetalBadge>{julia === null ? <span className="tag" role="status">Verificando…</span> : <span className={`tag ${julia ? 'tag-ok' : 'tag-warn'}`}>{julia ? 'no ar' : 'fora do ar'}</span>}</>} desc="A Julia 1 decide rápido e barato, antes do modelo grande: qual modelo usar, quem do time responde, se um comando é arriscado e se uma rotina deve notificar, silenciar ou escalar. Fora do ar, as regras de reserva decidem.">
            <Row title="Endereço do Julia 1" desc="Suba com npm run julia."><input className="input" value={s.julia.url} onChange={e => set('julia.url', e.target.value)} /></Row>
          </Card>
        </>}

        {tab === 'computer' && <>
          <Card title="Onde os agentes executam">
            <div className="mode-grid">
              {[['docker', 'Docker', 'Grátis', 'Um contêiner Linux por agente nesta máquina. Isolado.', 'terminal'],
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
              <Row title="Imagem de referência" desc="ripper-agent:1 já vem com Chromium, tela virtual (noVNC), Node 22 e Python 3. Criar a VM de um agente leva segundos. Todos ficam na rede ripper-net e compartilham /shared.">
                <div className="row">{image && <span className={`tag ${image === 'ready' ? 'tag-ok' : 'tag-warn'}`}>{image === 'ready' ? 'pronta' : image === 'building' ? 'construindo…' : 'não construída'}</span>}
                  {image === 'missing' && <button className="btn btn-sm" onClick={() => api('/api/computer/image', { method: 'POST' }).then(r => setImage(r.image))}>Construir agora</button>}</div>
              </Row>
              <Row title="Imagem usada" desc="Deixe ripper-agent:1, a não ser que você tenha uma imagem própria."><input className="input" value={['', 'node:22-bookworm'].includes(s.computer.dockerImage || '') ? 'ripper-agent:1' : s.computer.dockerImage} onChange={e => set('computer.dockerImage', e.target.value)} /></Row>
              <Row title="Parar ocioso após" desc="O contêiner para; os arquivos ficam na pasta do agente."><div className="input-unit"><input className="input" type="number" min={1} max={1440} value={s.computer.idleStopMinutes} onChange={e => set('computer.idleStopMinutes', +e.target.value)} /><span>min</span></div></Row>
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
              <Row title="Permitir comandos locais" desc="Os agentes acessam arquivos e programas desta máquina. Cada comando pede sua aprovação."><Switch checked={!!s.computer.allowLocalCommands} onChange={v => set('computer.allowLocalCommands', v)} label="Permitir comandos locais" /></Row>
            </Card>
          )}
        </>}

        {tab === 'plugins' && <Plugins s={s} set={set} />}

        {tab === 'security' && <>
          <Card title="Aprovação de ações" desc="Os agentes pausam e esperam seu ok antes de ações que podem causar estrago. Sem resposta em 10 minutos, o pedido é negado.">
            <div className="mode-grid three">
              {[['risky', 'Só ações de risco', 'Recomendado', 'Apagar em massa, sudo, git push, publicar, scripts da internet.'],
                ['always', 'Toda ação', '', 'Você aprova cada comando no computador.'],
                ['never', 'Nunca pedir', 'Não recomendado', 'Na sua máquina (pasta local), sempre pede.']].map(([k, t, tag, dsc]) => (
                <button key={k} type="button" className={`mode ${(s.approvalPolicy || 'risky') === k ? 'on' : ''}`} onClick={() => set('approvalPolicy', k)} aria-pressed={(s.approvalPolicy || 'risky') === k}>
                  <b>{t}{tag && <span className={`tag ${k === 'risky' ? 'tag-ok' : 'tag-warn'}`}>{tag}</span>}</b><small>{dsc}</small>
                </button>
              ))}
            </div>
          </Card>
          <Card title="Histórico de aprovações" desc="Decisões recentes nesta instalação (aprovado, negado ou expirado).">
            <ApprovalHistory limit={15} />
          </Card>
          <Card title="Mensagens entre agentes" desc="Limites para os agentes não entrarem em conversa infinita entre si.">
            <Row title="Máximo por agente, por hora"><div className="input-unit"><input className="input" type="number" min={1} max={200} value={s.inbox?.maxPerHour ?? 20} onChange={e => set('inbox', { ...(s.inbox || {}), maxPerHour: +e.target.value })} /><span>mensagens</span></div></Row>
            <Row title="Profundidade máxima de uma troca" desc="Quantas vezes uma resposta pode gerar outra mensagem."><div className="input-unit"><input className="input" type="number" min={1} max={10} value={s.inbox?.maxHops ?? 3} onChange={e => set('inbox', { ...(s.inbox || {}), maxHops: +e.target.value })} /><span>saltos</span></div></Row>
          </Card>
          <DataBackup />
        </>}

        {tab === 'memory' && <>
          <Card>
            <Row title="Memória" desc="Deixa os agentes guardarem fatos úteis e usarem em conversas futuras."><Switch checked={s.memory} onChange={v => set('memory', v)} label="Memória" /></Row>
            <Row title="Registro recente no contexto" desc="Quantas anotações datadas (as mais novas) entram em cada conversa. O perfil estável entra sempre."><div className="input-unit"><input className="input" type="number" min={0} max={50} value={s.memoryLogInContext ?? 10} onChange={e => set('memoryLogInContext', +e.target.value)} /><span>itens</span></div></Row>
          </Card>
          <Card title="Como funciona" desc="Perfil: fatos estáveis sobre você (preferências, contexto). Registro: anotações datadas do que aconteceu. Gerencie tudo na Biblioteca.">
            <div className="set-actions"><button className="btn" onClick={() => go('/library')}><Icon name="book" size={16} />Abrir Biblioteca</button></div>
          </Card>
        </>}

        {tab === 'appearance' && <>
          <Card title="Modo da interface" desc="O modo simples oculta o Centro admin. Enterprise expõe operações (auditoria, retenção, LGPD) sem mudar o núcleo do chat.">
            <Row title="Experiência">
              <div className="seg-choice">
                {[['simple', 'Simples', 'Uso pessoal e equipes pequenas'], ['enterprise', 'Enterprise', 'Centro admin e visão de operações']].map(([k, l, h]) => {
                  const ent = s.ui?.mode === 'enterprise' || s.enterprise?.enabled;
                  const on = k === 'enterprise' ? ent : !ent;
                  return (
                  <button key={k} type="button" className={on ? 'on' : ''} onClick={() => {
                    if (k === 'enterprise') {
                      set('ui', { ...(s.ui || {}), mode: 'enterprise' });
                      set('enterprise', { ...(s.enterprise || {}), enabled: true });
                    } else {
                      set('ui', { ...(s.ui || {}), mode: 'simple' });
                      set('enterprise', { ...(s.enterprise || {}), enabled: false });
                    }
                  }}><b>{l}</b><small>{h}</small></button>
                  );
                })}
              </div>
            </Row>
            {(s.ui?.mode === 'enterprise' || s.enterprise?.enabled) && (
              <div className="set-actions">
                <button type="button" className="btn" onClick={() => go('/admin')}><Icon name="grid" size={16} />Abrir Centro admin</button>
              </div>
            )}
          </Card>
          <Card>
            <Row title="Tema" desc={`Agora: ${theme === 'dark' ? 'escuro' : 'claro'}. O padrão segue o sistema.`}><button className="btn" onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />Usar tema {theme === 'dark' ? 'claro' : 'escuro'}</button></Row>
          </Card>
          <Card title="Atalhos">
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
