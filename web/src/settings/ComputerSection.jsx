import { useEffect, useState } from 'react';
import { api } from '../lib.js';
import { Icon, Switch, Select } from '../ui.jsx';
import { AdvancedBlock } from '../disclosure.jsx';
import { Card, Row } from './shared.jsx';

export default function ComputerSection({ s, set }) {
  const [docker, setDocker] = useState(undefined);
  const [image, setImage] = useState(null);
  useEffect(() => {
    api('/api/computer/docker').then(r => { setDocker(r.version); setImage(r.outdated && r.image === 'missing' ? 'outdated' : r.image); }).catch(() => setDocker(null));
  }, []);
  return (
    <>
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
    </>
  );
}
