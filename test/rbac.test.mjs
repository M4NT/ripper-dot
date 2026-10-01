import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canDelegate,
  normalizeAccessControl,
  upsertTeam,
  upsertAssignment,
  mergeAccessControl,
  ensureOwnerAdmin
} from '../lib/rbac.mjs';

const agents = [
  { id: 'mgr', name: 'Gerente' },
  { id: 'w1', name: 'Worker 1' },
  { id: 'w2', name: 'Worker 2' },
  { id: 'other', name: 'Outro time' }
];

function enabledAc() {
  let ac = normalizeAccessControl({ enabled: true, teams: [], assignments: [] });
  ac = ensureOwnerAdmin(ac);
  ac = upsertTeam(ac, {
    id: 't1',
    name: 'Alpha',
    memberIds: [
      { type: 'agent', id: 'mgr' },
      { type: 'agent', id: 'w1' }
    ]
  });
  ac = upsertTeam(ac, {
    id: 't2',
    name: 'Beta',
    memberIds: [{ type: 'agent', id: 'other' }]
  });
  ac = upsertAssignment(ac, { principalType: 'agent', principalId: 'mgr', role: 'manager', teamId: 't1' });
  ac = upsertAssignment(ac, { principalType: 'agent', principalId: 'w1', role: 'worker', teamId: 't1' });
  ac = upsertAssignment(ac, { principalType: 'agent', principalId: 'w2', role: 'worker', teamId: 't1' });
  ac = upsertAssignment(ac, { principalType: 'agent', principalId: 'other', role: 'worker', teamId: 't2' });
  return ac;
}

test('desligado: sempre permite', () => {
  const ac = normalizeAccessControl({ enabled: false });
  const r = canDelegate({ type: 'agent', id: 'x' }, { type: 'agent', id: 'y' }, 'send_message', ac);
  assert.equal(r.ok, true);
});

test('admin (owner) delega para qualquer agente', () => {
  const ac = enabledAc();
  const r = canDelegate({ type: 'user', id: 'owner' }, { type: 'agent', id: 'other' }, 'assign_routine', ac, { agents });
  assert.equal(r.ok, true);
});

test('worker não delega', () => {
  const ac = enabledAc();
  const r = canDelegate({ type: 'agent', id: 'w1' }, { type: 'agent', id: 'w2' }, 'send_message', ac, { agents });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'forbidden_role');
  assert.match(r.error, /não permite delegar/i);
});

test('gerente delega para worker do mesmo time', () => {
  const ac = enabledAc();
  const ok = canDelegate({ type: 'agent', id: 'mgr' }, { type: 'agent', id: 'w1' }, 'delegate_task', ac, { agents });
  assert.equal(ok.ok, true);
});

test('gerente não delega para agente de outro time', () => {
  const ac = enabledAc();
  const r = canDelegate({ type: 'agent', id: 'mgr' }, { type: 'agent', id: 'other' }, 'send_message', ac, { agents });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'out_of_scope');
});

test('gerente não delega para outro gerente/admin', () => {
  let ac = enabledAc();
  ac = upsertAssignment(ac, { principalType: 'agent', principalId: 'w2', role: 'manager', teamId: 't1' });
  const r = canDelegate({ type: 'agent', id: 'mgr' }, { type: 'agent', id: 'w2' }, 'delegate_task', ac, { agents });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'target_elevated');
});

test('delegação para time exige gerência do time', () => {
  const ac = enabledAc();
  assert.equal(canDelegate({ type: 'agent', id: 'mgr' }, { type: 'team', id: 't1' }, 'delegate_task', ac).ok, true);
  const denied = canDelegate({ type: 'agent', id: 'mgr' }, { type: 'team', id: 't2' }, 'delegate_task', ac);
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'team_forbidden');
});

test('ação desconhecida é rejeitada', () => {
  const ac = enabledAc();
  const r = canDelegate({ type: 'user', id: 'owner' }, { type: 'agent', id: 'w1' }, 'fly', ac);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'unknown_action');
});

test('mergeAccessControl mantém registro mais recente por id', () => {
  const defaults = { enabled: false, teams: [], assignments: [] };
  const disk = { enabled: true, teams: [{ id: 't1', name: 'A', memberIds: [], updatedAt: 1 }], assignments: [] };
  const local = { enabled: true, teams: [{ id: 't1', name: 'B', memberIds: [], updatedAt: 5 }], assignments: [] };
  const merged = mergeAccessControl(defaults, disk, local);
  assert.equal(merged.teams[0].name, 'B');
});
