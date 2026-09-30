import { useApp } from '../app.jsx';
import { Icon, Switch, Select } from '../ui.jsx';
import { MODEL_DESC } from '../modelPicker.jsx';
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

export default function Settings({ theme, toggleTheme }) {
  const { S } = useApp();
  const d = useSettingsDraft();
  const { s, set } = d;
  return (
    <div className="page narrow">
      <header className="page-head"><div><h1>Configurações</h1><p className="lede">Vale para todos os agentes.</p></div></header>

      <section className="settings-block">
        <h2>Você</h2>
        <label className="field">Seu nome<input value={s.name} maxLength={80} onChange={e => set('name', e.target.value)} placeholder="Ex.: Rafael" /><small>Os agentes usam isso quando falam com você.</small></label>
        <label className="field">Instruções gerais<textarea rows={5} value={s.customInstructions} maxLength={8000} onChange={e => set('customInstructions', e.target.value)} placeholder="Ex.: Sou dev frontend em SP. Respostas curtas, TypeScript no código." /><small>Entram em toda conversa, junto da skill token-the-ripper e das instruções de cada agente.</small></label>
      </section>

      <section className="settings-block">
        <h2>Padrões</h2>
        <div className="field"><span>Modelo padrão para agentes novos</span>
          <Select label="Modelo padrão" value={s.defaultModel} onChange={v => set('defaultModel', v)}
            options={Object.entries(S.models).map(([k, m]) => ({ value: k, label: m.label, hint: MODEL_DESC[k] }))} />
        </div>
        <label className="switch-row"><span><b>Memória</b><small>Deixa os agentes guardarem fatos úteis e usarem em conversas futuras.</small></span><Switch checked={s.memory} onChange={v => set('memory', v)} label="Memória" /></label>
        <div className="switch-row"><span><b>Tema</b><small>Agora: {theme === 'dark' ? 'escuro' : 'claro'}. O padrão segue o sistema.</small></span><button className="btn" onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />Usar tema {theme === 'dark' ? 'claro' : 'escuro'}</button></div>
      </section>

      <section className="settings-block">
        <h2>Atalhos</h2>
        <dl className="keys">
          <dt><kbd>Ctrl</kbd><kbd>K</kbd></dt><dd>Buscar conversas, agentes e ações</dd>
          <dt><kbd>Ctrl</kbd><kbd>,</kbd></dt><dd>Abrir configurações</dd>
          <dt><kbd>Enter</kbd></dt><dd>Enviar mensagem</dd>
          <dt><kbd>Shift</kbd><kbd>Enter</kbd></dt><dd>Nova linha</dd>
          <dt><kbd>Esc</kbd></dt><dd>Parar a resposta</dd>
        </dl>
      </section>
      <SaveBar {...d} />
    </div>
  );
}
