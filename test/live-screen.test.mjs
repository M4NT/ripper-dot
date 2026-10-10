// Tela ao vivo unificada: quando abrir, qual passo mostrar, e o contrato do componente.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { doingLine, isLiveScreenTool, liveScreenAutoKey, liveScreenStep, shouldOpenLiveScreen } from '../web/src/liveScreenLogic.js';

const src = readFileSync(fileURLToPath(new URL('../web/src/chatPanel.jsx', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../web/src/styles.css', import.meta.url)), 'utf8');

test('isLiveScreenTool: computador e navegador, mais nada', () => {
  assert.equal(isLiveScreenTool('computer_exec'), true);
  assert.equal(isLiveScreenTool('computer_screenshot'), true);
  assert.equal(isLiveScreenTool('browser_open'), true);
  assert.equal(isLiveScreenTool('browser_click'), true);
  assert.equal(isLiveScreenTool('WebSearch'), false);
  assert.equal(isLiveScreenTool('shell'), false);
  assert.equal(isLiveScreenTool(''), false);
});

test('liveScreenStep: passo explícito, mensagem ao vivo, working e ocupado', () => {
  assert.equal(liveScreenStep({ step: 'Clicando no botão' }), 'Clicando no botão');
  assert.equal(liveScreenStep({
    agentId: 'a1',
    messages: [{ agentId: 'a1', steps: [{ kind: 'tool', tool: 'browser_open', label: 'Abrindo página' }] }]
  }), 'Abrindo página');
  assert.equal(liveScreenStep({
    agentId: 'a1',
    messages: [{ agentId: 'a1', steps: [{ kind: 'tool', tool: 'computer_exec' }] }]
  }), 'Rodando no computador');
  assert.equal(liveScreenStep({
    agentId: 'a1',
    working: { a1: { task: 'Preenchendo o formulário' } }
  }), 'Preenchendo o formulário');
  assert.equal(liveScreenStep({ agentId: 'a1', busy: true }), 'Trabalhando…');
  assert.equal(liveScreenStep({
    agentId: 'a1',
    messages: [{ agentId: 'outro', steps: [{ kind: 'tool', tool: 'browser_open' }] }]
  }), null);
});

test('shouldOpenLiveScreen: só Docker, só quando usa computador ou navegador agora', () => {
  const ids = ['a1'];
  const busy = { a1: true };
  const messages = [{ agentId: 'a1', steps: [{ kind: 'tool', tool: 'computer_exec' }] }];
  assert.equal(shouldOpenLiveScreen({ mode: 'docker', messages, busy, agentIds: ids }), true);
  assert.equal(shouldOpenLiveScreen({ mode: 'off', messages, busy, agentIds: ids }), false);
  assert.equal(shouldOpenLiveScreen({ mode: 'docker', messages, busy: {}, agentIds: ids }), false);
  assert.equal(shouldOpenLiveScreen({
    mode: 'docker', messages: [{ agentId: 'a1', steps: [{ kind: 'tool', tool: 'WebSearch' }] }], busy, agentIds: ids
  }), false);
  assert.equal(shouldOpenLiveScreen({
    mode: 'docker', working: { a1: { tool: 'browser_open', since: 1 } }, agentIds: ids
  }), true);
});

test('liveScreenAutoKey muda quando entra um passo novo de tela', () => {
  const ids = ['a1'];
  const busy = { a1: true };
  const a = liveScreenAutoKey({ messages: [{ agentId: 'a1', steps: [{ tool: 'computer_exec' }] }], busy, agentIds: ids });
  const b = liveScreenAutoKey({ messages: [{ agentId: 'a1', steps: [{ tool: 'computer_exec' }, { tool: 'browser_open' }] }], busy, agentIds: ids });
  assert.ok(a);
  assert.ok(b);
  assert.notEqual(a, b);
  assert.equal(liveScreenAutoKey({ messages: [{ agentId: 'a1', steps: [{ tool: 'computer_exec' }] }], busy: {}, agentIds: ids }), '');
});

test('doingLine: o que o agente faz, há quanto tempo e para quem', () => {
  assert.equal(doingLine(null), null);
  assert.equal(doingLine({ task: 'Lendo a página', since: Date.now(), forName: 'você' }), 'Lendo a página · agora · para você');
});

test('um componente só: MiniScreen reusa AgentLiveScreen e há um único /vnc', () => {
  assert.match(src, /function AgentLiveScreen\(/);
  assert.match(src, /export function MiniScreen\(props\) \{\s*return <AgentLiveScreen \{\.\.\.props\} variant="float" \/>;/);
  assert.equal([...src.matchAll(/\/api\/agents\/\$\{agent\.id\}\/vnc/g)].length, 1);
  assert.doesNotMatch(src, /function LiveScreen\(/);
  assert.match(src, /liveScreenAutoKey\(/);
  assert.match(src, /setTab\('computer'\)/);
  assert.match(src, /className="live-screen-step"/);
});

test('CSS da tela ao vivo: 375, 1280, 1440 e tokens dos dois temas', () => {
  assert.match(css, /@media \(max-width: 400px\)/);
  assert.match(css, /@media \(min-width: 1280px\)/);
  assert.match(css, /@media \(min-width: 1440px\)/);
  assert.match(css, /\.live-screen-step/);
  assert.match(css, /var\(--term-texto\)/);
  assert.match(css, /var\(--ok\)/);
  assert.match(css, /var\(--surface\)/);
  assert.match(css, /var\(--shadow-3\)/);
});
