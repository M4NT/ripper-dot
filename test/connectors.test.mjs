import test from 'node:test';
import assert from 'node:assert/strict';
import { connectorToolAllowed, buildClaudeQueryOptions } from '../lib/providers.mjs';

const agent = tools => ({ id: 'a', tools });
const s = (extra = {}) => ({ claude: { useConnectors: true }, plugins: [{ name: 'notion', type: 'http', url: 'https://mcp.notion.com/mcp' }], ...extra });

test('conectores do claude.ai: liberados só com "Plugins MCP" e a opção ligada', () => {
  assert.equal(connectorToolAllowed('mcp__claude_ai_Google_Calendar__create_event', agent(['plugins']), s()), true);
  assert.equal(connectorToolAllowed('mcp__claude_ai_Google_Calendar__create_event', agent(['web']), s()), false);
  assert.equal(connectorToolAllowed('mcp__claude_ai_Gmail__send', agent(['plugins']), s({ claude: { useConnectors: false } })), false);
});

test('conector instalado no Ripper passa; plugin local do Claude Code e ferramentas soltas não', () => {
  assert.equal(connectorToolAllowed('mcp__notion__search', agent(['plugins']), s()), true);
  assert.equal(connectorToolAllowed('mcp__inspo__search_screens', agent(['plugins']), s()), false);
  assert.equal(connectorToolAllowed('Bash', agent(['plugins']), s()), false);
});

test('SDK em modo default com decisão por chamada (dontAsk negava conectores em silêncio)', async () => {
  const o = buildClaudeQueryOptions({ agent: agent(['plugins']), model: 'claude-haiku-4-5', system: '', settings: s(), ctx: {}, web: false, env: {} });
  assert.equal(o.permissionMode, 'default');
  assert.deepEqual(await o.canUseTool('mcp__claude_ai_Gmail__search', { q: 'x' }), { behavior: 'allow', updatedInput: { q: 'x' } });
  const deny = await o.canUseTool('mcp__inspo__x', {});
  assert.equal(deny.behavior, 'deny');
  assert.doesNotMatch(deny.message, /mcp__|inspo/);
});

test('MCPs e plugins locais do Claude Code nem chegam ao agente; conectores do Ripper continuam', () => {
  const localExtras = { mcpServers: ['inspo', 'notion', 'multi.pli'], plugins: ['vercel@x'] };
  const o = buildClaudeQueryOptions({ agent: agent(['plugins']), model: 'm', system: '', settings: s(), ctx: {}, web: false, env: {}, localExtras });
  assert.deepEqual(o.disallowedTools, ['mcp__inspo', 'mcp__multi_pli']);
  assert.deepEqual(o.settings, { enabledPlugins: { 'vercel@x': false } });
  const off = buildClaudeQueryOptions({ agent: agent(['web']), model: 'm', system: '', settings: s(), ctx: {}, web: false, env: {} });
  assert.equal(off.disallowedTools, undefined);
});
