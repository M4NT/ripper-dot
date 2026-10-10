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
  applyCodexTextEvent,
  describeRipperTool,
  claudePromptMessages,
  claudePromptInput,
  buildCodexPrompt,
  codexSandboxMode
} from '../lib/providers.mjs';
import { continueHistoryAfterConnectors } from '../lib/agent-flow.mjs';
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

test('buildCodexSpawnArgs: sandbox read-only sem computador isolado, MCP stdio/http e ripper builtin', () => {
  const off = { ...settings, computer: { mode: 'off', allowLocalCommands: false } };
  const bridge = { url: 'http://127.0.0.1:9', token: 'tok' };
  const args = buildCodexSpawnArgs({ agent: baseAgent, effort: 'high', settings: off, images: [{ path: '/tmp/x.png' }], ripperMcpBridge: bridge });
  assert.deepEqual(args.slice(0, 5), ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only']);
  assert.ok(args.includes('-c'));
  assert.ok(args.some(a => String(a).includes('mcp_servers.my-mcp.command')));
  assert.ok(args.some(a => String(a).includes('mcp_servers.http-one.url')));
  assert.ok(args.some(a => String(a).includes('mcp_servers.ripper.command')));
  assert.ok(args.some(a => String(a).includes('RIPPER_MCP_BRIDGE_URL')));
  assert.ok(args.includes('/tmp/x.png'));
});

test('Codex escreve no workspace quando o computador isola o agente', () => {
  assert.equal(codexSandboxMode(baseAgent, { computer: { mode: 'docker' } }), 'workspace-write');
  assert.equal(codexSandboxMode(baseAgent, { computer: { mode: 'boat' } }), 'workspace-write');
  assert.equal(codexSandboxMode(baseAgent, { computer: { mode: 'local', allowLocalCommands: true } }), 'workspace-write');
  assert.equal(codexSandboxMode(baseAgent, { computer: { mode: 'local', allowLocalCommands: false } }), 'read-only');
  assert.equal(codexSandboxMode({ ...baseAgent, tools: ['web'] }, { computer: { mode: 'docker' } }), 'read-only');
  assert.equal(codexSandboxMode({ ...baseAgent, autonomyLevel: 'read_only' }, { computer: { mode: 'docker' } }), 'read-only');
  const dockerArgs = buildCodexSpawnArgs({ agent: baseAgent, settings: { ...settings, computer: { mode: 'docker' } } });
  assert.deepEqual(dockerArgs.slice(0, 5), ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'workspace-write']);
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
  const msg = parseCodexJsonEvent({ item: { type: 'agent_message', text: 'oi' } });
  assert.equal(msg.text, 'oi');
  assert.equal(msg.snapshot, true);
  // shell do Codex não é o Computador do Ripper (a UI dizia "Rodando no computador" com o modo desligado)
  assert.equal(parseCodexJsonEvent({ item: { type: 'command_execution', command: 'ls' } }).tool, 'shell');
  assert.deepEqual(
    parseCodexJsonEvent({ type: 'item.started', item: { type: 'mcp_tool_call', server: 'ripper', tool: 'remember', arguments: { text: 'x' }, status: 'in_progress' } }),
    describeRipperTool('remember', { text: 'x' })
  );
});

test('Codex transmite texto aos poucos a partir de snapshot e delta', () => {
  const state = { last: '' };
  const a = applyCodexTextEvent(parseCodexJsonEvent({ type: 'item.updated', item: { type: 'agent_message', text: 'Hel' } }), state);
  const b = applyCodexTextEvent(parseCodexJsonEvent({ type: 'item.updated', item: { type: 'agent_message', text: 'Hello' } }), state);
  const c = applyCodexTextEvent(parseCodexJsonEvent({ type: 'item.completed', item: { type: 'agent_message', text: 'Hello' } }), state);
  assert.deepEqual(a, { text: 'Hel' });
  assert.deepEqual(b, { text: 'lo' });
  assert.equal(c, null);
  assert.deepEqual(applyCodexTextEvent(parseCodexJsonEvent({ msg: { type: 'agent_message_delta', delta: '!' } }), { last: 'Hello' }), { text: '!' });
});

test('histórico vai ao Claude e ao Codex como mensagens reais', () => {
  const history = [
    { role: 'user', content: 'lembra o café' },
    { role: 'assistant', content: 'anotei', steps: [{ tool: 'remember', detail: 'café' }] }
  ];
  const msgs = claudePromptMessages(history, 'e o chá?');
  assert.equal(msgs.length, 3);
  assert.equal(msgs[0].shouldQuery, false);
  assert.equal(msgs[0].message.role, 'user');
  assert.equal(msgs[0].message.content, 'lembra o café');
  assert.equal(msgs[1].message.role, 'assistant');
  assert.match(msgs[1].message.content, /anotei/);
  assert.match(msgs[1].message.content, /remember: café/);
  assert.equal(msgs[2].message.content, 'e o chá?');
  assert.doesNotMatch(JSON.stringify(msgs), /Usuário: lembra/);
  assert.equal(claudePromptInput([], 'oi'), 'oi');

  const prompt = buildCodexPrompt({ system: 'sys', history, prompt: 'e o chá?' });
  assert.match(prompt, /^sys/);
  assert.match(prompt, /user:\nlembra o café/);
  assert.match(prompt, /assistant:\nanotei/);
  assert.doesNotMatch(prompt, /Usuário: lembra o café/);
});

test('use_connectors continua o turno com o que já foi feito', () => {
  const cont = continueHistoryAfterConnectors(
    [{ role: 'user', content: 'oi' }],
    'vê a agenda',
    { text: 'vou abrir', tools: [{ tool: 'use_connectors' }] }
  );
  assert.equal(cont.history.length, 3);
  assert.equal(cont.history[1].content, 'vê a agenda');
  assert.match(cont.history[2].content, /vou abrir/);
  assert.match(cont.prompt, /Continue de onde parou/);
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
