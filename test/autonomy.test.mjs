import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAutonomyLevel,
  sanitizeAutonomyLevel,
  effectiveApprovalPolicy,
  isToolAllowedByAutonomy,
  browserAutonomyGate,
  shareAutonomyGate
} from '../lib/autonomy.mjs';
import { execNeedsApproval, builtinToolAllowed } from '../lib/permissions.mjs';
import { listRipperBuiltinToolNames } from '../lib/ripper-builtin-tools.mjs';

const agent = level => ({ autonomyLevel: level, tools: ['web', 'memory', 'computer', 'browser', 'routines', 'files'] });
const enterprise = { ui: { mode: 'enterprise' } };
const simple = { ui: { mode: 'simple' } };

test('normalizeAutonomyLevel usa semi_autonomous como padrão', () => {
  assert.equal(normalizeAutonomyLevel(undefined), 'semi_autonomous');
  assert.equal(normalizeAutonomyLevel('bogus'), 'semi_autonomous');
  assert.equal(normalizeAutonomyLevel('read_only'), 'read_only');
});

test('effectiveApprovalPolicy por nível', () => {
  assert.equal(effectiveApprovalPolicy(agent('fully_autonomous'), 'risky', enterprise), 'never');
  assert.equal(effectiveApprovalPolicy(agent('read_only'), 'never', enterprise), 'always');
  assert.equal(effectiveApprovalPolicy(agent('semi_autonomous'), 'always', enterprise), 'always');
});

test('modo simples neutraliza fully_autonomous', () => {
  assert.equal(sanitizeAutonomyLevel('fully_autonomous', simple), 'semi_autonomous');
  assert.equal(effectiveApprovalPolicy(agent('fully_autonomous'), 'risky', simple), 'risky');
  assert.ok(execNeedsApproval({
    command: 'ls',
    computerKind: 'docker',
    policy: 'always',
    agent: agent('fully_autonomous'),
    settings: simple
  }));
});

test('read_only bloqueia ferramentas mutáveis', () => {
  assert.equal(isToolAllowedByAutonomy(agent('read_only'), 'computer_exec'), false);
  assert.equal(isToolAllowedByAutonomy(agent('read_only'), 'browser_read'), true);
  assert.equal(builtinToolAllowed(agent('read_only'), 'computer_exec', { settings: { computer: { mode: 'docker' } }, computer: {} }), false);
  const names = listRipperBuiltinToolNames(agent('read_only'), { computer: { mode: 'docker' } });
  assert.ok(!names.includes('computer_exec'));
});

test('fully_autonomous dispensa aprovação de exec rotineiro (enterprise)', () => {
  assert.equal(execNeedsApproval({
    command: 'ls',
    computerKind: 'docker',
    policy: 'always',
    agent: agent('fully_autonomous'),
    settings: enterprise
  }), null);
});

test('read_only exige aprovação mesmo com política never', () => {
  assert.ok(execNeedsApproval({
    command: 'ls',
    computerKind: 'docker',
    policy: 'never',
    agent: agent('read_only')
  }));
});

test('browser e share respeitam autonomia', () => {
  assert.equal(browserAutonomyGate(agent('fully_autonomous'), 'click', enterprise), null);
  assert.ok(browserAutonomyGate(agent('read_only'), 'click', enterprise));
  assert.ok(shareAutonomyGate(agent('read_only'), enterprise));
  assert.equal(shareAutonomyGate(agent('fully_autonomous'), enterprise), null);
});
