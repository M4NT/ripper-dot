import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  claudeAllowedTools,
  buildCodexSpawnArgs,
  userMcp,
  mcpPluginHttpHeaders,
  buildClaudeQueryOptions,
  parseCodexJsonEvent,
  describeRipperTool
} from '../lib/providers.mjs';
import { createRipperMcpBridge } from '../lib/ripper-mcp-bridge.mjs';
import { ripperClaudeToolAllowlist } from '../lib/ripper-builtin-tools.mjs';

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
  assert.ok(tools.includes('mcp__ripper__call_agent'));
  assert.ok(tools.includes('mcp__my-mcp__*'));
  assert.ok(!tools.some(t => t.includes('off-mcp')));
  assert.ok(tools.includes('WebSearch'));
  assert.ok(!tools.includes('mcp__ripper__browser_open'));
  assert.deepEqual(
    tools.filter(t => t.startsWith('mcp__ripper__')),
    ripperClaudeToolAllowlist(baseAgent, ctx)
  );
});

test('mcpPluginHttpHeaders injeta Bearer OAuth', () => {
  const h = mcpPluginHttpHeaders({
    headers: { 'x-foo': '1' },
    auth: { oauth: { accessToken: 'secret', tokenType: 'Bearer' } }
  });
  assert.equal(h['x-foo'], '1');
  assert.match(h.authorization, /Bearer secret/);
});

test('userMcp ignora plugins quando ferramenta plugins está desligada', () => {
  const agent = { ...baseAgent, tools: ['web'] };
  assert.deepEqual(userMcp(agent, settings.plugins), {});
});

test('buildCodexSpawnArgs: sandbox read-only, MCP stdio/http e ripper builtin', () => {
  const bridge = { url: 'http://127.0.0.1:9', token: 'tok' };
  const args = buildCodexSpawnArgs({ agent: baseAgent, effort: 'high', settings, images: [{ path: '/tmp/x.png' }], ripperMcpBridge: bridge });
  assert.deepEqual(args.slice(0, 5), ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only']);
  assert.ok(args.includes('-c'));
  assert.ok(args.some(a => String(a).includes('mcp_servers.my-mcp.command')));
  assert.ok(args.some(a => String(a).includes('mcp_servers.http-one.url')));
  assert.ok(args.some(a => String(a).includes('mcp_servers.ripper.command')));
  assert.ok(args.some(a => String(a).includes('RIPPER_MCP_BRIDGE_URL')));
  assert.ok(args.includes('/tmp/x.png'));
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

test('parseCodexJsonEvent: mensagem, shell e mcp ripper', () => {
  assert.deepEqual(parseCodexJsonEvent({ item: { type: 'agent_message', text: 'oi' } }), { text: 'oi' });
  // shell do Codex não é o Computador do Ripper (a UI dizia "Rodando no computador" com o modo desligado)
  assert.equal(parseCodexJsonEvent({ item: { type: 'command_execution', command: 'ls' } }).tool, 'shell');
  assert.deepEqual(
    parseCodexJsonEvent({ type: 'item.started', item: { type: 'mcp_tool_call', server: 'ripper', tool: 'remember', arguments: { text: 'x' }, status: 'in_progress' } }),
    describeRipperTool('remember', { text: 'x' })
  );
});

test('createRipperMcpBridge executa remember sem Codex', async () => {
  let saved;
  const bridge = await createRipperMcpBridge(
    { tools: ['memory'] },
    { remember: (text, tier) => { saved = { text, tier }; } }
  );
  assert.ok(bridge);
  const res = await fetch(`${bridge.url}/call`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'remember', arguments: { text: 'teste', tier: 'profile' } })
  });
  assert.equal(res.status, 200);
  assert.deepEqual(saved, { text: 'teste', tier: 'profile' });
  await bridge.close();
});

test('ripper mcp stdio script path resolve no repo', () => {
  const script = fileURLToPath(new URL('../lib/ripper-mcp-stdio.mjs', import.meta.url));
  assert.match(script, /ripper-mcp-stdio\.mjs$/);
});
