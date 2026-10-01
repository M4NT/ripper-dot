import test from 'node:test';
import assert from 'node:assert/strict';
import {
  callAgentPrompt,
  clampCallTimeoutMs,
  interpretInboxReply,
  formatCallAgentResult,
  MIN_CALL_TIMEOUT_MS,
  MAX_CALL_TIMEOUT_MS
} from '../lib/inbox.mjs';
import { applySettingsPatch } from '../lib/settings-patch.mjs';
import { builtinToolAllowed } from '../lib/permissions.mjs';

test('callAgentPrompt indica espera síncrona', () => {
  const p = callAgentPrompt({ body: 'Qual o título?' }, 'Ana');
  assert.match(p, /Chamada síncrona de Ana/);
  assert.match(p, /aguardando sua resposta agora/);
});

test('clampCallTimeoutMs respeita limites e configuração', () => {
  assert.equal(clampCallTimeoutMs(undefined, { callTimeoutSeconds: 90 }), 90_000);
  assert.equal(clampCallTimeoutMs(2, {}), MIN_CALL_TIMEOUT_MS);
  assert.equal(clampCallTimeoutMs(999, {}), MAX_CALL_TIMEOUT_MS);
});

test('interpretInboxReply e formatCallAgentResult', () => {
  const msgs = [
    { role: 'user', content: 'pedido' },
    { role: 'assistant', content: 'resposta', model: 'claude' }
  ];
  assert.deepEqual(interpretInboxReply(msgs, 1), { ok: true, content: 'resposta', model: 'claude' });
  assert.match(formatCallAgentResult({ ok: false, error: 'timeout' }), /Erro ao chamar colega: timeout/);
  assert.equal(formatCallAgentResult({ ok: true, content: 'ok' }), 'ok');
  assert.equal(interpretInboxReply([{ role: 'user', content: 'x' }], 1).ok, false);
  assert.equal(interpretInboxReply([{ role: 'user', content: 'x' }, { role: 'assistant', error: 'falha' }], 1).error, 'falha');
});

test('settings-patch guarda callTimeoutSeconds do inbox', () => {
  const s = { inbox: { maxPerHour: 20, maxHops: 3 } };
  applySettingsPatch(s, { inbox: { callTimeoutSeconds: 45 } });
  assert.equal(s.inbox.callTimeoutSeconds, 45);
  applySettingsPatch(s, { inbox: { callTimeoutSeconds: 9999 } });
  assert.equal(s.inbox.callTimeoutSeconds, 300);
});

test('call_agent é ferramenta builtin permitida como send_message', () => {
  const agent = { tools: ['web', 'memory'] };
  assert.equal(builtinToolAllowed(agent, 'call_agent', {}), true);
  assert.equal(builtinToolAllowed(agent, 'send_message', {}), true);
});
