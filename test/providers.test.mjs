import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  codexSandboxMode,
  codexAskForApproval,
  codexChildEnv,
  codexWriteEnabled,
  codexUsesApiKeyAuth,
  defaultCodexHome,
  isolatedCodexProcessHome
} from '../lib/providers.mjs';
import { continueHistoryAfterConnectors, skipStreamedPrefix, toolCallKey } from '../lib/agent-flow.mjs';
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
  assert.ok(args.includes('shell_environment_policy.inherit=core'));
  assert.ok(args.some(a => String(a).includes('mcp_servers.my-mcp.command')));
  assert.ok(args.some(a => String(a).includes('mcp_servers.http-one.url')));
  assert.ok(args.some(a => String(a).includes('mcp_servers.ripper.command')));
  assert.ok(args.some(a => String(a).includes('RIPPER_MCP_BRIDGE_URL')));
  assert.ok(args.includes('/tmp/x.png'));
});

test('Codex no host fica read-only; escrita só com RIPPER_CODEX_WRITE=1, opção explícita e sem pedir aprovação', () => {
  const writeSettings = { computer: { mode: 'local', allowLocalCommands: true }, approvalPolicy: 'never' };
  assert.equal(codexWriteEnabled({}), false);
  assert.equal(codexWriteEnabled({ RIPPER_CODEX_WRITE: '1' }), true);
  assert.equal(codexSandboxMode(baseAgent, writeSettings, {}), 'read-only');
  assert.equal(codexSandboxMode(baseAgent, { computer: { mode: 'docker' } }, { RIPPER_CODEX_WRITE: '1' }), 'read-only');
  assert.equal(codexSandboxMode(baseAgent, { computer: { mode: 'boat' } }, { RIPPER_CODEX_WRITE: '1' }), 'read-only');
  assert.equal(codexSandboxMode(baseAgent, { computer: { mode: 'local', allowLocalCommands: true }, approvalPolicy: 'risky' }, { RIPPER_CODEX_WRITE: '1' }), 'read-only');
  assert.equal(codexSandboxMode(baseAgent, writeSettings, { RIPPER_CODEX_WRITE: '1' }), 'workspace-write');
  assert.equal(codexSandboxMode(baseAgent, { computer: { mode: 'local', allowLocalCommands: false }, approvalPolicy: 'never' }, { RIPPER_CODEX_WRITE: '1' }), 'read-only');
  assert.equal(codexSandboxMode({ ...baseAgent, autonomyLevel: 'read_only' }, writeSettings, { RIPPER_CODEX_WRITE: '1' }), 'read-only');
  assert.equal(codexAskForApproval(baseAgent, { approvalPolicy: 'risky' }), 'on-request');
  assert.equal(codexAskForApproval(baseAgent, { approvalPolicy: 'never' }), 'never');
  assert.equal(codexAskForApproval({ ...baseAgent, autonomyLevel: 'read_only' }, { approvalPolicy: 'never' }), 'untrusted');
  const dockerArgs = buildCodexSpawnArgs({ agent: baseAgent, settings: { ...settings, computer: { mode: 'docker' } }, env: {} }).join(' ');
  assert.match(dockerArgs, /--sandbox read-only/);
  assert.match(dockerArgs, /sandbox_workspace_write\.network_access=false/);
  assert.match(dockerArgs, /approval_policy=on-request/);
  assert.match(dockerArgs, /shell_environment_policy\.inherit=core/);
  assert.doesNotMatch(dockerArgs, /--ask-for-approval/);
  const writeArgs = buildCodexSpawnArgs({
    agent: baseAgent,
    settings: { ...settings, ...writeSettings },
    env: { RIPPER_CODEX_WRITE: '1' }
  });
  assert.deepEqual(writeArgs.slice(0, 5), ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'workspace-write']);
  assert.ok(writeArgs.includes('approval_policy=never'));
});

test('Codex spawn herda só o env core nos comandos (OPENAI_API_KEY não vaza para o shell)', () => {
  const args = buildCodexSpawnArgs({ agent: baseAgent, settings, env: {} });
  const i = args.indexOf('shell_environment_policy.inherit=core');
  assert.ok(i > 0);
  assert.equal(args[i - 1], '-c');
  assert.ok(!args.some(a => String(a).includes('shell_environment_policy.inherit=all')));
});

test('CLI real do Codex: --ask-for-approval depois de exec falha; -c approval_policy vale', () => {
  const localBin = '/tmp/codex-cli/node_modules/.bin/codex';
  const which = spawnSync('which', ['codex'], { encoding: 'utf8' });
  const bin = (process.env.CODEX_BIN && existsSync(process.env.CODEX_BIN) && process.env.CODEX_BIN)
    || (existsSync(localBin) && localBin)
    || (which.status === 0 && which.stdout.trim())
    || '';
  if (!bin) {
    const args = buildCodexSpawnArgs({ agent: baseAgent, settings, env: {} });
    assert.equal(args[0], 'exec');
    assert.ok(args.includes('approval_policy=on-request'));
    assert.ok(!args.includes('--ask-for-approval'));
    return;
  }
  const after = spawnSync(bin, ['exec', '--ask-for-approval', 'never', '--version'], { encoding: 'utf8' });
  assert.notEqual(after.status, 0, after.stderr || after.stdout);
  assert.match(`${after.stderr}${after.stdout}`, /unexpected argument|--ask-for-approval/i);
  const viaConfig = spawnSync(bin, ['exec', '-c', 'approval_policy=never', '-c', 'shell_environment_policy.inherit=core', '--version'], { encoding: 'utf8' });
  assert.equal(viaConfig.status, 0, viaConfig.stderr || viaConfig.stdout);
  const before = spawnSync(bin, ['--ask-for-approval', 'never', 'exec', '--version'], { encoding: 'utf8' });
  assert.equal(before.status, 0, before.stderr || before.stdout);
});

test('Codex recebe env mínimo, HOME isolado, CODEX_HOME e OPENAI_API_KEY só na auth por chave', () => {
  const isolated = join(tmpdir(), 'ripper-codex-home-test');
  const login = join(tmpdir(), 'ripper-codex-login');
  const env = codexChildEnv({
    PATH: '/bin',
    HOME: '/home/ripper',
    ANTHROPIC_API_KEY: 'sk-secret',
    GITHUB_TOKEN: 'ghp_x',
    RIPPER_TOKEN: 'tok',
    OPENAI_API_KEY: 'sk-openai',
    AWS_SECRET_ACCESS_KEY: 'aws',
    CODEX_HOME: login,
    XDG_CONFIG_HOME: '/home/ripper/.config',
    USERPROFILE: 'C:\\Users\\ripper'
  }, { isolatedHome: isolated, codexHome: login });
  assert.equal(env.PATH, '/bin');
  assert.equal(env.HOME, isolated);
  assert.notEqual(env.HOME, '/home/ripper');
  assert.equal(env.CODEX_HOME, login);
  assert.equal(env.XDG_CONFIG_HOME, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.RIPPER_TOKEN, undefined);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.OPENAI_API_KEY, 'sk-openai');
  assert.equal(codexUsesApiKeyAuth({ OPENAI_API_KEY: 'sk-openai' }, login), true);

  mkdirSync(login, { recursive: true });
  writeFileSync(join(login, 'auth.json'), JSON.stringify({ tokens: { access_token: 'chatgpt' } }));
  const withLogin = codexChildEnv({
    PATH: '/bin',
    HOME: '/home/ripper',
    OPENAI_API_KEY: 'sk-openai',
    CODEX_HOME: login
  }, { isolatedHome: isolated, codexHome: login });
  assert.equal(withLogin.OPENAI_API_KEY, undefined);
  assert.equal(withLogin.CODEX_HOME, login);
  assert.equal(withLogin.HOME, isolated);
  assert.equal(codexUsesApiKeyAuth({ OPENAI_API_KEY: 'sk-openai' }, login), false);
  assert.equal(defaultCodexHome({ CODEX_HOME: login }), login);
  assert.match(isolatedCodexProcessHome({}), /ripper-codex-home/);
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

test('Codex transmite só deltas da mensagem do agente', () => {
  const state = { last: '' };
  const a = applyCodexTextEvent(parseCodexJsonEvent({ type: 'item.updated', item: { type: 'agent_message', text: 'Hel' } }), state);
  const b = applyCodexTextEvent(parseCodexJsonEvent({ type: 'item.updated', item: { type: 'agent_message', text: 'Hello' } }), state);
  const c = applyCodexTextEvent(parseCodexJsonEvent({ type: 'item.completed', item: { type: 'agent_message', text: 'Hello' } }), state);
  assert.deepEqual(a, { text: 'Hel' });
  assert.deepEqual(b, { text: 'lo' });
  assert.equal(c, null);
  assert.deepEqual(applyCodexTextEvent(parseCodexJsonEvent({ msg: { type: 'agent_message_delta', delta: '!' } }), { last: 'Hello' }), { text: '!' });
  assert.equal(parseCodexJsonEvent({ type: 'item.updated', item: { type: 'reasoning', text: 'pensando' } }), null);
  assert.equal(parseCodexJsonEvent({ type: 'item/commandExecution/outputDelta', delta: 'ls out' }), null);
  assert.equal(parseCodexJsonEvent({ msg: { type: 'agent_reasoning_delta', delta: 'hmm' } }), null);
});

test('Codex não duplica a segunda mensagem do mesmo turno no stream', () => {
  const state = { last: '' };
  applyCodexTextEvent(parseCodexJsonEvent({ type: 'item.updated', item: { id: 'm1', type: 'agent_message', text: 'Primeira' } }), state);
  applyCodexTextEvent(parseCodexJsonEvent({ type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'Primeira' } }), state);
  const d1 = applyCodexTextEvent(parseCodexJsonEvent({ type: 'item.agent_message_delta', item: { id: 'm2', type: 'agent_message_delta', delta: 'Segunda' } }), state);
  const d2 = applyCodexTextEvent(parseCodexJsonEvent({ type: 'item.completed', item: { id: 'm2', type: 'agent_message', text: 'Segunda' } }), state);
  assert.deepEqual(d1, { text: 'Segunda' });
  assert.equal(d2, null);

  const noId = { last: 'Primeira' };
  const streamed = applyCodexTextEvent({ text: 'Segunda' }, noId);
  const snap = applyCodexTextEvent({ text: 'Segunda', snapshot: true }, noId);
  assert.deepEqual(streamed, { text: 'Segunda' });
  assert.equal(snap, null, 'snapshot da 2ª mensagem não reenvia o que já saiu em delta');
});

test('histórico vai ao Claude e ao Codex como mensagens reais', () => {
  const history = [
    { role: 'user', content: 'lembra o café' },
    { role: 'assistant', content: 'anotei', steps: [{ tool: 'remember', detail: 'café' }] }
  ];
  const msgs = claudePromptMessages(history, 'e o chá?');
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].shouldQuery, undefined);
  assert.equal(msgs[0].client_composed, undefined);
  assert.equal(msgs[0].type, 'user');
  assert.equal(msgs[0].message.role, 'user');
  assert.ok(Array.isArray(msgs[0].message.content));
  assert.match(msgs[0].message.content[0].text, /^user:\nlembra o café/);
  assert.match(msgs[0].message.content[1].text, /^assistant:\nanotei/);
  assert.match(msgs[0].message.content[1].text, /remember: café/);
  assert.equal(msgs[0].message.content[2].text, 'e o chá?');
  assert.doesNotMatch(JSON.stringify(msgs), /Usuário: lembra/);
  assert.equal(claudePromptInput([], 'oi'), 'oi');

  const prompt = buildCodexPrompt({ system: 'sys', history, prompt: 'e o chá?' });
  assert.match(prompt, /^sys/);
  assert.match(prompt, /user:\nlembra o café/);
  assert.match(prompt, /assistant:\nanotei/);
  assert.doesNotMatch(prompt, /Usuário: lembra o café/);
});

test('use_connectors continua o turno sem duplicar texto; 2º uso legítimo da ferramenta passa', () => {
  const cont = continueHistoryAfterConnectors(
    [{ role: 'user', content: 'oi' }],
    'vê a agenda',
    { text: 'vou abrir', tools: [{ tool: 'remember', input: { text: 'x' }, detail: 'x' }, { tool: 'use_connectors' }] }
  );
  assert.equal(cont.history.length, 3);
  assert.equal(cont.history[1].content, 'vê a agenda');
  assert.match(cont.history[2].content, /vou abrir/);
  assert.match(cont.prompt, /pode usar de novo/i);
  assert.deepEqual(cont.doneTools, [toolCallKey('remember', { text: 'x' })]);
  assert.ok(!cont.doneTools.includes('remember'));
  assert.ok(!cont.doneTools.includes(toolCallKey('remember', { text: 'outro fato' })));
  assert.equal(cont.streamedText, 'vou abrir');
  assert.deepEqual(skipStreamedPrefix('vou abrir a agenda', cont.streamedText), { text: ' a agenda', rest: '' });
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
