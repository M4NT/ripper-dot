import {
  normalizeAccessControl,
  upsertTeam,
  deleteTeam,
  upsertAssignment,
  deleteAssignment,
  ensureOwnerAdmin
} from './rbac.mjs';

export function applyAccessControlPatch(db, body) {
  if (!body || typeof body !== 'object') throw new Error('Corpo inválido.');
  let ac = normalizeAccessControl(db.accessControl);
  if (typeof body.enabled === 'boolean') ac.enabled = body.enabled;
  if (Array.isArray(body.teams)) {
    for (const t of body.teams) {
      ac = upsertTeam(ac, {
        id: t.id,
        name: t.name,
        memberIds: t.memberIds
      });
    }
  }
  if (Array.isArray(body.deleteTeamIds)) {
    for (const tid of body.deleteTeamIds) ac = deleteTeam(ac, String(tid));
  }
  if (Array.isArray(body.assignments)) {
    for (const a of body.assignments) {
      ac = upsertAssignment(ac, {
        id: a.id,
        principalType: a.principalType,
        principalId: a.principalId,
        role: a.role,
        teamId: a.teamId
      });
    }
  }
  if (Array.isArray(body.deleteAssignmentIds)) {
    for (const aid of body.deleteAssignmentIds) ac = deleteAssignment(ac, String(aid));
  }
  db.accessControl = ensureOwnerAdmin(ac);
  return db.accessControl;
}
