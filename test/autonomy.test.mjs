import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAutonomyLevel,
  effectiveApprovalPolicy,
  isToolAllowedByAutonomy,
  browserAutonomyGate,
  shareAutonomyGate
} from '../lib/autonomy.mjs';
import { execNeedsApproval, builtinToolAllowed } from '../lib/permissions.mjs';
import { listRipperBuiltinToolNames } from '../lib/ripper-builtin-tools.mjs';

const agent = level => ({ autonomyLevel: level, tools: ['web', 'memory', 'computer', 'browser', 'routines', 'files'] });

test('normalizeAutonomyLevel usa semi_autonomous como padrão', () => {
  assert.equal(normalizeAutonomyLevel(undefined), 'semi_autonomous');
  assert.equal(normalizeAutonomyLevel('bogus'), 'semi_autonomous');
  assert.equal(normalizeAutonomyLevel('read_only'), 'read_only');
});

test('effectiveApprovalPolicy por nível', () => {
  assert.equal(effectiveApprovalPolicy(agent('fully_autonomous'), 'risky'), 'never');
  assert.equal(effectiveApprovalPolicy(agent('read_only'), 'never'), 'always');
  assert.equal(effectiveApprovalPolicy(agent('semi_autonomous'), 'always'), 'always');
});

test('read_only bloqueia ferramentas mutáveis', () => {
  assert.equal(isToolAllowedByAutonomy(agent('read_only'), 'computer_exec'), false);
  assert.equal(isToolAllowedByAutonomy(agent('read_only'), 'browser_read'), true);
  assert.equal(builtinToolAllowed(agent('read_only'), 'computer_exec', { settings: { computer: { mode: 'docker' } }, computer: {} }), false);
  const names = listRipperBuiltinToolNames(agent('read_only'), { computer: { mode: 'docker' } });
  assert.ok(!names.includes('computer_exec'));
});

test('fully_autonomous dispensa aprovação de exec rotineiro', () => {
  assert.equal(execNeedsApproval({
    command: 'ls',
    computerKind: 'docker',
    policy: 'always',
    agent: agent('fully_autonomous')
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
  assert.equal(browserAutonomyGate(agent('fully_autonomous'), 'click'), null);
  assert.ok(browserAutonomyGate(agent('read_only'), 'click'));
  assert.ok(shareAutonomyGate(agent('read_only')));
  assert.equal(shareAutonomyGate(agent('fully_autonomous')), null);
});
