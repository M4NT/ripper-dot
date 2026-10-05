import { useEffect, useState } from 'react';
import { api } from './lib.js';
import { useApp } from './app.jsx';
import { Icon, Dialog, Switch } from './ui.jsx';

const MODE = { docker: 'Docker', local: 'Esta máquina', boat: 'Nuvem', off: 'Sem computador' };
const base = p => String(p || '').split(/[\\/]/).filter(Boolean).pop() || p;

/**
 * Faixa acima do composer: onde o agente trabalha nesta conversa — computador, pasta (ou repositório) e branch.
 * Conversa nova: a escolha fica pendente e vai junto com a 1ª mensagem.
 */
export default function WorkspaceBar({ chat, chatId, agent, pending, setPending, onChanged }) {
  const { S, toast } = useApp();
  const [open, setOpen] = useState(false);
  const ws = chatId ? chat?.workspace || null : pending;
  const hasComputer = agent?.tools?.includes('computer') && S.settings.computer?.mode !== 'off';

  async function apply(next) {
    setOpen(false);
    if (!chatId) return setPending(next);
    try { onChanged(await api(`/api/chats/${chatId}`, { method: 'PUT', body: { workspace: next } })); }
    catch (e) { toast(e.message, 'error'); }
  }

  return (
    <div className="ws-bar" role="group" aria-label="Onde o agente trabalha">
      <span className="ws-chip is-static" title={hasComputer ? 'Computador do agente' : 'Este agente não tem computador: só conversa e pesquisa.'}>
        <Icon name="terminal" size={13} />{hasComputer ? MODE[S.settings.computer.mode] : 'Sem computador'}
      </span>
      <button type="button" className={`ws-chip ${ws ? 'is-set' : ''}`} onClick={() => setOpen(true)} disabled={!hasComputer}
        title={ws?.path || ws?.repo || 'Escolher a pasta ou o repositório desta conversa'}>
        <Icon name="folder" size={13} />{ws ? (ws.kind === 'repo' ? ws.repo : base(ws.path)) : 'Escolher pasta'}<Icon name="down" size={12} />
      </button>
      {ws?.kind === 'folder' && chat?.workspaceBranch && <span className="ws-chip is-static"><Icon name="branch" size={13} />{chat.workspaceBranch}</span>}
      {ws?.readOnly && <span className="tag">somente leitura</span>}
      <WorkspacePicker open={open} current={ws} onClose={() => setOpen(false)} onPick={apply} />
    </div>
  );
}

function WorkspacePicker({ open, current, onClose, onPick }) {
  const [tab, setTab] = useState('folder');
  const [dir, setDir] = useState(null); // { path, parent, dirs, branch, blocked, recent }
  const [readOnly, setReadOnly] = useState(false);
  const [repo, setRepo] = useState('');
  const [error, setError] = useState('');
  const go = path => api(`/api/fs/dirs${path ? `?path=${encodeURIComponent(path)}` : ''}`).then(d => { setDir(d); setError(''); }).catch(e => setError(/Rota não encontrada/.test(e.message) ? 'O servidor do Ripper ainda está na versão anterior. Reinicie o Ripper para usar a pasta de trabalho.' : e.message));

  useEffect(() => {
    if (!open) return;
    setTab(current?.kind === 'repo' ? 'repo' : 'folder');
    setReadOnly(!!current?.readOnly);
    setRepo(current?.repo || '');
    go(current?.kind === 'folder' ? current.path : '');
  }, [open]);

  const recent = (dir?.recent || []).filter(r => r.kind === tab);
  return (
    <Dialog open={open} onClose={onClose} className="ws-picker" label="Pasta de trabalho">
      <h2>Onde o agente trabalha nesta conversa</h2>
      <div className="seg-choice ws-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'folder'} className={tab === 'folder' ? 'on' : ''} onClick={() => setTab('folder')}><b>Pasta desta máquina</b><small>projeto, documentos, planilhas</small></button>
        <button type="button" role="tab" aria-selected={tab === 'repo'} className={tab === 'repo' ? 'on' : ''} onClick={() => setTab('repo')}><b>Repositório</b><small>GitHub: o agente clona</small></button>
      </div>
      {recent.length > 0 && (
        <div className="ws-recent">
          <small className="muted">Recentes</small>
          {recent.map(r => (
            <button key={r.path || r.repo} type="button" className="ws-row" onClick={() => onPick(r)}>
              <Icon name={r.kind === 'repo' ? 'branch' : 'folder'} size={14} /><span>{r.repo || r.path}</span>{r.readOnly && <small>somente leitura</small>}
            </button>
          ))}
        </div>
      )}
      {tab === 'folder' ? (
        <>
          <div className="ws-path">
            <button type="button" className="icon-btn sm" disabled={!dir?.parent && !dir?.path} onClick={() => go(dir?.parent || '')} aria-label="Pasta acima"><Icon name="left" size={14} /></button>
            <code>{dir?.path || 'Atalhos'}</code>
            {dir?.branch && <span className="ws-chip is-static"><Icon name="branch" size={12} />{dir.branch}</span>}
          </div>
          {error && <p className="form-error">{error}</p>}
          <ul className="ws-dirs">
            {(dir?.dirs || []).map(d => (
              <li key={d.path}><button type="button" className="ws-row" onClick={() => go(d.path)}>
                <Icon name={d.git ? 'branch' : 'folder'} size={14} /><span>{d.name}</span>{d.git && <small>git</small>}
              </button></li>
            ))}
            {dir && !dir.dirs.length && <li className="muted small">Sem subpastas.</li>}
          </ul>
          <div className="ws-ro"><Switch checked={readOnly} onChange={setReadOnly} label="Somente leitura" /><span>Somente leitura <small className="muted">— o agente lê, mas não altera nada</small></span></div>
          {dir?.blocked && <p className="form-error">Por segurança, o agente não pode trabalhar em {dir.blocked}.</p>}
        </>
      ) : (
        <label className="ws-repo">
          <span>Repositório do GitHub</span>
          <input className="input" value={repo} onChange={e => setRepo(e.target.value)} placeholder="dono/nome — ex.: minha-empresa/site" autoFocus />
          <small className="muted">Público ou privado (privado usa o token do Guardião do GitHub, em Canais). Fica em /work/repos dentro do computador do agente.</small>
        </label>
      )}
      <div className="row end ws-actions">
        {current && <button type="button" className="btn" onClick={() => onPick(null)}>Tirar pasta</button>}
        <button type="button" className="btn" onClick={onClose}>Cancelar</button>
        {tab === 'folder'
          ? <button type="button" className="btn btn-primary" disabled={!dir?.path || !!dir?.blocked} onClick={() => onPick({ kind: 'folder', path: dir.path, readOnly })}>Usar esta pasta</button>
          : <button type="button" className="btn btn-primary" disabled={!/^\S+\/\S+$/.test(repo.trim())} onClick={() => onPick({ kind: 'repo', repo: repo.trim() })}>Usar repositório</button>}
      </div>
      {tab === 'folder' && <p className="muted small">O agente vê só esta pasta. São seus arquivos reais: ações arriscadas continuam pedindo aprovação.</p>}
    </Dialog>
  );
}
