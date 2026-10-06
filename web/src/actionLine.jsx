import { useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import { stepLabel, TOOL_INFO } from './lib.js';
import { Icon } from './ui.jsx';
import { ApprovalCard } from './approvals.jsx';

const ORB = { route: 'connecting', WebSearch: 'searching', WebFetch: 'searching', computer_exec: 'working', computer_share: 'working', remember: 'weaving', schedule_routine: 'shaping', think: 'solving', text: 'composing' };

function normStep(raw) {
  if (raw.kind === 'approval') return raw;
  return raw.kind ? raw : { ...raw, kind: 'tool', label: stepLabel(raw.tool) };
}

function toolFamily(tool) {
  if (!tool) return null;
  if (tool.startsWith('computer_')) return 'computer';
  if (tool.startsWith('browser_')) return 'browser';
  if (tool === 'WebSearch' || tool === 'WebFetch') return 'web';
  if (tool === 'remember') return 'memory';
  if (tool === 'schedule_routine') return 'routines';
  return null;
}

function stepIcon(step) {
  if (step.kind === 'warn') return 'x';
  if (step.kind === 'done') return 'check';
  const fam = toolFamily(step.tool);
  if (fam && TOOL_INFO[fam]) return TOOL_INFO[fam].icon;
  return 'bolt';
}

function summarize(steps, live) {
  const last = steps[steps.length - 1];
  const running = live && last && last.kind === 'tool';
  if (running) return last.label || 'Trabalhando…';
  if (steps.length === 1) return last.label || 'Atividade';
  const lastLabel = last?.label || 'concluídas';
  return `${steps.length} atividades · ${lastLabel}`;
}

function StepRow({ step, live, index, total }) {
  const running = live && index === total - 1 && step.kind === 'tool';
  return (
    <li className={`step step-${step.kind} ${running ? 'running' : ''}`}>
      {running ? <ThinkingOrb state={ORB[step.tool] || 'working'} size={20} /> : <Icon name={step.kind === 'warn' ? 'x' : step.kind === 'done' ? 'check' : 'check'} size={13} />}
      <span className="step-label">{step.label}</span>
      {step.detail && <code className="step-detail" title={step.detail}>{step.detail}</code>}
    </li>
  );
}

/**
 * Faixa central de atividades: comandos e status do agente ficam recolhidos numa linha
 * expansível (estilo faixa de ferramentas), em vez de uma lista longa na bolha.
 */
export default function ActionLine({ steps, live }) {
  const [open, setOpen] = useState(false);

  const approvals = [];
  const activity = [];
  const subtasks = [];
  for (const raw of steps || []) {
    const s = normStep(raw);
    if (s.kind === 'approval') approvals.push(s);
    else if (s.kind === 'subtask') subtasks.push(s);
    else activity.push(s);
  }

  const last = activity[activity.length - 1];
  const running = live && last?.kind === 'tool';
  const canExpand = activity.length > 1 || activity.some(s => s.detail);

  if (!activity.length && !approvals.length && !subtasks.length) return null;

  const leadIcon = running ? null : stepIcon(last || { kind: 'done' });
  const barLabel = open ? 'Recolher atividades do agente' : 'Expandir atividades do agente';

  return (
    <div className="action-line-wrap">
      {approvals.map((s, i) => (
        <div key={`a-${i}`} className="step step-approval"><ApprovalCard rec={s.rec} status={s.status} /></div>
      ))}
      {subtasks.length > 0 && (
        <ul className="subtasks" aria-label="Subtarefas em paralelo">
          {subtasks.map(t => {
            // Sem saber o tamanho final: a barra avança pelo texto já escrito e fecha ao terminar.
            const pct = t.status === 'running' ? Math.min(90, 10 + t.chars / 40) : 100;
            const st = t.status === 'running' && !live ? 'error' : t.status;
            return (
              <li key={t.key} className={`subtask subtask-${st}`}>
                <span className="subtask-title">{t.title}</span>
                <span className="subtask-state">{st === 'done' ? 'pronto' : st === 'error' ? 'falhou' : 'trabalhando…'}</span>
                <span className="subtask-bar" role="progressbar" aria-label={t.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><i style={{ width: `${pct}%` }} /></span>
              </li>
            );
          })}
        </ul>
      )}
      {activity.length > 0 && (
        <div className={`action-line ${open ? 'open' : ''} ${running ? 'is-live' : ''} ${canExpand ? '' : 'action-line-static'}`}>
          <button
            type="button"
            className="action-line-bar"
            onClick={() => canExpand && setOpen(o => !o)}
            aria-expanded={canExpand ? open : undefined}
            aria-label={canExpand ? barLabel : undefined}
            disabled={!canExpand}
          >
            {running ? <ThinkingOrb state={ORB[last.tool] || 'working'} size={20} /> : <Icon name={leadIcon} size={15} />}
            <span className="action-line-text">{summarize(activity, live)}</span>
            {activity.length > 1 && <span className="action-line-badge">{activity.length}</span>}
            {canExpand && <Icon name="down" size={14} className={`action-line-chevron ${open ? 'open' : ''}`} />}
          </button>
          {open && (
            <ol className="steps action-line-steps">
              {activity.map((s, i) => <StepRow key={i} step={s} live={live} index={i} total={activity.length} />)}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
