/** Semáforo de autonomia do agente (privilégio de ação). */

import { isEnterpriseMode } from './uiMode.js';

export const AUTONOMY_LEVELS = [
  {
    id: 'read_only',
    label: 'Somente leitura',
    en: 'Read-only',
    sem: 'red',
    desc: 'Conversa e consulta. Sem shell, sem cliques que alteram páginas, sem rotinas nem mensagens a colegas.'
  },
  {
    id: 'semi_autonomous',
    label: 'Semi-autônomo',
    en: 'Semi-autonomous',
    sem: 'yellow',
    desc: 'Age sozinho no dia a dia; ações de risco seguem a política de aprovação desta instalação.'
  },
  {
    id: 'fully_autonomous',
    label: 'Totalmente autônomo',
    en: 'Fully autonomous',
    sem: 'green',
    desc: 'Não pede aprovação por autonomia (na pasta local do seu PC, o Ripper ainda protege comandos sensíveis).'
  }
];

export function autonomyMeta(level) {
  return AUTONOMY_LEVELS.find(x => x.id === level) || AUTONOMY_LEVELS[1];
}

/** Nível exibido/aplicado na UI (modo simples não mostra totalmente autônomo). */
export function displayAutonomyLevel(level, settings) {
  const v = level || 'semi_autonomous';
  if (v === 'fully_autonomous' && settings && !isEnterpriseMode(settings)) return 'semi_autonomous';
  return v;
}

export function AutonomySemaphore({ level, settings, showLabel = true, size = 'md' }) {
  const m = autonomyMeta(displayAutonomyLevel(level, settings));
  return (
    <span className={`autonomy-sem autonomy-sem-${m.sem} autonomy-sem-${size}`} title={m.label}>
      <span className="autonomy-lights" aria-hidden="true">
        <i className={m.sem === 'red' ? 'on' : ''} />
        <i className={m.sem === 'yellow' ? 'on' : ''} />
        <i className={m.sem === 'green' ? 'on' : ''} />
      </span>
      {showLabel && <span className="autonomy-label">{m.label}</span>}
    </span>
  );
}

export function AutonomyPick({ value, onChange, allowFullyAutonomous = false }) {
  const v = value || 'semi_autonomous';
  const levels = AUTONOMY_LEVELS.filter(m => allowFullyAutonomous || m.id !== 'fully_autonomous');
  const gridClass = levels.length > 2 ? 'three' : 'two';
  return (
    <div className="field">
      <span>Nível de autonomia</span>
      {!allowFullyAutonomous && <small className="muted">Totalmente autônomo está disponível no modo Enterprise (Configurações → Aparência).</small>}
      <div className={`mode-grid ${gridClass} autonomy-grid`} role="radiogroup" aria-label="Nível de autonomia">
        {levels.map(m => (
          <button key={m.id} type="button" role="radio" aria-checked={v === m.id} className={`mode autonomy-mode ${v === m.id ? 'on' : ''}`} onClick={() => onChange(m.id)}>
            <AutonomySemaphore level={m.id} showLabel={false} size="sm" />
            <b>{m.label}</b>
            <small>{m.desc}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
