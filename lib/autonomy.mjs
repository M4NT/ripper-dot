/** Níveis de autonomia do agente (semáforo de privilégio). */
export const AUTONOMY_LEVELS = ['read_only', 'semi_autonomous', 'fully_autonomous'];

export function normalizeAutonomyLevel(v) {
  return AUTONOMY_LEVELS.includes(v) ? v : 'semi_autonomous';
}

/** Ferramentas desabilitadas em modo somente leitura. */
const READ_ONLY_BLOCKED = new Set([
  'computer_exec',
  'computer_share',
  'browser_click',
  'browser_type',
  'save_artifact',
  'save_skill',
  'schedule_routine',
  'send_message'
]);

export function isToolAllowedByAutonomy(agent, toolName) {
  if (normalizeAutonomyLevel(agent?.autonomyLevel) !== 'read_only') return true;
  return !READ_ONLY_BLOCKED.has(toolName);
}

/** Política de aprovação efetiva para exec no computador (sobrepõe config global). */
export function effectiveApprovalPolicy(agent, globalPolicy = 'risky') {
  const level = normalizeAutonomyLevel(agent?.autonomyLevel);
  if (level === 'fully_autonomous') return 'never';
  if (level === 'read_only') return 'always';
  return globalPolicy || 'risky';
}

/**
 * Se retornar string, a ação no navegador precisa de aprovação com esse motivo.
 * null = não pedir por autonomia; undefined = usar browserRisk padrão.
 */
export function browserAutonomyGate(agent, action) {
  const level = normalizeAutonomyLevel(agent?.autonomyLevel);
  if (level === 'fully_autonomous') return null;
  if (level === 'read_only' && (action === 'click' || action === 'type')) {
    return 'agente em modo somente leitura';
  }
  if (level === 'semi_autonomous') return undefined;
  return undefined;
}

/** Compartilhar porta na internet: read_only sempre bloqueia; fully_autonomous não pede por autonomia. */
export function shareAutonomyGate(agent) {
  const level = normalizeAutonomyLevel(agent?.autonomyLevel);
  if (level === 'read_only') return 'agente em modo somente leitura';
  if (level === 'fully_autonomous') return null;
  return undefined;
}
