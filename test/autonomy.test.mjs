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

test('somente leitura bloqueia conectores MCP salvo readOnlyHint (Claude e Codex)', async () => {
  const { claudeAllowedTools, connectorToolAllowed, buildCodexSpawnArgs } = await import('../lib/providers.mjs');
  const { readOnlyToolNames } = await import('../lib/mcp-probe.mjs');
  assert.deepEqual(readOnlyToolNames([{ name: 'ler', annotations: { readOnlyHint: true } }, { name: 'gravar' }, { name: 'x', annotations: { readOnlyHint: false } }]), ['ler']);
  const settings = {
    ...enterprise,
    claude: { useConnectors: true },
    computer: { mode: 'boat' },
    plugins: [
      { name: 'crm', type: 'http', url: 'https://crm.example/mcp', readOnlyTools: ['ler'] },
      { name: 'sem', type: 'stdio', command: 'x', args: [] }
    ]
  };
  const ag = level => ({ ...agent(level), tools: [...agent(level).tools, 'plugins'] });
  assert.ok(connectorToolAllowed('mcp__crm__gravar', ag('semi_autonomous'), settings));
  assert.ok(connectorToolAllowed('mcp__claude_ai_Gmail__send', ag('semi_autonomous'), settings));
  assert.ok(claudeAllowedTools(ag('semi_autonomous'), settings, { computer: {} }).includes('mcp__crm__*'));
  const ro = ag('read_only');
  assert.ok(connectorToolAllowed('mcp__crm__ler', ro, settings));
  assert.ok(!connectorToolAllowed('mcp__crm__gravar', ro, settings));
  assert.ok(!connectorToolAllowed('mcp__sem__qualquer', ro, settings));
  assert.ok(!connectorToolAllowed('mcp__claude_ai_Gmail__send', ro, settings));
  const allowed = claudeAllowedTools(ro, settings, { computer: {} });
  assert.ok(allowed.includes('mcp__crm__ler'));
  assert.ok(!allowed.some(t => t === 'mcp__crm__*' || t.startsWith('mcp__sem__')));
  const args = buildCodexSpawnArgs({ agent: ro, settings }).join(' ');
  assert.match(args, /mcp_servers\.crm\.enabled_tools=\["ler"\]/);
  assert.doesNotMatch(args, /mcp_servers\.sem\./);
  assert.doesNotMatch(buildCodexSpawnArgs({ agent: ag('semi_autonomous'), settings }).join(' '), /enabled_tools/);
});
