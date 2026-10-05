import { Icon, Menu } from './ui.jsx';
import { useApp } from './app.jsx';
import ModelUsage from './modelUsage.jsx';
import { isEnterpriseMode } from './uiMode.js';

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

// Espelho de lib/router.mjs: modelos liberados e teto de esforço (Configurações → Modelos).
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const isModelEnabled = (settings, id) => id === 'auto' || id === 'agent' || settings?.models?.enabled?.[id] !== false;
export const effortCap = (settings, id) => (LEVELS.includes(settings?.models?.maxEffort?.[id]) ? settings.models.maxEffort[id] : 'max');

export const MODEL_DESC = {
  agent: 'Cada agente usa o modelo e o esforço que você definiu nele',
  auto: 'Julia 1 escolhe entre Sonnet, Opus e Codex a cada pedido',
  'claude-sonnet-5-5': 'Rápido para o dia a dia',
  'claude-opus-5-5': 'O mais capaz para raciocínio longo',
  'claude-fable-5-1': 'Voltado para escrita criativa',
  'claude-haiku-4-5': 'O mais econômico, para mensagens curtas',
  codex: 'Código e terminal, pela assinatura do ChatGPT'
};

/** Grade de esforço: botões numa trilha, o ativo preenchido. */
export function EffortScale({ value, onChange, model }) {
  const { S } = useApp();
  const cap = model && model !== 'auto' && model !== 'agent' ? effortCap(S.settings, model) : 'max';
  const over = k => k !== 'auto' && LEVELS.indexOf(k) > LEVELS.indexOf(cap);
  const current = EFFORTS.find(e => e[0] === value) || EFFORTS[0];
  return (
    <div className="effort">
      <div className="effort-track" role="radiogroup" aria-label="Esforço">
        {EFFORTS.map(([k, l, short], i) => (
          <button key={k} type="button" role="radio" aria-checked={k === value} className={`effort-step ${k === value ? 'on' : ''} ${i <= EFFORTS.findIndex(e => e[0] === value) && value !== 'auto' && k !== 'auto' ? 'fill' : ''}`}
            disabled={over(k)} onClick={() => onChange(k)} title={over(k) ? `${l} — acima do limite deste modelo` : l}>{short}</button>
        ))}
      </div>
      <p className="effort-hint">{over(value) ? `Limite deste modelo: ${effortLabel(cap).toLowerCase()}. ` : ''}{current[3]}{model === 'codex' && ['xhigh', 'max'].includes(value) ? ' No Codex, vira “alto”.' : ''}</p>
    </div>
  );
}

/** Seletor único de modelo + esforço, usado no campo de mensagem. */
export default function ModelPicker({ value, onChange, group, chatId }) {
  const { S } = useApp();
  const models = [...(group ? [['agent', { label: 'Padrão de cada agente' }]] : []), ...Object.entries(S.models).filter(([k]) => isModelEnabled(S.settings, k))];
  const label = value.model === 'agent' ? 'Padrão dos agentes' : value.model === 'auto' ? 'Ripper Auto' : (S.models[value.model]?.label.replace('Claude ', '') || value.model);
  const effort = value.model === 'agent' ? null : effortLabel(value.effort);
  const showUsage = isEnterpriseMode(S.settings);
  return (
    <div className="model-bar">
    <Menu align="up" className="model-picker" trigger={({ toggle, open }) => (
      <button type="button" className="model-pill" aria-expanded={open} aria-haspopup="dialog" onClick={toggle}>
        <span className="model-pill-main"><Icon name="bolt" size={14} />{label}</span>
        {effort && <span className="model-pill-sub">{effort}<Icon name="down" size={12} /></span>}
        {!effort && <Icon name="down" size={13} className="model-pill-caret" />}
      </button>
    )}>
      <div className="picker-pop" role="dialog" aria-label="Modelo e esforço">
        <p className="pop-label">Modelo</p>
        <div role="radiogroup" aria-label="Modelo">
          {models.map(([k, v]) => (
            <button key={k} type="button" role="radio" aria-checked={k === value.model} className={`menu-item model-item ${k === value.model ? 'on' : ''}`}
              onClick={() => onChange(v => ({ ...v, model: k }))}>
              <span><b>{v.label}</b><small>{(v.provider === 'openrouter' || (v.provider === 'claude' && S.settings.claude?.mode === 'api')) ? `Pago por uso: gasta créditos${MODEL_DESC[k] ? ` · ${MODEL_DESC[k]}` : ''}` : MODEL_DESC[k]}</small></span>{k === value.model && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
        {value.model !== 'agent' && <>
          <p className="pop-label">Esforço</p>
          <EffortScale value={value.effort} model={value.model} onChange={effort => onChange(v => ({ ...v, effort }))} />
        </>}
      </div>
    </Menu>
    {showUsage && <ModelUsage chatId={chatId} />}
    </div>
  );
}
