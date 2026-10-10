import { BotAvatar } from './fx/BotAvatar.jsx';
import { TOOL_INFO, TONES, FORMALITIES, useDark } from './lib.js';
import { AgentAvatar, Icon, Switch } from './ui.jsx';
import { useApp } from './app.jsx';
import { EffortScale } from './modelPicker.jsx';
import { AutonomyPick } from './autonomy.jsx';
import { isEnterpriseMode } from './uiMode.js';
import './styles/telas/agentForm.css';

const TYPES = ['clover', 'flower', 'triangle', 'square', 'blob', 'ghost', 'circle', 'drop', 'star', 'droid', 'mech', 'alien', 'hexagon', 'cat', 'cloud', 'pill', 'pebble', 'puddle'];
const COLORS = [null, '#1a1917', '#f2efe9', '#e8537a', '#f08a3c', '#f2c94c', '#3fae78', '#3aa7c9', '#5b6cf0', '#9b6cf0'];

export function Basics({ v, set, categories }) {
  return <>
    <label className="field">Nome do agente<input value={v.name} maxLength={60} onChange={e => set({ name: e.target.value })} placeholder="Ex.: Analista de dados" required /></label>
    <label className="field">Apelido <small className="muted">(opcional)</small><input value={v.nickname || ''} maxLength={30} onChange={e => set({ nickname: e.target.value })} placeholder="Ex.: Ripper — no grupo, @Ripper também chama este agente" /></label>
    <label className="field">Descrição<textarea rows={3} value={v.description} maxLength={200} onChange={e => set({ description: e.target.value })} placeholder="O que ele faz, para quem e quais problemas resolve." /><small>{v.description.length}/200</small></label>
    <div className="field"><span>Categoria</span>
      <div className="pills" role="radiogroup" aria-label="Categoria">
        {categories.map(c => <button key={c} type="button" role="radio" aria-checked={v.category === c} className={`pill ${v.category === c ? 'on' : ''}`} onClick={() => set({ category: c })}>{c}</button>)}
      </div>
    </div>
  </>;
}

export function agentStyleDraft(v) {
  const s = v.style || {};
  return {
    tone: s.tone || v.tone || 'direto',
    formality: s.formality || 'neutro',
    maxSentences: s.maxSentences ?? '',
    language: s.language || '',
    customHints: s.customHints || ''
  };
}

function patchStyle(v, patch) {
  const next = { ...agentStyleDraft(v), ...patch };
  const style = {
    tone: next.tone,
    formality: next.formality,
    ...(next.maxSentences !== '' && next.maxSentences != null ? { maxSentences: +next.maxSentences } : {}),
    ...(next.language ? { language: next.language } : {}),
    ...(next.customHints ? { customHints: next.customHints } : {})
  };
  return { style, tone: next.tone };
}

export function VoiceStyle({ v, set }) {
  const st = agentStyleDraft(v);
  const up = patch => set(patchStyle(v, patch));
  return <>
    <p className="muted">Define como o agente fala nas respostas, em toda conversa.</p>
    <div className="field"><span>Tom</span>
      <div className="pills" role="radiogroup" aria-label="Tom">
        {TONES.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={st.tone === k} className={`pill ${st.tone === k ? 'on' : ''}`} onClick={() => up({ tone: k })}>{l}</button>)}
      </div>
    </div>
    <div className="field"><span>Formalidade</span>
      <div className="pills" role="radiogroup" aria-label="Formalidade">
        {FORMALITIES.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={st.formality === k} className={`pill ${st.formality === k ? 'on' : ''}`} onClick={() => up({ formality: k })}>{l}</button>)}
      </div>
    </div>
    <label className="field">Máximo de frases (padrão 4)
      <input className="input narrow-input" type="number" min={1} max={20} placeholder="4" value={st.maxSentences === '' ? '' : st.maxSentences}
        onChange={e => up({ maxSentences: e.target.value === '' ? '' : e.target.value })} />
      <small>Respostas curtas por padrão; detalhes só quando pedirem.</small>
    </label>
    <label className="field">Idioma das respostas
      <input value={st.language} maxLength={40} onChange={e => up({ language: e.target.value })} placeholder="Ex.: pt-BR, inglês técnico" />
    </label>
    <label className="field">Dicas extras
      <textarea rows={3} value={st.customHints} maxLength={500} onChange={e => up({ customHints: e.target.value })} placeholder="Ex.: use emojis com moderação; evite jargão; prefira verbos no imperativo." />
    </label>
  </>;
}

export function InstructionsField({ v, set }) {
  return <label className="field">Instruções<textarea rows={8} value={v.instructions} maxLength={8000} onChange={e => set({ instructions: e.target.value })} placeholder="Defina o comportamento, as regras e o que ele nunca deve fazer." /><small>Entram em toda conversa, junto das suas instruções gerais.</small></label>;
}

/** instructions=false: a tela já mostra as instruções em outro lugar (ex.: Identidade do agente). */
export function Behavior({ v, set, settings, instructions = true }) {
  const allowFully = isEnterpriseMode(settings);
  return <>
    <AutonomyPick value={v.autonomyLevel} onChange={autonomyLevel => set({ autonomyLevel })} allowFullyAutonomous={allowFully} />
    {instructions && <InstructionsField v={v} set={set} />}
  </>;
}

export function ModelPick({ v, set }) {
  const { S } = useApp();
  const desc = { auto: 'O Ripper decide a cada pedido: Sonnet para o simples, Opus para o difícil, Codex para código. Se um falhar, troca sozinho.', 'claude-sonnet-5-5': 'Rápido e barato para o dia a dia.', 'claude-opus-5-5': 'O mais capaz para raciocínio longo.', 'claude-fable-5-1': 'Voltado para escrita criativa.', codex: 'Código e terminal, pela sua assinatura do ChatGPT.' };
  return (<>
    <div className="choice-list" role="radiogroup" aria-label="Modelo">
      {Object.entries(S.models).map(([k, m]) => (
        <label key={k} className={`choice ${v.model === k ? 'on' : ''}`}>
          <input type="radio" name="model" checked={v.model === k} onChange={() => set({ model: k })} />
          <span><b>{m.label}</b><small>{desc[k]}</small></span>
        </label>
      ))}
    </div>
    <div className="field"><span>Esforço padrão</span>
      <EffortScale value={v.effort || 'auto'} model={v.model} onChange={effort => set({ effort })} />
      <small>Quanto o modelo pensa antes de responder. Dá para mudar em cada conversa.</small>
    </div>
  </>);
}

export function Tools({ v, set }) {
  const { S } = useApp();
  const toggle = t => set({ tools: v.tools.includes(t) ? v.tools.filter(x => x !== t) : [...v.tools, t] });
  const notes = {
    computer: S.settings.computer.mode === 'off' ? 'O computador está desligado em Configurações → Computador.' : S.settings.computer.mode === 'boat' && !S.settings.computer.boatApiKey ? 'Falta a chave do boat.dev em Configurações → Computador.' : null,
    plugins: ' '
  };
  return (
    <ul className="toggle-list">
      {Object.entries(TOOL_INFO).map(([k, t]) => (
        <li key={k}>
          <label>
            <span className="toggle-ico"><Icon name={t.icon} /></span>
            <span className="toggle-text"><b>{t.label}</b><small>{t.desc}</small>{notes[k] && <small className={k === 'plugins' ? 'note-info' : 'note-inline'}>{notes[k]} {k === 'plugins' ? <a href="#/marketplace">Ver aplicativos</a> : k === 'computer' ? <a href="#/settings/computer">Abrir</a> : null}</small>}</span>
            <Switch checked={v.tools.includes(k)} onChange={() => toggle(k)} label={t.label} />
          </label>
        </li>
      ))}
    </ul>
  );
}

export function Appearance({ v, set }) {
  const dark = useDark();
  return <>
    <div className="appearance-stage"><AgentAvatar agent={{ ...v, status: 'online' }} size={120} interactive animate /></div>
    <div className="field"><span>Forma</span>
      <div className="avatar-grid" role="radiogroup" aria-label="Forma">
        {TYPES.map(t => (
          <button key={t} type="button" role="radio" aria-checked={v.avatar.type === t} aria-label={t} className={`avatar-opt ${v.avatar.type === t ? 'on' : ''}`} onClick={() => set({ avatar: { ...v.avatar, type: t } })}>
            <BotAvatar type={t} color={v.avatar.color || undefined} size={40} interactive={false} paused={v.avatar.type !== t} theme={dark ? 'dark' : 'light'} />
          </button>
        ))}
      </div>
    </div>
    <div className="field"><span>Cor</span>
      <div className="swatches" role="radiogroup" aria-label="Cor">
        {COLORS.map(c => (
          <button key={c || 'default'} type="button" role="radio" aria-checked={v.avatar.color === c} aria-label={c || 'Cor original da forma'}
            className={`swatch ${v.avatar.color === c ? 'on' : ''} ${c ? '' : 'swatch-auto'}`} style={c ? { background: c } : undefined}
            onClick={() => set({ avatar: { ...v.avatar, color: c } })} />
        ))}
      </div>
    </div>
    <div className="field"><span>Rosto</span>
      <div className="pills">
        {[['eyes', 'Só olhos'], ['mouth', 'Com boca']].map(([k, l]) => <button key={k} type="button" className={`pill ${v.avatar.face === k ? 'on' : ''}`} onClick={() => set({ avatar: { ...v.avatar, face: k } })}>{l}</button>)}
      </div>
    </div>
  </>;
}
