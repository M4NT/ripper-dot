import { stepLabel } from './lib.js';

/** "Quem está fazendo o quê": tarefa atual, há quanto tempo e para quem vai. */
export function doingLine(w, now = Date.now()) {
  if (!w) return null;
  const min = Math.max(0, Math.round((now - w.since) / 60000));
  const what = w.task || (w.tool ? stepLabel(w.tool) : 'trabalhando');
  return `${what} · ${min ? `há ${min} min` : 'agora'} · para ${w.forName || 'você'}`;
}

/** Ferramentas que usam a tela do computador (VM + navegador). */
export function isLiveScreenTool(tool) {
  return /^(computer_|browser_)/.test(tool || '');
}

/**
 * Passo para mostrar por cima da tela ao vivo.
 * Ordem: rótulo explícito → último passo da mensagem atual → último uso de computador/navegador → working → “Trabalhando…”.
 */
export function liveScreenStep({ working, messages, agentId, busy, step } = {}) {
  if (step) return step;
  const mine = (messages || []).filter(m => !agentId || !m.agentId || m.agentId === agentId);
  const lastMsg = mine[mine.length - 1];
  const lastSteps = lastMsg?.steps || [];
  const last = lastSteps[lastSteps.length - 1];
  if (last && (last.kind === 'tool' || last.tool) && last.kind !== 'screen' && last.kind !== 'note') {
    return last.label || stepLabel(last.tool);
  }
  for (let i = mine.length - 1; i >= 0; i--) {
    const steps = mine[i].steps || [];
    for (let j = steps.length - 1; j >= 0; j--) {
      if (isLiveScreenTool(steps[j].tool)) return steps[j].label || stepLabel(steps[j].tool);
    }
  }
  const w = working?.[agentId];
  if (w?.task) return w.task;
  if (w?.tool) return stepLabel(w.tool);
  if (busy) return 'Trabalhando…';
  return null;
}

/** Chave que muda quando o agente começa (ou troca) um passo de computador/navegador nesta conversa. */
export function liveScreenAutoKey({ messages, working, busy, agentIds } = {}) {
  const ids = agentIds || [];
  const fromWorking = ids.map(id => {
    const w = working?.[id];
    return w && isLiveScreenTool(w.tool) ? `w:${id}:${w.tool}:${w.since || 0}` : '';
  }).filter(Boolean);
  if (fromWorking.length) return fromWorking.join('|');
  if (!ids.some(id => busy?.[id])) return '';
  let n = 0;
  let last = '';
  for (const m of messages || []) {
    if (m.agentId && ids.length && !ids.includes(m.agentId)) continue;
    for (const s of m.steps || []) {
      if (isLiveScreenTool(s.tool)) { n += 1; last = s.tool; }
    }
  }
  return n ? `m:${last}:${n}` : '';
}

/** Abrir a tela ao vivo: só com Docker, e só enquanto o agente usa computador ou navegador. */
export function shouldOpenLiveScreen({ mode, messages, working, busy, agentIds } = {}) {
  if (mode && mode !== 'docker') return false;
  return Boolean(liveScreenAutoKey({ messages, working, busy, agentIds }));
}
