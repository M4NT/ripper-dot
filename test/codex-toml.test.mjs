import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexMcpConfigLines, toml } from '../lib/codex-mcp.mjs';
import { runProviderAttemptLoop } from '../lib/provider-turn.mjs';

test('Codex -c: caminhos do Windows viram TOML literal (sem aspas duplas, que o cmd remove)', () => {
  const lines = codexMcpConfigLines('ripper', { command: String.raw`C:\Program Files\node.exe`, args: [String.raw`C:\x\y.mjs`], headers: { a: 'b' } });
  assert.deepEqual(lines, [
    '-c', String.raw`mcp_servers.ripper.command='C:\Program Files\node.exe'`,
    '-c', String.raw`mcp_servers.ripper.args=['C:\x\y.mjs']`,
    '-c', `mcp_servers.ripper.http_headers={ "a" = 'b' }`
  ]);
  assert.equal(toml("it's"), '"it\'s"', 'aspas simples no texto: volta para string com escape');
});

test('modelo fora da assinatura não abre o disjuntor do provedor', async () => {
  let failures = 0;
  const cb = { allow: () => ({ allowed: true }), recordFailure: () => failures++, recordSuccess() {}, snapshot: () => ({}) };
  await runProviderAttemptLoop({
    order: ['claude-fable-5-1', 'claude-opus-5-5'],
    getCircuitBreaker: () => cb,
    runModel: async function* (m) { if (m === 'claude-fable-5-1') throw new Error('Fable 5.1 requires usage credits.'); yield { text: 'ok' }; }
  });
  assert.equal(failures, 0);
});

test('Windows: argumentos com espaço vão entre aspas para o cmd não quebrar', async () => {
  const { shellArgs } = await import('../lib/providers.mjs');
  assert.deepEqual(shellArgs(['exec', String.raw`a.command='C:\Program Files\node.exe'`, '-'], true), ['exec', String.raw`"a.command='C:\Program Files\node.exe'"`, '-']);
  assert.deepEqual(shellArgs(['x y'], false), ['x y']);
});
