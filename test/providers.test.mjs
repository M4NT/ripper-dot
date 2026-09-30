import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeAllowedTools, buildCodexSpawnArgs, userMcp, buildClaudeQueryOptions } from '../lib/providers.mjs';

const baseAgent = {
  id: 'a1',
  name: 'Bot',
  tools: ['web', 'memory', 'computer', 'plugins'],
  tone: 'direto',
  description: '',
  instructions: ''
};

const settings = {
  claude: { mode: 'subscription', useConnectors: true },
  computer: { mode: 'boat', allowLocalCommands: false },
  plugins: [
    { name: 'my-mcp', type: 'stdio', command: 'node', args: ['mcp.js'], enabled: true },
    { name: 'off-mcp', type: 'stdio', command: 'x', enabled: false },
    { name: 'http-one', type: 'http', url: 'https://example.com/mcp', enabled: true }
  ]
};

test('claudeAllowedTools reflete ctx e plugins MCP', () => {
  const ctx = { artifacts: true, inbox: true, browser: false, skills: true, computer: {} };
  const tools = claudeAllowedTools(baseAgent, settings, ctx);
  assert.ok(tools.includes('mcp__ripper__remember'));
  assert.ok(tools.includes('mcp__ripper__send_message'));
  assert.ok(tools.includes('mcp__my-mcp__*'));
  assert.ok(!tools.some(t => t.includes('off-mcp')));
  assert.ok(tools.includes('WebSearch'));
  assert.ok(!tools.includes('mcp__ripper__browser_open'));
});

test('userMcp ignora plugins quando ferramenta plugins está desligada', () => {
  const agent = { ...baseAgent, tools: ['web'] };
  assert.deepEqual(userMcp(agent, settings.plugins), {});
});

test('buildCodexSpawnArgs: sandbox read-only e MCP stdio na linha de comando', () => {
  const args = buildCodexSpawnArgs({ agent: baseAgent, effort: 'high', settings, images: [{ path: '/tmp/x.png' }] });
  assert.deepEqual(args.slice(0, 5), ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only']);
  assert.ok(args.includes('-c'));
  assert.ok(args.some(a => String(a).includes('mcp_servers.my-mcp.command')));
  assert.ok(args.includes('/tmp/x.png'));
  assert.ok(!args.some(a => String(a).includes('http-one')));
});

test('buildClaudeQueryOptions registra MCP ripper e conectores só com plugins', () => {
  const agent = { ...baseAgent, tools: ['memory', 'plugins'] };
  const ctx = { remember: () => {} };
  const opts = buildClaudeQueryOptions({
    agent,
    model: 'claude-sonnet-5-5',
    effort: 'auto',
    system: 'sys',
    settings,
    ctx,
    web: false,
    env: {},
    abortController: new AbortController()
  });
  assert.ok(opts.mcpServers.ripper);
  assert.equal(opts.mcpServers['my-mcp'].command, 'node');
  assert.deepEqual(opts.settingSources, ['user']);
  const allowed = claudeAllowedTools(agent, settings, ctx);
  assert.ok(allowed.includes('mcp__ripper__remember'));
});
