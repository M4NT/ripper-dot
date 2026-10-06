import test from 'node:test';
import assert from 'node:assert/strict';
import { repairChatRunsOnStartup, noteChatRunTool, canAutoResume, beginChatRun } from '../lib/chat-run.mjs';

const chatWith = tools => {
  const c = { messages: [{ id: 'u1', role: 'user', content: 'pesquise X' }] };
  beginChatRun(c, { runId: 'r', userMessageId: 'u1' });
  for (const t of tools) noteChatRunTool(c, t);
  repairChatRunsOnStartup([c]); // o servidor caiu no meio
  return c;
};

test('reinício no meio de turno que só leu/pesquisou: retoma sozinho', () => {
  const v = canAutoResume(chatWith(['WebSearch', 'mcp__ripper__read_artifact']));
  assert.equal(v.auto, true);
  assert.equal(v.text, 'pesquise X');
});

test('turno que já enviou/executou algo: não retoma sozinho (repetiria a ação)', () => {
  for (const t of ['whatsapp_send', 'email_send', 'computer_exec', 'browser_click', 'mcp__gmail__send', 'post_social']) {
    const v = canAutoResume(chatWith(['WebSearch', t]));
    assert.equal(v.auto, false, t);
    assert.ok(v.unsafe?.length, t);
  }
});

test('só retoma o que o reinício cortou, e por até 30 minutos', () => {
  const c = chatWith([]);
  assert.equal(canAutoResume(c, Date.now() + 31 * 60_000).auto, false, 'velho demais');
  const stopped = { messages: [{ id: 'u', role: 'user', content: 'oi' }], run: { status: 'interrupted', finishedAt: Date.now() } };
  assert.equal(canAutoResume(stopped).auto, false, 'parado pelo usuário/queda sem reinício');
});
