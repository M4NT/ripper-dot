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

function messagesOf(agentId, messages) {
  return (messages || []).filter(m => {
    if (!agentId) return true;
    if (m.agentId) return m.agentId === agentId;
    return false;
  });
}

/** Mensagens depois do último pedido seu — o turno que está rodando agora. */
export function currentTurnMessages(messages) {
  const all = messages || [];
  let cut = -1;
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].role === 'user') { cut = i; break; }
  }
  return all.slice(cut + 1);
}

function turnHasLiveTool(messages, agentId) {
  return messagesOf(agentId, currentTurnMessages(messages)).some(m => (m.steps || []).some(s => isLiveScreenTool(s.tool)));
}

/** Este turno usa computador/navegador agora (não o histórico da conversa). */
export function shouldConnectThisTurn({ messages, working, busy, agentId } = {}) {
  const w = working?.[agentId];
  if (w && isLiveScreenTool(w.tool)) return true;
  if (!busy?.[agentId]) return false;
  return turnHasLiveTool(messages, agentId);
}

/**
 * Passo para mostrar por cima da tela ao vivo.
 * Só computador/navegador (não WebSearch nem mensagem sua).
 */
export function liveScreenStep({ working, messages, agentId, busy, step } = {}) {
  if (step) return step;
  const mine = messagesOf(agentId, messages);
  for (let i = mine.length - 1; i >= 0; i--) {
    const steps = mine[i].steps || [];
    for (let j = steps.length - 1; j >= 0; j--) {
      if (isLiveScreenTool(steps[j].tool)) return steps[j].label || stepLabel(steps[j].tool);
    }
  }
  const w = working?.[agentId];
  if (w?.task && isLiveScreenTool(w.tool)) return w.task;
  if (w?.tool && isLiveScreenTool(w.tool)) return stepLabel(w.tool);
  if (w?.task && busy) return w.task;
  if (busy) return 'Trabalhando…';
  return null;
}

/**
 * Identidade do turno em que a tela importa — estável enquanto o agente
 * continua no mesmo trabalho (não muda a cada passo de computador ou navegador).
 */
export function liveScreenAutoKey({ messages, working, busy, agentIds } = {}) {
  const ids = agentIds || [];
  const liveIds = ids.filter(id => shouldConnectThisTurn({ messages, working, busy, agentId: id }));
  if (!liveIds.length) return '';
  return liveIds.map(id => `turn:${id}`).join('|');
}

/** Abrir a aba: só Docker, e só neste turno (chave estável). */
export function shouldOpenLiveScreen({ mode, messages, working, busy, agentIds } = {}) {
  if (mode && mode !== 'docker') return false;
  return Boolean(liveScreenAutoKey({ messages, working, busy, agentIds }));
}

/**
 * Primeira vez do turno → abrir a aba. Mesmo turno de novo → não rouba.
 * Turno acabou (liveKey vazio) → esquece, para o próximo turno poder abrir.
 */
export function consumeLiveTabOpen(openedKey, liveKey) {
  if (!liveKey) return { openedKey: '', open: false };
  if (liveKey === openedKey) return { openedKey, open: false };
  return { openedKey: liveKey, open: true };
}

/** Ligar o VNC sozinho: só se o agente está nesse trabalho agora. Histórico antigo não conta. */
export function shouldAutoConnect({ working, autoConnect } = {}) {
  return !!(working || autoConnect);
}

/** Nova tentativa: clique sempre; automático só neste turno e não em loop depois do erro. */
export function shouldRetryConnect({ url, loading, err, live, alreadyTried, fromUser } = {}) {
  if (loading) return false;
  if (fromUser) return true;
  if (url) return false;
  if (!live) return false;
  if (alreadyTried && err) return false;
  return true;
}

/** Esc: tela cheia sempre; miniatura só com o foco nela. Composer e menus ficam de fora. */
export function shouldHandleLiveScreenEscape({ key, big, float, focusInside } = {}) {
  if (key !== 'Escape') return null;
  if (big) return 'close-full';
  if (float && focusInside) return 'close-float';
  return null;
}
