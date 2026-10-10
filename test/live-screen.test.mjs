// Tela ao vivo: quando abrir a aba, quando ligar a VM, Esc e o passo por cima.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeLiveTabOpen, doingLine, isLiveScreenTool, liveScreenAutoKey, liveScreenStep,
  shouldAutoConnect, shouldHandleLiveScreenEscape, shouldOpenLiveScreen, shouldRetryConnect
} from '../web/src/liveScreenLogic.js';

test('isLiveScreenTool: computador e navegador, mais nada', () => {
  assert.equal(isLiveScreenTool('computer_exec'), true);
  assert.equal(isLiveScreenTool('browser_open'), true);
  assert.equal(isLiveScreenTool('WebSearch'), false);
  assert.equal(isLiveScreenTool(''), false);
});

test('liveScreenStep: só computador/navegador deste agente; WebSearch e mensagem sua não entram', () => {
  assert.equal(liveScreenStep({ step: 'Clicando no botão' }), 'Clicando no botão');
  assert.equal(liveScreenStep({
    agentId: 'a1',
    messages: [{ agentId: 'a1', steps: [{ kind: 'tool', tool: 'browser_open', label: 'Abrindo página' }, { kind: 'tool', tool: 'WebSearch' }] }]
  }), 'Abrindo página');
  assert.equal(liveScreenStep({
    agentId: 'a1',
    messages: [{ role: 'user', steps: [{ kind: 'tool', tool: 'browser_open' }] }]
  }), null);
  assert.equal(liveScreenStep({
    agentId: 'a1',
    messages: [{ agentId: 'outro', steps: [{ kind: 'tool', tool: 'browser_open' }] }]
  }), null);
  assert.equal(liveScreenStep({ agentId: 'a1', busy: true }), 'Trabalhando…');
  assert.equal(liveScreenStep({
    agentId: 'a1',
    working: { a1: { tool: 'browser_click', task: 'Clicando no preço' } }
  }), 'Clicando no preço');
  assert.equal(liveScreenStep({
    agentId: 'a1',
    working: { a1: { tool: 'WebSearch', task: 'Pesquisando' } }
  }), null);
});

test('liveScreenAutoKey é estável no mesmo turno e some quando o turno acaba', () => {
  const ids = ['a1'];
  const busy = { a1: true };
  const a = liveScreenAutoKey({ messages: [{ agentId: 'a1', steps: [{ tool: 'computer_exec' }] }], busy, agentIds: ids });
  const b = liveScreenAutoKey({ messages: [{ agentId: 'a1', steps: [{ tool: 'computer_exec' }, { tool: 'browser_open' }] }], busy, agentIds: ids });
  assert.ok(a);
  assert.equal(a, b);
  assert.equal(liveScreenAutoKey({ messages: [{ agentId: 'a1', steps: [{ tool: 'computer_exec' }] }], busy: {}, agentIds: ids }), '');
  const w = liveScreenAutoKey({ working: { a1: { tool: 'browser_open', since: 10 } }, agentIds: ids });
  const w2 = liveScreenAutoKey({ working: { a1: { tool: 'browser_click', since: 10 } }, agentIds: ids });
  assert.equal(w, w2);
  assert.notEqual(w, liveScreenAutoKey({ working: { a1: { tool: 'browser_open', since: 99 } }, agentIds: ids }));
});

test('consumeLiveTabOpen: abre na 1ª vez do turno e não rouba a aba depois', () => {
  const first = consumeLiveTabOpen('', 'turn:a1:busy');
  assert.equal(first.open, true);
  assert.equal(consumeLiveTabOpen(first.openedKey, 'turn:a1:busy').open, false);
  const ended = consumeLiveTabOpen(first.openedKey, '');
  assert.equal(ended.open, false);
  assert.equal(ended.openedKey, '');
  assert.equal(consumeLiveTabOpen(ended.openedKey, 'turn:a1:busy').open, true);
});

test('shouldOpenLiveScreen: Docker + turno ao vivo; conversa antiga sem busy não abre', () => {
  const ids = ['a1'];
  const messages = [{ agentId: 'a1', steps: [{ kind: 'tool', tool: 'browser_open' }] }];
  assert.equal(shouldOpenLiveScreen({ mode: 'docker', messages, busy: { a1: true }, agentIds: ids }), true);
  assert.equal(shouldOpenLiveScreen({ mode: 'docker', messages, busy: {}, agentIds: ids }), false);
  assert.equal(shouldOpenLiveScreen({ mode: 'off', messages, busy: { a1: true }, agentIds: ids }), false);
});

test('shouldAutoConnect: só working/busy agora; histórico antigo não liga a VM', () => {
  assert.equal(shouldAutoConnect({ working: true }), true);
  assert.equal(shouldAutoConnect({ autoConnect: true }), true);
  assert.equal(shouldAutoConnect({ working: false, autoConnect: false }), false);
  assert.equal(shouldAutoConnect({}), false);
});

test('shouldRetryConnect: clique tenta de novo; automático não entra em loop após erro', () => {
  assert.equal(shouldRetryConnect({ live: true }), true);
  assert.equal(shouldRetryConnect({ live: true, err: 'caiu', alreadyTried: true }), false);
  assert.equal(shouldRetryConnect({ live: true, err: 'caiu', alreadyTried: true, fromUser: true }), true);
  assert.equal(shouldRetryConnect({ url: 'vnc', fromUser: true }), true);
  assert.equal(shouldRetryConnect({ url: 'vnc' }), false);
  assert.equal(shouldRetryConnect({ live: false }), false);
  assert.equal(shouldRetryConnect({ loading: true, fromUser: true }), false);
});

test('shouldHandleLiveScreenEscape: composer e menus não fecham a miniatura', () => {
  assert.equal(shouldHandleLiveScreenEscape({ key: 'Escape', big: true }), 'close-full');
  assert.equal(shouldHandleLiveScreenEscape({ key: 'Escape', float: true, focusInside: true }), 'close-float');
  assert.equal(shouldHandleLiveScreenEscape({ key: 'Escape', float: true, focusInside: false }), null);
  assert.equal(shouldHandleLiveScreenEscape({ key: 'Escape', float: true, big: false, focusInside: false }), null);
  assert.equal(shouldHandleLiveScreenEscape({ key: 'Enter', big: true }), null);
});

test('doingLine: o que o agente faz, há quanto tempo e para quem', () => {
  assert.equal(doingLine(null), null);
  assert.equal(doingLine({ task: 'Lendo a página', since: Date.now(), forName: 'você' }), 'Lendo a página · agora · para você');
});
