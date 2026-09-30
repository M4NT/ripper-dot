import { Icon, Menu } from './ui.jsx';
import { useApp } from './app.jsx';

export const EFFORTS = [
  // [chave, rótulo, rótulo curto da trilha, dica]
  ['auto', 'Automático', 'Auto', 'Automático: o modelo decide quanto pensar.'],
  ['low', 'Baixo', 'Baixo', 'Baixo: respostas rápidas para pedidos simples.'],
  ['medium', 'Médio', 'Médio', 'Médio: equilíbrio entre velocidade e cuidado.'],
  ['high', 'Alto', 'Alto', 'Alto: pensa mais antes de responder.'],
  ['xhigh', 'Muito alto', 'Extra', 'Muito alto: para problemas difíceis. Mais lento.'],
  ['max', 'Máximo', 'Máx', 'Máximo: todo o raciocínio disponível. O mais lento.']
];
export const effortLabel = k => EFFORTS.find(e => e[0] === k)?.[1] || 'Automático';

export const MODEL_DESC = {
  agent: 'Cada agente usa o modelo e o esforço que você definiu nele',
  auto: 'Julia 1 escolhe entre Sonnet, Opus e Codex a cada pedido',
  'claude-sonnet-5-5': 'Rápido para o dia a dia',
  'claude-opus-5-5': 'O mais capaz para raciocínio longo',
  'claude-fable-5-1': 'Voltado para escrita criativa',
  codex: 'Código e terminal, pela assinatura do ChatGPT'
};

/** Grade de esforço: botões numa trilha, o ativo preenchido. */
export function EffortScale({ value, onChange, model }) {
  const current = EFFORTS.find(e => e[0] === value) || EFFORTS[0];
  return (
    <div className="effort">
      <div className="effort-track" role="radiogroup" aria-label="Esforço">
        {EFFORTS.map(([k, l, short], i) => (
          <button key={k} type="button" role="radio" aria-checked={k === value} className={`effort-step ${k === value ? 'on' : ''} ${i <= EFFORTS.findIndex(e => e[0] === value) && value !== 'auto' && k !== 'auto' ? 'fill' : ''}`}
            onClick={() => onChange(k)} title={l}>{short}</button>
        ))}
      </div>
      <p className="effort-hint">{current[3]}{model === 'codex' && ['xhigh', 'max'].includes(value) ? ' No Codex, vira “alto”.' : ''}</p>
    </div>
  );
}

/** Seletor único de modelo + esforço, usado no campo de mensagem. */
export default function ModelPicker({ value, onChange, group }) {
  const { S } = useApp();
  const models = [...(group ? [['agent', { label: 'Padrão de cada agente' }]] : []), ...Object.entries(S.models)];
  const label = value.model === 'agent' ? 'Padrão dos agentes' : S.models[value.model]?.label.replace('Claude ', '') || 'Ripper Auto';
  return (
    <Menu align="up" className="model-picker" trigger={({ toggle, open }) => (
      <button type="button" className="chip" aria-expanded={open} aria-haspopup="dialog" onClick={toggle}>
        <Icon name="bolt" size={14} />{label}
        {value.model !== 'agent' && <span className="chip-sub">{effortLabel(value.effort)}</span>}
        <Icon name="down" size={13} />
      </button>
    )}>
      <div className="picker-pop" role="dialog" aria-label="Modelo e esforço">
        <p className="pop-label">Modelo</p>
        <div role="radiogroup" aria-label="Modelo">
          {models.map(([k, v]) => (
            <button key={k} type="button" role="radio" aria-checked={k === value.model} className={`menu-item model-item ${k === value.model ? 'on' : ''}`}
              onClick={() => onChange(v => ({ ...v, model: k }))}>
              <span><b>{v.label}</b><small>{MODEL_DESC[k]}</small></span>{k === value.model && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
        {value.model !== 'agent' && <>
          <p className="pop-label">Esforço</p>
          <EffortScale value={value.effort} model={value.model} onChange={effort => onChange(v => ({ ...v, effort }))} />
        </>}
      </div>
    </Menu>
  );
}
