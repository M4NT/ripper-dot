import { randomUUID } from 'node:crypto';

const newId = () => randomUUID();

/** Papéis mínimos para delegação enterprise (agentes e operador humano). */
export const ROLES = Object.freeze(['admin', 'manager', 'worker', 'viewer']);

/** Ações que exigem permissão de delegação. */
export const DELEGATE_ACTIONS = Object.freeze(['delegate_task', 'send_message', 'assign_routine']);

const ROLE_RANK = { admin: 4, manager: 3, worker: 2, viewer: 1 };

const DEFAULT_ACCESS = () => ({
  enabled: false,
  teams: [],
  assignments: []
});

/** Normaliza snapshot persistido (idempotente). */
export function normalizeAccessControl(raw) {
  const base = DEFAULT_ACCESS();
  if (!raw || typeof raw !== 'object') return base;
  const teams = (Array.isArray(raw.teams) ? raw.teams : [])
    .filter(t => t?.id && typeof t.name === 'string')
    .map(t => ({
      id: String(t.id),
      name: String(t.name).slice(0, 80),
      memberIds: normalizeMembers(t.memberIds),
      updatedAt: t.updatedAt || Date.now()
    }));
  const assignments = (Array.isArray(raw.assignments) ? raw.assignments : [])
    .filter(a => a?.id && a.principalId && ROLES.includes(a.role))
    .map(a => ({
      id: String(a.id),
      principalType: a.principalType === 'user' ? 'user' : 'agent',
      principalId: String(a.principalId),
      role: a.role,
      teamId: a.teamId ? String(a.teamId) : undefined,
      updatedAt: a.updatedAt || Date.now()
    }));
  return {
    enabled: raw.enabled === true,
    teams,
    assignments
  };
}

function normalizeMembers(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(m => m?.id && (m.type === 'user' || m.type === 'agent'))
    .map(m => ({ type: m.type, id: String(m.id) }));
}

export function principalKey(p) {
  if (!p?.id) return '';
  const type = p.type === 'user' ? 'user' : 'agent';
  return `${type}:${p.id}`;
}

/** Papéis efetivos do ator (pode ter mais de um em times diferentes). */
export function rolesForPrincipal(ac, principal) {
  const key = principalKey(principal);
  const out = [];
  for (const a of ac.assignments) {
    if (principalKey({ type: a.principalType, id: a.principalId }) !== key) continue;
    out.push({ role: a.role, teamId: a.teamId || null });
  }
  return out;
}

export function highestRole(bindings) {
  let best = null;
  let rank = 0;
  for (const b of bindings) {
    const r = ROLE_RANK[b.role] || 0;
    if (r > rank) { rank = r; best = b.role; }
  }
  return best;
}

export function teamById(ac, teamId) {
  return ac.teams.find(t => t.id === teamId) || null;
}

export function memberTeams(ac, principal) {
  const key = principalKey(principal);
  return ac.teams.filter(t => t.memberIds.some(m => principalKey(m) === key));
}

export function isMemberOfTeam(ac, principal, teamId) {
  const team = teamById(ac, teamId);
  if (!team) return false;
  const key = principalKey(principal);
  return team.memberIds.some(m => principalKey(m) === key);
}

function managedTeamIds(ac, actorBindings) {
  const ids = new Set();
  for (const b of actorBindings) {
    if (b.role === 'admin') return null; // null = todos os times
    if (b.role === 'manager' && b.teamId) ids.add(b.teamId);
  }
  return ids;
}

function defaultBindingsWhenEnabled(ac, principal) {
  if (principal.type === 'user' && principal.id === 'owner') {
    return [{ role: 'admin', teamId: null }];
  }
  if (principal.type === 'agent') {
    const has = rolesForPrincipal(ac, principal).length;
    if (!has) return [{ role: 'worker', teamId: null }];
  }
  return rolesForPrincipal(ac, principal);
}

/**
 * Verifica se o ator pode delegar uma ação para usuário, agente ou time.
 * @param {object} actor — { type: 'user'|'agent', id }
 * @param {object} target — { type: 'user'|'agent'|'team', id }
 * @param {string} action — delegate_task | send_message | assign_routine
 * @param {object} ac — accessControl normalizado
 */
export function canDelegate(actor, target, action, ac, { agents = [] } = {}) {
  const control = normalizeAccessControl(ac);
  if (!control.enabled) return { ok: true };

  if (!actor?.id || !target?.id) {
    return deny('invalid_principal', 'Ator ou destino inválido para delegação.');
  }
  if (!DELEGATE_ACTIONS.includes(action)) {
    return deny('unknown_action', `Ação de delegação desconhecida: ${action}.`);
  }

  const actorBindings = defaultBindingsWhenEnabled(control, actor);
  const actorRole = highestRole(actorBindings);
  if (!actorRole) {
    return deny('no_role', 'Este ator não tem papel definido para delegar tarefas.');
  }

  if (actorRole === 'admin') {
    return allow();
  }

  if (actorRole === 'viewer' || actorRole === 'worker') {
    return deny('forbidden_role', 'Seu papel não permite delegar tarefas para outros.');
  }

  if (actorRole !== 'manager') {
    return deny('forbidden_role', 'Seu papel não permite delegar tarefas para outros.');
  }

  const managed = managedTeamIds(control, actorBindings);
  if (managed instanceof Set && managed.size === 0) {
    return deny('no_team_scope', 'Gerente sem time associado não pode delegar.');
  }

  if (target.type === 'team') {
    if (managed === null || managed.has(target.id)) return allow();
    return deny('team_forbidden', 'Você não gerencia este time e não pode delegar para ele.');
  }

  const targetPrincipal = { type: target.type === 'user' ? 'user' : 'agent', id: target.id };
  if (targetPrincipal.type === 'agent' && agents.length && !agents.some(a => a.id === targetPrincipal.id)) {
    return deny('unknown_agent', 'Destinatário (agente) não encontrado.');
  }

  const targetBindings = defaultBindingsWhenEnabled(control, targetPrincipal);
  const targetRole = highestRole(targetBindings);
  if (targetRole === 'admin' || targetRole === 'manager') {
    return deny('target_elevated', 'Não é permitido delegar para administradores ou outros gerentes.');
  }

  const sharedTeams = memberTeams(control, targetPrincipal).map(t => t.id);
  const allowedTeam = managed === null
    ? sharedTeams.length > 0
    : sharedTeams.some(tid => managed.has(tid));

  if (!allowedTeam) {
    const onManaged = managed === null
      ? false
      : [...managed].some(tid => isMemberOfTeam(control, targetPrincipal, tid));
    if (!onManaged) {
      return deny('out_of_scope', 'Destinatário fora dos times que você gerencia.');
    }
  }

  return allow();
}

function allow() {
  return { ok: true };
}

function deny(code, error) {
  return { ok: false, code, error };
}

/** Mensagem curta para ferramentas do agente (inbox). */
export function delegationDeniedMessage(result) {
  if (result?.ok) return null;
  return result?.error || 'Delegação negada pelas regras de acesso.';
}

export function ensureOwnerAdmin(ac) {
  const control = normalizeAccessControl(ac);
  const key = principalKey({ type: 'user', id: 'owner' });
  const has = control.assignments.some(a => principalKey({ type: a.principalType, id: a.principalId }) === key);
  if (!has) {
    control.assignments.push({
      id: newId(),
      principalType: 'user',
      principalId: 'owner',
      role: 'admin',
      updatedAt: Date.now()
    });
  }
  return control;
}

export function upsertTeam(ac, { id: teamId, name, memberIds }) {
  const control = normalizeAccessControl(ac);
  const tid = teamId || newId();
  let team = control.teams.find(t => t.id === tid);
  const payload = {
    id: tid,
    name: String(name || team?.name || 'Time').slice(0, 80),
    memberIds: normalizeMembers(memberIds ?? team?.memberIds),
    updatedAt: Date.now()
  };
  if (team) Object.assign(team, payload);
  else control.teams.push(payload);
  return control;
}

export function deleteTeam(ac, teamId) {
  const control = normalizeAccessControl(ac);
  control.teams = control.teams.filter(t => t.id !== teamId);
  control.assignments = control.assignments.filter(a => a.teamId !== teamId);
  return control;
}

export function upsertAssignment(ac, { id: assignmentId, principalType, principalId, role, teamId }) {
  const control = normalizeAccessControl(ac);
  if (!ROLES.includes(role)) throw new Error('Papel inválido.');
  const pid = String(principalId || '');
  if (!pid) throw new Error('principalId obrigatório.');
  const pType = principalType === 'user' ? 'user' : 'agent';
  if (teamId && !teamById(control, teamId)) throw new Error('Time não encontrado.');
  const aid = assignmentId || newId();
  let row = control.assignments.find(a => a.id === aid);
  const payload = {
    id: aid,
    principalType: pType,
    principalId: pid,
    role,
    teamId: teamId ? String(teamId) : undefined,
    updatedAt: Date.now()
  };
  if (row) Object.assign(row, payload);
  else control.assignments.push(payload);
  return control;
}

export function deleteAssignment(ac, assignmentId) {
  const control = normalizeAccessControl(ac);
  control.assignments = control.assignments.filter(a => a.id !== assignmentId);
  return control;
}

export function mergeAccessControl(defaults, disk, local) {
  const d = normalizeAccessControl(defaults);
  const merged = normalizeAccessControl({
    enabled: local?.enabled ?? disk?.enabled ?? d.enabled,
    teams: mergeById(disk?.teams, local?.teams),
    assignments: mergeById(disk?.assignments, local?.assignments)
  });
  return merged;
}

function mergeById(diskArr, localArr) {
  const byId = new Map();
  for (const item of diskArr || []) {
    if (item?.id) byId.set(item.id, item);
  }
  for (const item of localArr || []) {
    if (!item?.id) continue;
    const prev = byId.get(item.id);
    const ts = item.updatedAt || 0;
    const pts = prev?.updatedAt || 0;
    if (!prev || ts >= pts) byId.set(item.id, item);
  }
  return [...byId.values()];
}

export function accessControlMeta() {
  return { roles: [...ROLES], delegateActions: [...DELEGATE_ACTIONS], defaultOwnerId: 'owner' };
}
