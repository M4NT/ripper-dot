import { useState } from 'react';
import { Icon, Switch, EmptyState } from '../ui.jsx';
import { AdvancedBlock } from '../disclosure.jsx';
import { Card, Row } from './shared.jsx';

export default function PluginsSection({ s, set }) {
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
  return (
    <>
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
    </>
  );
}
