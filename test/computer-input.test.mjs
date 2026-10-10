import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INPUT_DENIED,
  USER_CONTROL_MSG,
  USER_CONTROL_TTL_MS,
  _resetComputerInputForTests,
  computerInputLabel,
  computerInputNeedsApproval,
  computerInputRememberKey,
  displayQueueKey,
  isDangerousKeys,
  isUserScreenControl,
  parseKeys,
  serializeCall,
  serializeDisplay,
  setUserScreenControl,
  splitTypeText,
  typeContainsSubmit,
  typeTimeoutMs,
  userScreenControlState,
  withTypeIdempotency,
  wrapComputerInput,
  wrapDisplaySession
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

test('cartão de digitação mostra o texto mascarado e não deixa lembrar type+Return', () => {
  const label = computerInputLabel('type', { text: 'Use a chave sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV' });
  assert.match(label, /Digitar na tela da VM/);
  assert.match(label, /••••/);
  assert.ok(!label.includes('sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV'));

  const withReturn = computerInputNeedsApproval({
    kind: 'type', input: { text: 'rm -rf /\n' }, agent: semi, allowed: ['computer_type']
  });
  assert.equal(typeContainsSubmit('rm -rf /\n'), true);
  assert.equal(withReturn.ok, undefined);
  assert.match(withReturn.reason, /aprovação/);
  assert.equal(withReturn.rememberable, false);
  assert.equal(withReturn.rememberKey, null);
  assert.match(withReturn.command, /\+ Return/);
  assert.match(withReturn.command, /rm -rf \//);

  const ret = computerInputNeedsApproval({
    kind: 'key', input: { keys: 'Return' }, agent: semi, allowed: ['computer_type', 'computer_key']
  });
  assert.equal(ret.rememberable, false);
  assert.equal(ret.rememberKey, null);
  assert.match(ret.reason, /aprovação/);
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

  const typeAsk = [];
  const typed = wrapComputerInput(computer, {
    agent: semi,
    allowed: [],
    ask: async (command, _r, key, meta) => {
      typeAsk.push({ command, key, rememberable: meta?.rememberable });
      return false;
    }
  });
  await typed.type({ text: 'senha: SuperSegredo99\n' });
  assert.equal(typeAsk[0].rememberable, false);
  assert.match(typeAsk[0].command, /••••/);

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

  setUserScreenControl('ag1', true, 'live');
  assert.equal(isUserScreenControl('ag1'), true);
  const locked = wrapComputerInput(computer, { agent: { ...semi, id: 'ag1' }, allowed: ['computer_click'] });
  assert.equal(await locked.click({ x: 0, y: 0 }), USER_CONTROL_MSG);
  setUserScreenControl('ag1', false, 'live');
});

test('digitação: timeout cresce com o texto; blocos; idempotência por id da requisição', async () => {
  assert.equal(typeTimeoutMs(2000), 29_000);
  assert.ok(typeTimeoutMs(100) < 15_000);
  const parts = splitTypeText('a'.repeat(900), 400);
  assert.ok(parts.length >= 3);
  assert.equal(parts.join('').length, 900);

  _resetComputerInputForTests();
  let n = 0;
  const first = await withTypeIdempotency('c1', 'req-1', async ({ markTyped }) => { markTyped(); n++; return 'ok'; });
  const second = await withTypeIdempotency('c1', 'req-1', async ({ markTyped }) => { markTyped(); n++; return 'dup'; });
  assert.equal(first, 'ok');
  assert.match(second, /já digitado/);
  assert.equal(n, 1);

  const otherId = await withTypeIdempotency('c1', 'req-2', async ({ markTyped }) => { markTyped(); n++; return 'novo'; });
  assert.equal(otherId, 'novo');
  assert.equal(n, 2, 'mesmo texto com outro id de requisição pode digitar de novo');

  await assert.rejects(withTypeIdempotency('c1', 'req-fail', async () => { throw new Error('xdotool ausente'); }), /ausente/);
  const retry = await withTypeIdempotency('c1', 'req-fail', async ({ markTyped }) => { markTyped(); return 'again'; });
  assert.equal(retry, 'again', 'falha antes de digitar não bloqueia retry do mesmo id');

  await assert.rejects(withTypeIdempotency('c1', 'req-mid', async ({ markTyped }) => {
    markTyped();
    throw new Error('timeout');
  }), /timeout/);
  const mid = await withTypeIdempotency('c1', 'req-mid', async () => 'again');
  assert.match(mid, /não vou repetir|Não vou repetir/i);
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

test('trava Assumir controle: dono, expiração e MiniScreen não solta a de outro', () => {
  _resetComputerInputForTests();
  const t0 = 1_000_000;
  const live = setUserScreenControl('ag1', true, 'live-1', t0);
  assert.equal(live.control, true);
  assert.equal(live.owner, 'live-1');
  assert.equal(isUserScreenControl('ag1', t0 + 1), true);

  const miniClose = setUserScreenControl('ag1', false, 'mini-2', t0 + 10);
  assert.equal(miniClose.control, true, 'fechar MiniScreen não solta a trava do LiveScreen');
  assert.equal(miniClose.owner, 'live-1');

  const steal = setUserScreenControl('ag1', true, 'mini-2', t0 + 20);
  assert.equal(steal.conflict, true);
  assert.equal(steal.owner, 'live-1');

  const expired = userScreenControlState('ag1', t0 + USER_CONTROL_TTL_MS + 1);
  assert.equal(expired.control, false, 'aba fechada (sem heartbeat) libera o agente');
  assert.equal(isUserScreenControl('ag1', t0 + USER_CONTROL_TTL_MS + 1), false);

  const again = setUserScreenControl('ag1', true, 'mini-2', t0 + USER_CONTROL_TTL_MS + 2);
  assert.equal(again.owner, 'mini-2');
  assert.equal(setUserScreenControl('ag1', false, 'mini-2', t0 + USER_CONTROL_TTL_MS + 3).control, false);
});

test('fila comum por display e trava valem para browser_*', async () => {
  _resetComputerInputForTests();
  const order = [];
  const a = serializeDisplay('ag1', async () => {
    order.push('xdo');
    await new Promise(r => setTimeout(r, 20));
    return 'xdo';
  });
  const b = serializeDisplay('ag1', async () => {
    order.push('browser');
    return 'browser';
  });
  assert.equal(displayQueueKey('ag1'), 'display:ag1');
  assert.deepEqual(await Promise.all([a, b]), ['xdo', 'browser']);
  assert.deepEqual(order, ['xdo', 'browser']);

  setUserScreenControl('ag1', true, 'live');
  const browser = wrapDisplaySession({
    open: async () => 'opened',
    click: async () => 'clicked',
    type: async () => 'typed',
    scroll: async () => 'scrolled',
    read: async () => 'read'
  }, 'ag1');
  assert.equal(await browser.open('https://x'), USER_CONTROL_MSG);
  assert.equal(await browser.click('ok'), USER_CONTROL_MSG);
  assert.equal(await browser.type('q', 'oi'), USER_CONTROL_MSG);
  setUserScreenControl('ag1', false, 'live');
  assert.equal(await browser.read(), 'read');
});
