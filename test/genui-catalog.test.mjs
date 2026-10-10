import test from 'node:test';
import assert from 'node:assert/strict';
import { GENUI_CATALOG, GENUI_NAMES, GENUI_TOOL_NAMES, genuiEntry, componentFromTool, isGenuiTool } from '../lib/genui-catalog.mjs';
import {
  validateGenui,
  genuiToText,
  describeGenuiTool,
  genuiStepLabel,
  genuiSystemPrompt,
  closePartialJson,
  parseIncrementalJson,
  parseGenuiFence,
  presentGenui,
  applyUiAction,
  rememberUiPart,
  findUiPart,
  detectMarkdownTableAbuse,
  genuiSafeToRepeat,
  isUiState
} from '../lib/genui.mjs';
import { GENUI_TOOL_CATALOG, buildGenuiTools, makeGenuiExecute } from '../lib/genui-tools.mjs';
import { listRipperBuiltinToolNames } from '../lib/ripper-builtin-tools.mjs';
import { SAFE_TO_REPEAT } from '../lib/chat-run.mjs';
import { normalizeMetricRoute } from '../lib/metrics.mjs';
import { splitChatVisual } from '../web/src/genui/split.js';

test('catálogo tem 15 componentes com schema, when/whenNot e fallback em texto', () => {
  assert.equal(GENUI_NAMES.length, 15);
  assert.deepEqual(GENUI_TOOL_NAMES, GENUI_NAMES.map(n => `show_${n}`));
  for (const name of GENUI_NAMES) {
    const e = genuiEntry(name);
    assert.ok(e.schema, name);
    assert.ok(e.when, name);
    assert.ok(e.whenNot, name);
    assert.equal(typeof e.toText, 'function', name);
    assert.ok(e.example, name);
    const check = validateGenui(name, e.example);
    assert.equal(check.ok, true, `${name}: ${check.error}`);
    const text = genuiToText(name, e.example);
    assert.ok(text.length > 0, name);
    if (name !== 'data_table') assert.equal(detectMarkdownTableAbuse(text), false, name);
  }
});

test('validação rejeita desconhecido e aceita parcial no streaming', () => {
  assert.equal(validateGenui('nao_existe', {}).ok, false);
  const partial = validateGenui('question', { prompt: 'Qual?' }, { partial: true });
  assert.equal(partial.ok, true);
  const full = validateGenui('question', { prompt: 'Qual?' });
  assert.equal(full.ok, false);
  assert.match(full.error, /options/);
});

test('prompt do sistema é gerado do catálogo e não diverge dos nomes', () => {
  const p = genuiSystemPrompt();
  assert.match(p, /show_data_table/);
  assert.match(p, /Nunca escreva tabela markdown com 3\+ linhas/);
  for (const name of GENUI_NAMES) assert.match(p, new RegExp(`show_${name}`));
});

test('JSON incremental fecha chaves e strings no streaming', () => {
  assert.deepEqual(parseIncrementalJson('{"a":1}'), { value: { a: 1 }, complete: true, state: 'input-available' });
  const mid = parseIncrementalJson('{"title":"Oi","opt');
  assert.equal(mid.complete, false);
  assert.equal(mid.state, 'input-streaming');
  assert.ok(mid.value);
  const closed = closePartialJson('{"rows":[{"dia":');
  assert.equal(closed.ok, true);
  assert.ok(closed.value.rows);
});

test('cerca ```genui aceita JSON {component,props} e nome + props', () => {
  const a = parseGenuiFence(JSON.stringify({ component: 'file_card', props: { name: 'a.csv' } }));
  assert.equal(a.ok, true);
  assert.equal(a.part.component, 'file_card');
  const b = parseGenuiFence('question\n{"prompt":"Qual?","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}');
  assert.equal(b.ok, true);
  assert.equal(b.part.component, 'question');
  const live = parseGenuiFence('{"component":"progress","props":{"title":"X","steps":[{"title":"Um","status":"running"', { live: true });
  assert.equal(live.part?.state, 'input-streaming');
});

test('presentGenui marca erro e devolve texto quando as props falham', () => {
  const bad = presentGenui({ component: 'approval', props: {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.part.state, 'output-error');
  assert.ok(bad.text);
  const unknown = presentGenui({ component: 'xyz', props: { a: 1 } });
  assert.equal(unknown.fallback, true);
});

test('applyUiAction: aprovação, pergunta, formulário sem valores e cartão já respondido', () => {
  const approval = presentGenui({ component: 'approval', props: GENUI_CATALOG.approval.example }).part;
  const deny = applyUiAction(approval, { action: 'deny' });
  assert.equal(deny.part.state, 'denied');
  assert.equal(deny.userText, 'Neguei a ação.');
  assert.equal(applyUiAction(deny.part, { action: 'allow' }).ok, false);

  const q = presentGenui({ component: 'question', props: GENUI_CATALOG.question.example }).part;
  const empty = applyUiAction(q, { action: 'submit', payload: { selected: [] } });
  assert.equal(empty.ok, false);
  const pick = applyUiAction(q, { action: 'submit', payload: { selected: ['ana'] } });
  assert.equal(pick.userText, 'Escolhi: Ana Ltda');

  const form = presentGenui({ component: 'secure_form', props: GENUI_CATALOG.secure_form.example }).part;
  const sent = applyUiAction(form, { action: 'submit', payload: { values: { user: 'ana@loja.com', pass: 'segredo' } } });
  assert.equal(sent.ok, true);
  assert.doesNotMatch(JSON.stringify(sent), /segredo/);
  assert.equal(sent.part.payload.count, 2);
  assert.match(sent.userText, /2 campos/);

  const table = presentGenui({ component: 'data_table', props: GENUI_CATALOG.data_table.example }).part;
  assert.equal(applyUiAction(table, { action: 'submit' }).ok, false);
});

test('rememberUiPart encontra o cartão antes da mensagem persistir', () => {
  const part = presentGenui({ component: 'slides', props: GENUI_CATALOG.slides.example, chatId: 'c1' }).part;
  rememberUiPart('c1', part);
  const found = findUiPart({ id: 'c1', messages: [] }, part.id);
  assert.equal(found.step.id, part.id);
  const choose = applyUiAction(found.step, { action: 'choose', payload: { id: 'limpo' } });
  assert.equal(choose.userText, 'Escolhi o visual "Limpo".');
});

test('nomes, rótulos e retomada segura acompanham o catálogo', () => {
  assert.equal(isGenuiTool('show_question'), true);
  assert.equal(isGenuiTool('mcp__ripper__show_chart'), true);
  assert.equal(componentFromTool('mcp__ripper__show_pr_card'), 'pr_card');
  assert.equal(describeGenuiTool('show_question', { prompt: 'Qual?' }).detail, 'Qual?');
  assert.equal(genuiStepLabel('show_approval'), 'Mostrando aprovação');
  assert.ok(isUiState('input-available'));
  for (const n of GENUI_TOOL_NAMES) assert.ok(SAFE_TO_REPEAT.has(n), n);
  assert.deepEqual(genuiSafeToRepeat().sort(), GENUI_TOOL_NAMES.slice().sort());
  const names = listRipperBuiltinToolNames({ tools: [], autonomyLevel: 'read_only' }, {});
  for (const n of GENUI_TOOL_NAMES) assert.ok(names.includes(n), n);
  assert.equal(normalizeMetricRoute('/api/chats/abc123xyz/ui-actions'), '/api/chats/:id/ui-actions');
});

test('ferramentas show_* só mostram o cartão (sem efeito colateral)', async () => {
  assert.ok(GENUI_TOOL_CATALOG.show_question.inputSchema.prompt);
  const shown = [];
  const tools = buildGenuiTools({ showUi: async (c, p) => { shown.push([c, p]); return 'ok'; } });
  assert.equal(tools.length, 15);
  await tools.find(t => t.name === 'show_file_card').execute({ name: 'a.csv' });
  assert.deepEqual(shown, [['file_card', { name: 'a.csv' }]]);
  const offline = makeGenuiExecute('show_link_preview', {});
  const out = await offline({ url: 'https://exemplo.com', title: 'Ex' });
  assert.match(out.content[0].text, /shown/);
});

test('splitChatVisual separa markdown, openui e genui (inclusive bloco aberto)', () => {
  const parts = splitChatVisual('oi\n```genui\n{"component":"file_card","props":{"name":"a.csv"}}\n```\nfim');
  assert.equal(parts[0].t, 'md');
  assert.equal(parts[1].t, 'genui');
  assert.equal(parts[2].t, 'md');
  const live = splitChatVisual('```openui\n<div');
  assert.equal(live[0].t, 'openui');
  assert.equal(live[0].open, true);
});
