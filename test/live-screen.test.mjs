// Tela ao vivo: quando abrir a aba, quando ligar a VM, Esc e o passo por cima.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  consumeLiveTabOpen, currentTurnMessages, doingLine, isLiveScreenTool, liveScreenAutoKey, liveScreenCanControl,
  liveScreenStep, screenControlAfterGrab, screenControlIsMine, screenControlPayload, screenControlReleaseForOwner,
  shouldAutoConnect, shouldConnectThisTurn, shouldHandleLiveScreenEscape, shouldOpenLiveScreen,
  shouldReleaseControlOnCloseFull, shouldRetryConnect
} from '../web/src/liveScreenLogic.js';
import { LiveComputerTab, LiveScreenControl, liveScreenControlState } from '../web/src/liveScreenTab.js';

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

test('currentTurnMessages: só o que veio depois do último pedido seu', () => {
  const history = [
    { role: 'user', text: 'abre o site' },
    { agentId: 'a1', steps: [{ tool: 'browser_open' }] },
    { role: 'user', text: 'explica' },
    { agentId: 'a1', text: 'é assim' },
  ];
  assert.deepEqual(currentTurnMessages(history), [{ agentId: 'a1', text: 'é assim' }]);
  assert.deepEqual(currentTurnMessages([{ role: 'user', text: 'oi' }]), []);
});

test('liveScreenAutoKey só olha o turno atual; working não muda a chave', () => {
  const ids = ['a1'];
  const busy = { a1: true };
  const past = [
    { role: 'user', text: 'abre o site' },
    { agentId: 'a1', steps: [{ tool: 'browser_open' }] },
  ];
  const a = liveScreenAutoKey({ messages: past, busy, agentIds: ids });
  const b = liveScreenAutoKey({ messages: [...past.slice(0, 1), { agentId: 'a1', steps: [{ tool: 'computer_exec' }, { tool: 'browser_open' }] }], busy, agentIds: ids });
  assert.ok(a);
  assert.equal(a, b);
  assert.equal(a, 'turn:a1');
  assert.equal(liveScreenAutoKey({ messages: past, busy: {}, agentIds: ids }), '');

  const textTurn = [...past, { role: 'user', text: 'explica isso' }, { agentId: 'a1', text: 'é assim' }];
  assert.equal(liveScreenAutoKey({ messages: textTurn, busy, agentIds: ids }), '');
  assert.equal(shouldConnectThisTurn({ messages: textTurn, busy, agentId: 'a1' }), false);
  assert.equal(shouldConnectThisTurn({ messages: past, busy, agentId: 'a1' }), true);

  const busyOnly = liveScreenAutoKey({ messages: past, busy, agentIds: ids });
  const withWorking = liveScreenAutoKey({
    messages: past, busy, agentIds: ids,
    working: { a1: { tool: 'browser_open', since: 10 } },
  });
  const workingMoved = liveScreenAutoKey({
    messages: past, busy, agentIds: ids,
    working: { a1: { tool: 'browser_click', since: 99 } },
  });
  assert.equal(busyOnly, withWorking);
  assert.equal(withWorking, workingMoved);

  const w = liveScreenAutoKey({ working: { a1: { tool: 'browser_open', since: 10 } }, agentIds: ids });
  const w2 = liveScreenAutoKey({ working: { a1: { tool: 'browser_click', since: 10 } }, agentIds: ids });
  assert.equal(w, w2);
  assert.equal(w, liveScreenAutoKey({ working: { a1: { tool: 'browser_open', since: 99 } }, agentIds: ids }));
});

test('consumeLiveTabOpen: abre na 1ª vez do turno e working não abre de novo', () => {
  const ids = ['a1'];
  const busy = { a1: true };
  const messages = [{ role: 'user', text: 'abre' }, { agentId: 'a1', steps: [{ tool: 'browser_open' }] }];
  const firstKey = liveScreenAutoKey({ messages, busy, agentIds: ids });
  const first = consumeLiveTabOpen('', firstKey);
  assert.equal(first.open, true);
  assert.equal(consumeLiveTabOpen(first.openedKey, firstKey).open, false);
  const afterWorking = liveScreenAutoKey({
    messages, busy, agentIds: ids,
    working: { a1: { tool: 'browser_click', since: 50 } },
  });
  assert.equal(afterWorking, firstKey);
  assert.equal(consumeLiveTabOpen(first.openedKey, afterWorking).open, false);
  const ended = consumeLiveTabOpen(first.openedKey, '');
  assert.equal(ended.open, false);
  assert.equal(ended.openedKey, '');
  assert.equal(consumeLiveTabOpen(ended.openedKey, firstKey).open, true);
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

function renderLiveTab(props) {
  const html = renderToStaticMarkup(createElement(LiveComputerTab, props));
  return {
    html,
    tab: html.match(/data-live-tab="([^"]*)"/)?.[1],
    connect: html.match(/data-live-connect="([^"]*)"/)?.[1],
    key: html.match(/data-live-key="([^"]*)"/)?.[1],
    open: html.match(/data-live-open="([^"]*)"/)?.[1],
  };
}

test('render LiveComputerTab: histórico + texto não abre; working não reabre a aba', () => {
  const ids = ['a1'];
  const busy = { a1: true };
  const past = [
    { role: 'user', text: 'abre o site' },
    { agentId: 'a1', steps: [{ tool: 'browser_open' }] },
  ];

  const first = renderLiveTab({ mode: 'docker', messages: past, busy, agentIds: ids });
  assert.match(first.html, /<section/);
  assert.equal(first.tab, 'computer');
  assert.equal(first.connect, '1');
  assert.equal(first.open, '1');
  assert.equal(first.key, 'turn:a1');

  const afterWorking = renderLiveTab({
    mode: 'docker',
    messages: past,
    busy,
    working: { a1: { tool: 'browser_click', since: 50 } },
    agentIds: ids,
    tab: 'details',
    openedKey: first.key,
  });
  assert.equal(afterWorking.tab, 'details');
  assert.equal(afterWorking.open, '0');
  assert.equal(afterWorking.key, first.key);
  assert.equal(afterWorking.connect, '1');

  const textTurn = [...past, { role: 'user', text: 'explica isso' }, { agentId: 'a1', text: 'é assim' }];
  const later = renderLiveTab({ mode: 'docker', messages: textTurn, busy, agentIds: ids });
  assert.equal(later.tab, 'details');
  assert.equal(later.connect, '0');
  assert.equal(later.open, '0');
  assert.equal(later.key, '');
});

test('Assumir controle: dono no PUT; miniatura não solta a trava do painel', () => {
  assert.deepEqual(screenControlPayload(true, 'panel-1'), { control: true, owner: 'panel-1' });
  assert.equal(screenControlIsMine({ control: true, owner: 'panel-1' }, 'panel-1'), true);
  assert.equal(screenControlIsMine({ control: true, owner: 'panel-1' }, 'mini-2'), false);
  assert.equal(screenControlAfterGrab(true, { control: true, owner: 'panel-1', conflict: true }, 'mini-2'), false);
  assert.equal(screenControlAfterGrab(false, { control: true, owner: 'panel-1' }, 'mini-2'), false);
  assert.equal(screenControlReleaseForOwner('panel-1', 'mini-2'), false);
  assert.equal(screenControlReleaseForOwner('panel-1', 'panel-1'), true);
  assert.equal(shouldReleaseControlOnCloseFull('float'), true);
  assert.equal(shouldReleaseControlOnCloseFull('panel'), false);
  assert.equal(liveScreenCanControl({ variant: 'panel', control: true, big: false }), true);
  assert.equal(liveScreenCanControl({ variant: 'float', control: true, big: false }), false);
  assert.equal(liveScreenCanControl({ variant: 'float', control: true, big: true }), true);
});

function renderLiveControl(props) {
  const html = renderToStaticMarkup(createElement(LiveScreenControl, props));
  return {
    html,
    variant: html.match(/data-live-screen="([^"]*)"/)?.[1],
    can: html.match(/data-can-control="([^"]*)"/)?.[1],
    closeFull: html.match(/data-release-on-close-full="([^"]*)"/)?.[1],
    closeReleases: html.match(/data-close-releases="([^"]*)"/)?.[1],
  };
}

test('render AgentLiveScreen painel e miniatura: trava com donos separados', () => {
  const panel = liveScreenControlState({ variant: 'panel', control: true, owner: 'panel-1', lockOwner: 'panel-1' });
  assert.equal(panel.canControl, true);
  assert.equal(panel.releaseOnCloseFull, false);
  assert.equal(panel.closeReleasesLock, true);

  const miniWhilePanelHolds = liveScreenControlState({
    variant: 'float', control: true, big: true, owner: 'mini-2', lockOwner: 'panel-1',
  });
  assert.equal(miniWhilePanelHolds.canControl, false, 'miniatura não assume a trava do painel');
  assert.equal(miniWhilePanelHolds.closeReleasesLock, false, 'fechar miniatura não solta o painel');
  assert.equal(miniWhilePanelHolds.releaseOnCloseFull, true);

  const miniOwn = liveScreenControlState({
    variant: 'float', control: true, big: true, owner: 'mini-2', lockOwner: 'mini-2',
  });
  assert.equal(miniOwn.canControl, true);
  assert.equal(liveScreenControlState({
    variant: 'float', control: true, big: false, owner: 'mini-2', lockOwner: 'mini-2',
  }).canControl, false);

  const panelHtml = renderLiveControl({ variant: 'panel', control: true, owner: 'panel-1', lockOwner: 'panel-1' });
  assert.equal(panelHtml.variant, 'panel');
  assert.equal(panelHtml.can, '1');
  assert.equal(panelHtml.closeReleases, '1');

  const miniHtml = renderLiveControl({ variant: 'float', control: true, big: true, owner: 'mini-2', lockOwner: 'panel-1' });
  assert.equal(miniHtml.variant, 'float');
  assert.equal(miniHtml.can, '0');
  assert.equal(miniHtml.closeReleases, '0');
  assert.equal(miniHtml.closeFull, '1');
});
