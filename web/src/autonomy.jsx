/** Semáforo de autonomia do agente (privilégio de ação). */

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

export function AutonomySemaphore({ level, showLabel = true, size = 'md' }) {
  const m = autonomyMeta(level);
  return (
    <span className={`autonomy-sem autonomy-sem-${m.sem} autonomy-sem-${size}`} title={`${m.label} · ${m.en}`}>
      <span className="autonomy-lights" aria-hidden="true">
        <i className={m.sem === 'red' ? 'on' : ''} />
        <i className={m.sem === 'yellow' ? 'on' : ''} />
        <i className={m.sem === 'green' ? 'on' : ''} />
      </span>
      {showLabel && <span className="autonomy-label">{m.label}</span>}
    </span>
  );
}

export function AutonomyPick({ value, onChange }) {
  const v = value || 'semi_autonomous';
  return (
    <div className="field">
      <span>Nível de autonomia</span>
      <div className="mode-grid three autonomy-grid" role="radiogroup" aria-label="Nível de autonomia">
        {AUTONOMY_LEVELS.map(m => (
          <button key={m.id} type="button" role="radio" aria-checked={v === m.id} className={`mode autonomy-mode ${v === m.id ? 'on' : ''}`} onClick={() => onChange(m.id)}>
            <AutonomySemaphore level={m.id} showLabel={false} size="sm" />
            <b>{m.label}<span className="tag tag-muted">{m.en}</span></b>
            <small>{m.desc}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
