import { isEnterpriseMode } from './enterprise.mjs';

/** Níveis de autonomia do agente (semáforo de privilégio). */
export const AUTONOMY_LEVELS = ['read_only', 'semi_autonomous', 'fully_autonomous'];

export function normalizeAutonomyLevel(v) {
  return AUTONOMY_LEVELS.includes(v) ? v : 'semi_autonomous';
}

/** Modo simples: totalmente autônomo não é permitido (fica semi-autônomo). */
export function sanitizeAutonomyLevel(level, settings) {
  const n = normalizeAutonomyLevel(level);
  if (n === 'fully_autonomous' && !isEnterpriseMode(settings)) return 'semi_autonomous';
  return n;
}

export function effectiveAutonomyLevel(agent, settings) {
  return sanitizeAutonomyLevel(agent?.autonomyLevel, settings);
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
  'send_message',
  'post_social',
  'send_webhook'
]);

export function isToolAllowedByAutonomy(agent, toolName, settings) {
  if (effectiveAutonomyLevel(agent, settings) !== 'read_only') return true;
  return !READ_ONLY_BLOCKED.has(toolName);
}

/**
 * Ferramenta de conector MCP (plugin do usuário ou conector claude.ai) em modo somente leitura:
 * só passa se o servidor a marcou readOnlyHint nas annotations MCP (guardado em plugin.readOnlyTools
 * na última listagem). Sem listagem/annotation = bloqueada. Fora do read_only, sempre liberada.
 */
export function isConnectorToolAllowedByAutonomy(agent, settings, server, tool) {
  if (effectiveAutonomyLevel(agent, settings) !== 'read_only') return true;
  const p = (settings?.plugins || []).find(x => x.name === server);
  return !!p && Array.isArray(p.readOnlyTools) && p.readOnlyTools.includes(String(tool));
}

/** Política de aprovação efetiva para exec no computador (sobrepõe config global). */
export function effectiveApprovalPolicy(agent, globalPolicy = 'risky', settings) {
  const level = settings ? effectiveAutonomyLevel(agent, settings) : normalizeAutonomyLevel(agent?.autonomyLevel);
  if (level === 'fully_autonomous') return 'never';
  if (level === 'read_only') return 'always';
  return globalPolicy || 'risky';
}

/**
 * Se retornar string, a ação no navegador precisa de aprovação com esse motivo.
 * null = não pedir por autonomia; undefined = usar browserRisk padrão.
 */
export function browserAutonomyGate(agent, action, settings) {
  const level = settings ? effectiveAutonomyLevel(agent, settings) : normalizeAutonomyLevel(agent?.autonomyLevel);
  if (level === 'fully_autonomous') return null;
  if (level === 'read_only' && (action === 'click' || action === 'type')) {
    return 'agente em modo somente leitura';
  }
  if (level === 'semi_autonomous') return undefined;
  return undefined;
}

/** Compartilhar porta na internet: read_only sempre bloqueia; fully_autonomous não pede por autonomia. */
export function shareAutonomyGate(agent, settings) {
  const level = settings ? effectiveAutonomyLevel(agent, settings) : normalizeAutonomyLevel(agent?.autonomyLevel);
  if (level === 'read_only') return 'agente em modo somente leitura';
  if (level === 'fully_autonomous') return null;
  return undefined;
}

/** Publicar em webhook externo: read_only bloqueia; fully_autonomous dispensa aprovação por autonomia. */
export function socialPostAutonomyGate(agent, settings) {
  const level = settings ? effectiveAutonomyLevel(agent, settings) : normalizeAutonomyLevel(agent?.autonomyLevel);
  if (level === 'read_only') return 'agente em modo somente leitura';
  if (level === 'fully_autonomous') return null;
  return undefined;
}
