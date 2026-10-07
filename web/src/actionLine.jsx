import { useEffect, useRef, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import { stallLabel, stepLabel, TOOL_INFO } from './lib.js';
import { Icon } from './ui.jsx';
import CampaignCard from './campaignCard.jsx';
import { ApprovalCard } from './approvals.jsx';

const ORB = { route: 'connecting', WebSearch: 'searching', WebFetch: 'searching', computer_exec: 'working', computer_share: 'working', remember: 'weaving', schedule_routine: 'shaping', generate_image: 'shaping', think: 'solving', text: 'composing' };

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

function summarize(all, live) {
  const steps = all.some(s => s.kind !== 'note') ? all.filter(s => s.kind !== 'note') : all; // anotação não é ação: não conta nem vira título
  const last = steps[steps.length - 1];
  const running = live && last && last.kind === 'tool';
  if (running) return last.label || 'Trabalhando…';
  const lastLabel = last?.kind === 'note' ? 'anotação' : last?.label || 'concluídas'; // nota é texto longo: não vira título
  if (steps.length === 1) return last.kind === 'note' ? 'Anotação' : last.label || 'Atividade';
  return `${steps.length} atividades · ${lastLabel}`;
}

function StepRow({ step, live, index, total }) {
  const running = live && index === total - 1 && step.kind === 'tool';
  if (step.kind === 'note') return <li className="step step-note"><p>{step.label}</p></li>;
  return (
    <li className={`step step-${step.kind} ${running ? 'running' : ''}`} title={step.detail || undefined}>
      <span className="step-mark">{running ? <ThinkingOrb state={ORB[step.tool] || 'working'} size={20} /> : <Icon name={step.kind === 'warn' ? 'x' : 'check'} size={13} />}</span>
      <span className="step-label">{step.label}</span>
      {step.detail && <span className="step-detail">{step.detail}</span>}
      {step.count > 1 && <span className="step-count">×{step.count}</span>}
    </li>
  );
}

// Cada um é uma entrega com nome próprio (agente criado, rotina, arquivo): nunca vira "×N".
const KEEP_EACH = new Set(['create_agent', 'create_group', 'schedule_routine', 'deliver_file', 'generate_image']);

/** A mesma ação repetida em seguida vira uma linha só com ×N (o detalhe mostrado é o da última). */
function collapse(steps) {
  const out = [];
  for (const s of steps) {
    const prev = out[out.length - 1];
    if (prev && s.kind === 'tool' && prev.kind === 'tool' && prev.label === s.label && !KEEP_EACH.has(s.tool)) out[out.length - 1] = { ...s, count: (prev.count || 1) + 1 };
    else out.push(s);
  }
  return out;
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
    if (s.kind === 'approval' || s.kind === 'campaign') approvals.push(s);
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
        <div key={`a-${i}`} className="step step-approval">{s.kind === 'campaign' ? <CampaignCard rec={s.rec} /> : <ApprovalCard rec={s.rec} status={s.status} />}</div>
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
            {(() => { const n = activity.filter(s => s.kind !== 'note').length; return n > 1 && <span className="action-line-badge">{n}</span>; })()}
            {canExpand && <Icon name="down" size={14} className={`action-line-chevron ${open ? 'open' : ''}`} />}
          </button>
          {open && (
            <ol className="steps action-line-steps">
              {collapse(activity).map((s, i, all) => <StepRow key={i} step={s} live={live} index={i} total={all.length} />)}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Passo sem mudança há 20 s+: "ainda em: <passo> · 40 s" + Parar. `sig` muda quando há sinal novo (passo, texto).
 * setInterval e não requestAnimationFrame: rAF pode não disparar (aba em segundo plano, alguns ambientes).
 */
export function StallNote({ label, sig, onStop, slowAfterMs }) {
  const since = useRef({ sig, at: Date.now() });
  if (since.current.sig !== sig) since.current = { sig, at: Date.now() };
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const text = stallLabel(label, now - since.current.at, slowAfterMs);
  if (!text) return null;
  return (
    <div className="stall-note" role="status">
      <span>{text}</span>
      {onStop && <button type="button" className="meta-btn" onClick={onStop}><Icon name="x" size={13} />Parar</button>}
    </div>
  );
}
