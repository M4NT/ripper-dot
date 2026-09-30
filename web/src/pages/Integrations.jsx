import { useDark } from '../lib.js';
import { useState } from 'react';
import { MetalBadge } from 'metal-fx';
import { useApp } from '../app.jsx';
import { Icon, Switch, EmptyState, Select } from '../ui.jsx';
import { useSettingsDraft } from '../settingsForm.js';
import { SaveBar } from './Settings.jsx';

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
    {s.plugins.length === 0
      ? <EmptyState title="Nenhum plugin" body="Plugins são servidores MCP: dão aos agentes ferramentas como GitHub, Linear ou a sua própria API." />
      : <ul className="rows">{s.plugins.map((p, i) => (
        <li key={p.name} className="row-item">
          <span className="thumb file-ico"><Icon name="plug" size={18} /></span>
          <div className="row-main"><b>{p.name} <span className="tag">{p.type}</span></b><small className="mono">{p.url || [p.command, ...(p.args || [])].join(' ')}</small></div>
          <Switch checked={p.enabled !== false} onChange={v => set('plugins', s.plugins.map((x, j) => j === i ? { ...x, enabled: v } : x))} label={`Ativar ${p.name}`} />
          <button className="icon-btn sm" aria-label={`Remover ${p.name}`} onClick={() => set('plugins', s.plugins.filter((_, j) => j !== i))}><Icon name="trash" size={16} /></button>
        </li>
      ))}</ul>}
    <form className="card-form" onSubmit={add}>
      <h3 className="sub">Adicionar plugin</h3>
      <div className="row stack-sm">
        <label className="field">Nome<input value={name} onChange={e => setName(e.target.value)} placeholder="github" /></label>
        <label className="field grow">URL ou comando<input value={target} onChange={e => setTarget(e.target.value)} placeholder="https://…/mcp  ou  npx -y @modelcontextprotocol/server-github" /></label>
      </div>
      {err && <p className="form-error" role="alert">{err}</p>}
      <button className="btn"><Icon name="plus" size={16} />Adicionar</button>
      <p className="muted small">Só ferramentas de agentes com “Plugins MCP” ligado usam isso.</p>
    </form>
  </>;
}

export default function Integrations() {
  const d = useSettingsDraft();
  const { s, set } = d;
  const dark = useDark();
  return (
    <div className="page narrow">
      <header className="page-head"><div><h1>Integrações</h1><p className="lede">Modelos, computador e plugins que seus agentes usam.</p></div></header>

      <section className="settings-block">
        <h2>Modelos</h2>
        <p className="muted">O Ripper roda nas assinaturas que você já tem.</p>
        <div className="provider">
          <div className="provider-head"><b>Claude</b><span className="tag">Opus 5.5 · Sonnet 5.5 · Fable 5.1</span></div>
          <div className="choice-list two">
            <label className={`choice ${s.claude.mode === 'subscription' ? 'on' : ''}`}><input type="radio" name="cm" checked={s.claude.mode === 'subscription'} onChange={() => set('claude.mode', 'subscription')} /><span><b>Assinatura</b><small>Usa o <code>claude login</code> desta máquina.</small></span></label>
            <label className={`choice ${s.claude.mode === 'api' ? 'on' : ''}`}><input type="radio" name="cm" checked={s.claude.mode === 'api'} onChange={() => set('claude.mode', 'api')} /><span><b>API key</b><small>Paga por token.</small></span></label>
          </div>
          {s.claude.mode === 'api' && <label className="field">Anthropic API key<input type="password" autoComplete="off" value={s.claude.apiKey} onChange={e => set('claude.apiKey', e.target.value)} placeholder="sk-ant-…" /></label>}
          <label className="switch-row"><span><b>Usar meus conectores do claude.ai</b><small>Gmail, Drive e outros conectados à sua conta.</small></span><Switch checked={s.claude.useConnectors} onChange={v => set('claude.useConnectors', v)} label="Conectores do claude.ai" /></label>
        </div>
        <div className="provider">
          <div className="provider-head"><b>ChatGPT</b><span className="tag">Codex</span></div>
          <p className="muted small">Rode <code>codex login</code> uma vez nesta máquina.</p>
          <label className="switch-row"><span><b>Usar meus apps conectados do ChatGPT</b><small>Quando houver suporte.</small></span><Switch checked={s.chatgpt.useConnectedApps} onChange={v => set('chatgpt.useConnectedApps', v)} label="Apps do ChatGPT" /></label>
        </div>
        <div className="provider">
          <div className="provider-head"><b>Ripper Auto</b><MetalBadge theme={dark ? 'dark' : 'light'}>Julia 1</MetalBadge></div>
          <p className="muted small">O classificador Julia 1 lê cada pedido e escolhe Sonnet 5.5 (simples), Opus 5.5 (difícil) ou Codex (código). Se um provedor falhar, a conversa passa para o outro.</p>
          <label className="field">Endereço do Julia 1<input value={s.julia.url} onChange={e => set('julia.url', e.target.value)} /><small>Sem o Julia no ar, uma regra por palavras-chave decide. Suba com <code>npm run julia</code>.</small></label>
        </div>
      </section>

      <section className="settings-block">
        <h2>Computador</h2>
        <div className="choice-list">
          {[['boat', 'Boat cloud VM', 'Cada agente ganha a própria VM Linux no boat.dev: instala pacotes, roda apps e compartilha links.'],
            ['local', 'Pasta local', 'Comandos rodam numa pasta desta máquina. Sem isolamento real: use só com agentes de confiança.'],
            ['off', 'Desligado', 'Sem computador. Os agentes ainda pesquisam e lembram.']].map(([k, t, dsc]) => (
            <label key={k} className={`choice ${s.computer.mode === k ? 'on' : ''}`}><input type="radio" name="cmp" checked={s.computer.mode === k} onChange={() => set('computer.mode', k)} /><span><b>{t}</b><small>{dsc}</small></span></label>
          ))}
        </div>
        {s.computer.mode === 'local' && <label className="switch-row"><span><b>Permitir comandos locais</b><small>Comandos do agente terão acesso aos arquivos e programas desta máquina. Ative apenas para agentes de confiança.</small></span><Switch checked={!!s.computer.allowLocalCommands} onChange={v => set('computer.allowLocalCommands', v)} label="Permitir comandos locais" /></label>}
        {s.computer.mode === 'boat' && <>
          <label className="field">Boat API key<input type="password" autoComplete="off" value={s.computer.boatApiKey} onChange={e => set('computer.boatApiKey', e.target.value)} placeholder="boat_…" /><small>Crie uma no painel do boat.dev.</small></label>
          <div className="row stack-sm">
            <div className="field grow"><span>Tamanho da VM</span>
              <Select label="Tamanho da VM" value={s.computer.vmSize} onChange={v => set('computer.vmSize', v)} options={[
                { value: 'small', label: 'Pequena', hint: '2 vCPU · 4 GB' },
                { value: 'default', label: 'Padrão', hint: '4 vCPU · 8 GB' },
                { value: 'large', label: 'Grande', hint: '8 vCPU · 16 GB' }]} />
            </div>
            <label className="field">Parar ociosa após (min)<input type="number" min={1} max={1440} value={s.computer.idleStopMinutes} onChange={e => set('computer.idleStopMinutes', +e.target.value)} /></label>
          </div>
          <p className="muted small">VMs ociosas são paradas e salvas em snapshot, e voltam quando o agente precisa.</p>
        </>}
      </section>

      <section className="settings-block">
        <h2>Plugins MCP</h2>
        <Plugins s={s} set={set} />
      </section>
      <SaveBar {...d} />
    </div>
  );
}
