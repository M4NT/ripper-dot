import { needsApproval } from './approvals.mjs';

/** Máximo de comandos lembrados por conversa (evita crescimento infinito). */
export const MAX_ALLOWED_COMMANDS = 80;

/** Ferramenta builtin → flag em agent.tools (store). */
export const BUILTIN_TOOL_REQUIREMENTS = {
  send_message: null,
  remember: 'memory',
  schedule_routine: 'routines',
  save_artifact: null,
  read_artifact: null,
  use_skill: null,
  save_skill: null,
  browser_open: 'browser',
  browser_click: 'browser',
  browser_type: 'browser',
  browser_scroll: 'browser',
  browser_read: 'browser',
  computer_exec: 'computer',
  computer_share: 'computer'
};

/** Persiste decisão “aprovar sempre nesta conversa” de forma deduplicada. */
export function rememberAllowedCommand(chat, command) {
  if (!chat || !command) return;
  const list = chat.allowedCommands ||= [];
  if (list.includes(command)) return;
  list.push(command);
  if (list.length > MAX_ALLOWED_COMMANDS) list.splice(0, list.length - MAX_ALLOWED_COMMANDS);
}

/** Caminho único para decidir se exec no computador precisa de aprovação humana. */
export function execNeedsApproval({ command, computerKind, policy, chat }) {
  return needsApproval({
    command,
    computerKind,
    policy: policy || 'risky',
    allowed: chat?.allowedCommands || []
  });
}

export function agentHasStoreTool(agent, storeTool) {
  return Boolean(agent?.tools?.includes(storeTool));
}

/**
 * Ferramenta builtin permitida para este agente e ambiente (sem mentir ferramentas indisponíveis).
 * `ctx` opcional: { computer, browser } — quando omitido, só checa flags do agente.
 */
export function builtinToolAllowed(agent, toolName, { settings, computer, browser } = {}) {
  const need = BUILTIN_TOOL_REQUIREMENTS[toolName];
  if (need && !agentHasStoreTool(agent, need)) return false;
  const mode = settings?.computer?.mode;
  const localOk = mode === 'local' && settings?.computer?.allowLocalCommands;
  if (toolName.startsWith('computer_')) return agentHasStoreTool(agent, 'computer') && (mode === 'docker' || mode === 'boat' || localOk) && Boolean(computer);
  if (toolName.startsWith('browser_')) return agentHasStoreTool(agent, 'browser') && mode === 'docker' && Boolean(browser ?? computer);
  return true;
}
