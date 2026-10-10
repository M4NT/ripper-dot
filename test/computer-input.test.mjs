import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INPUT_DENIED,
  USER_CONTROL_MSG,
  _resetComputerInputForTests,
  computerInputNeedsApproval,
  computerInputRememberKey,
  isDangerousKeys,
  isUserScreenControl,
  parseKeys,
  serializeCall,
  setUserScreenControl,
  splitTypeText,
  typeTimeoutMs,
  withTypeIdempotency,
  wrapComputerInput
} from '../lib/computer-input.mjs';

const semi = { autonomyLevel: 'semi_autonomous', id: 'ag1' };
const full = { autonomyLevel: 'fully_autonomous', id: 'ag2' };
const enterprise = { ui: { mode: 'enterprise' } };

test('teclas: lista permitida, perigosas e recusa o resto', () => {
  assert.deepEqual(parseKeys('Return ctrl+c').map(k => k.xdo), ['Return', 'ctrl+c']);
  assert.equal(parseKeys('Enter')[0].xdo, 'Return');
  assert.equal(isDangerousKeys('alt+F4'), true);
  assert.equal(isDangerousKeys('ctrl+w'), true);
  assert.equal(isDangerousKeys('ctrl+alt+Delete'), true);
  assert.equal(isDangerousKeys('ctrl+q'), true);
  assert.equal(isDangerousKeys('Return'), false);
  assert.throws(() => parseKeys('alt+Tab'), /não permitida/);
  assert.throws(() => parseKeys('ctrl+c; rm'), /inválidas/);
  assert.throws(() => parseKeys(Array(9).fill('Tab').join(' ')), /no máximo 8/);
});

test('aprovação: semi pede; fully dispensa; tecla perigosa sempre pede; lembrar libera', () => {
  const click = computerInputNeedsApproval({ kind: 'click', input: { x: 10, y: 20 }, agent: semi, allowed: [] });
  assert.match(click.reason, /aprovação/);
  assert.equal(click.rememberKey, 'computer_click');

  assert.equal(computerInputNeedsApproval({
    kind: 'click', input: { x: 10, y: 20 }, agent: full, settings: enterprise, allowed: []
  }).ok, true);

  assert.equal(computerInputNeedsApproval({
    kind: 'type', input: { text: 'oi' }, agent: semi, allowed: ['computer_type']
  }).ok, true);

  const danger = computerInputNeedsApproval({
    kind: 'key', input: { keys: 'alt+F4' }, agent: full, settings: enterprise, allowed: ['computer_key']
  });
  assert.match(danger.reason, /perigosa/);
  assert.equal(danger.rememberKey, computerInputRememberKey('key', { keys: 'alt+F4' }));
  assert.equal(computerInputNeedsApproval({
    kind: 'key', input: { keys: 'alt+F4' }, agent: semi, allowed: [danger.rememberKey]
  }).ok, true);

  assert.equal(computerInputNeedsApproval({
    kind: 'move', input: { x: 1, y: 1 }, agent: { autonomyLevel: 'read_only' }, allowed: []
  }).blocked, true);
});

test('wrapComputerInput: pede aprovação, lembra, grava auditoria e respeita Assumir controle', async () => {
  _resetComputerInputForTests();
  const calls = [];
  const asks = [];
  const records = [];
  const allowed = [];
  const computer = {
    click: async a => (calls.push(['click', a]), 'ok-click'),
    type: async a => (calls.push(['type', a.text]), 'ok-type'),
    key: async a => (calls.push(['key', a.keys]), 'ok-key')
  };
  const gated = wrapComputerInput(computer, {
    agent: semi,
    settings: {},
    allowed,
    ask: async (command, reason, key) => {
      asks.push({ command, reason, key });
      return false;
    },
    record: r => records.push(r)
  });
  assert.equal(await gated.click({ x: 8, y: 9 }), INPUT_DENIED);
  assert.equal(calls.length, 0);
  assert.equal(asks[0].key, 'computer_click');

  const ok = wrapComputerInput(computer, {
    agent: semi,
    allowed,
    ask: async (_c, _r, key) => { allowed.push(key); return true; },
    record: r => records.push(r)
  });
  assert.equal(await ok.click({ x: 8, y: 9 }), 'ok-click');
  assert.equal(await ok.click({ x: 1, y: 2 }), 'ok-click', 'lembrar nesta conversa libera o próximo clique');
  assert.equal(records.filter(r => r.ok).length, 2);
  assert.equal(records.at(-1).approved, 'rule');

  setUserScreenControl('ag1', true);
  assert.equal(isUserScreenControl('ag1'), true);
  const locked = wrapComputerInput(computer, { agent: { ...semi, id: 'ag1' }, allowed: ['computer_click'] });
  assert.equal(await locked.click({ x: 0, y: 0 }), USER_CONTROL_MSG);
  setUserScreenControl('ag1', false);
});

test('digitação: timeout cresce com o texto; blocos; idempotência não duplica', async () => {
  assert.equal(typeTimeoutMs(2000), 29_000);
  assert.ok(typeTimeoutMs(100) < 15_000);
  const parts = splitTypeText('a'.repeat(900), 400);
  assert.ok(parts.length >= 3);
  assert.equal(parts.join('').length, 900);

  _resetComputerInputForTests();
  let n = 0;
  const first = await withTypeIdempotency('c1', 'hello', async () => { n++; return 'ok'; });
  const second = await withTypeIdempotency('c1', 'hello', async () => { n++; return 'dup'; });
  assert.equal(first, 'ok');
  assert.match(second, /já digitado/);
  assert.equal(n, 1);

  await assert.rejects(withTypeIdempotency('c1', 'boom', async () => { throw new Error('timeout'); }), /timeout/);
  const retry = await withTypeIdempotency('c1', 'boom', async () => 'again');
  assert.match(retry, /não vou repetir|Não vou repetir/i);
});

test('serializeCall: um comando por vez no mesmo contêiner', async () => {
  _resetComputerInputForTests();
  const order = [];
  const a = serializeCall('box', async () => {
    order.push('a-start');
    await new Promise(r => setTimeout(r, 20));
    order.push('a-end');
    return 'A';
  });
  const b = serializeCall('box', async () => {
    order.push('b-start');
    return 'B';
  });
  assert.deepEqual(await Promise.all([a, b]), ['A', 'B']);
  assert.deepEqual(order, ['a-start', 'a-end', 'b-start']);
});
