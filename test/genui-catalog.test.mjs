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
  allowedGenuiFileIds,
  lockGenuiSettingIfChannel,
  rememberUiPart,
  findUiPart,
  findUiPartByProps,
  forgetUiParts,
  liveUiCount,
  mergeUiSteps,
  collectFenceParts,
  registerUiPart,
  fenceInAssistantMessages,
  detectMarkdownTableAbuse,
  genuiSafeToRepeat,
  isUiState,
  safeMediaUrl,
  safeHref,
  hrefHost,
  sanitizeGenuiProps,
  slimUiPart,
  htmlPreviewSrcdoc,
  HTML_PREVIEW_CSP
} from '../lib/genui.mjs';
import { GENUI_TOOL_CATALOG, buildGenuiTools, makeGenuiExecute } from '../lib/genui-tools.mjs';
import { listRipperBuiltinToolNames } from '../lib/ripper-builtin-tools.mjs';
import { SAFE_TO_REPEAT } from '../lib/chat-run.mjs';
import { normalizeMetricRoute } from '../lib/metrics.mjs';
import { splitChatVisual } from '../web/src/genui/split.js';

test('catálogo tem 14 componentes com schema, when/whenNot e fallback em texto', () => {
  assert.equal(GENUI_NAMES.length, 14);
  assert.ok(!GENUI_NAMES.includes('secure_form'));
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
  assert.doesNotMatch(p, /show_secure_form/);
  for (const name of GENUI_NAMES) assert.match(p, new RegExp(`show_${name}`));
});

test('JSON incremental fecha chaves e strings no streaming', () => {
  assert.deepEqual(parseIncrementalJson('{"a":1}'), { value: { a: 1 }, complete: true, state: 'input-available' });
  const mid = parseIncrementalJson('{"title":"Oi","opt');
  assert.equal(mid.complete, false);
  assert.equal(mid.state, 'input-streaming');
  assert.deepEqual(mid.value, { title: 'Oi' });
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

test('applyUiAction: aprovação sem sempre, pergunta, rascunho com corpo editado, setting aplica', () => {
  const approval = presentGenui({ component: 'approval', props: GENUI_CATALOG.approval.example }).part;
  assert.equal(applyUiAction(approval, { action: 'always' }).ok, false);
  const deny = applyUiAction(approval, { action: 'deny' });
  assert.equal(deny.part.state, 'denied');
  assert.equal(deny.userText, 'Neguei a ação.');
  assert.equal(applyUiAction(deny.part, { action: 'allow' }).ok, false);

  const q = presentGenui({ component: 'question', props: GENUI_CATALOG.question.example }).part;
  const empty = applyUiAction(q, { action: 'submit', payload: { selected: [] } });
  assert.equal(empty.ok, false);
  const pick = applyUiAction(q, { action: 'submit', payload: { selected: ['ana'] } });
  assert.equal(pick.userText, 'Escolhi: Ana Ltda');

  const draft = presentGenui({ component: 'draft_message', props: GENUI_CATALOG.draft_message.example }).part;
  const sent = applyUiAction(draft, { action: 'send', payload: { body: 'Texto que eu editei agora.' } });
  assert.equal(sent.ok, true);
  assert.match(sent.userText, /Texto que eu editei agora/);
  assert.equal(sent.part.props.body, 'Texto que eu editei agora.');
  assert.equal(applyUiAction(sent.part, { action: 'send', payload: { body: 'outra' } }).ok, false);

  const setting = presentGenui({ component: 'setting', props: { key: 'pulse.enabled', label: 'Ligar o modo Deus', description: 'phishing', proposed: true } }).part;
  assert.equal(setting.props.label, 'Resumo diário');
  assert.match(setting.props.description, /resumo do que os agentes/);
  const applied = applyUiAction(setting, { action: 'apply' });
  assert.equal(applied.ok, true);
  assert.deepEqual(applied.applySetting, { key: 'pulse.enabled', on: true, sensitive: false });
  assert.match(applied.userText, /Resumo diário/);
  assert.doesNotMatch(applied.userText, /modo Deus/);

  const unknown = presentGenui({ component: 'setting', props: { key: 'nao.existe', label: 'X', proposed: true } }).part;
  assert.equal(applyUiAction(unknown, { action: 'apply' }).ok, false);

  const sensitive = presentGenui({ component: 'setting', props: { key: 'computer.allowLocalCommands', label: 'X', proposed: true } }).part;
  assert.equal(sensitive.props.sensitive, true);
  assert.equal(sensitive.props.label, 'Comandos direto no seu computador');
  const wait = applyUiAction(sensitive, { action: 'apply' });
  assert.equal(wait.needsApproval, true);
  assert.deepEqual(wait.applySetting, { key: 'computer.allowLocalCommands', on: true, sensitive: true });
  assert.equal(wait.part.state, 'input-available');
  assert.equal(wait.part.props.pendingApproval, true);
  const confirmed = applyUiAction(sensitive, { action: 'apply', payload: { confirm: true } });
  assert.equal(confirmed.needsApproval, true);
  assert.equal(confirmed.continue, false);
  assert.equal(confirmed.part.state, 'input-available');

  const backupOff = presentGenui({ component: 'setting', props: { key: 'backup.enabled', label: 'X', proposed: false } }).part;
  assert.equal(backupOff.props.sensitive, true);
  assert.equal(applyUiAction(backupOff, { action: 'apply' }).needsApproval, true);
  const backupOn = presentGenui({ component: 'setting', props: { key: 'backup.enabled', label: 'X', proposed: true } }).part;
  assert.equal(backupOn.props.sensitive, false);
  assert.equal(applyUiAction(backupOn, { action: 'apply' }).applySetting.on, true);

  const channelPart = lockGenuiSettingIfChannel(backupOn, { channel: 'whatsapp' });
  assert.equal(channelPart.state, 'expired');
  assert.equal(channelPart.props.channelLocked, true);
  assert.equal(applyUiAction(channelPart, { action: 'apply' }).ok, false);

  const table = presentGenui({ component: 'data_table', props: GENUI_CATALOG.data_table.example }).part;
  assert.equal(applyUiAction(table, { action: 'submit' }).ok, false);
});

test('findUiPart no turno atual não grava no turno anterior; um clique; mapa limpa', () => {
  forgetUiParts('c1');
  const prev = { id: 'm0', role: 'assistant', steps: [] };
  const chat = { id: 'c1', messages: [prev] };
  const part = presentGenui({ component: 'question', props: GENUI_CATALOG.question.example, chatId: 'c1' }).part;
  rememberUiPart('c1', part);
  const found = findUiPart(chat, part.id);
  assert.equal(found.live, true);
  assert.equal(found.message, null);
  assert.equal(prev.steps.length, 0);
  const pick = applyUiAction(found.step, { action: 'submit', payload: { selected: ['ana'] } });
  Object.assign(found.step, pick.part);
  assert.equal(prev.steps.length, 0);
  assert.equal(found.step.state, 'answered');
  const again = applyUiAction(found.step, { action: 'submit', payload: { selected: ['me'] } });
  assert.equal(again.ok, false);
  const merged = mergeUiSteps([part, { ...part, state: 'input-available' }]);
  assert.equal(merged.filter(s => s.id === part.id).length, 1);
  assert.equal(merged[0].state, 'answered');
  chat.messages.push({ id: 'm1', role: 'assistant', steps: merged });
  forgetUiParts('c1');
  assert.equal(liveUiCount('c1'), 0);
  const after = findUiPart(chat, part.id);
  assert.equal(after.live, false);
  assert.equal(after.step.state, 'answered');
  assert.equal(prev.steps.length, 0);
});

test('cerca genui registra id no servidor e reusa o mesmo cartão', () => {
  forgetUiParts('c2');
  const chat = { id: 'c2', messages: [] };
  const fence = '{"component":"question","props":{"prompt":"Qual tom?","options":[{"id":"a","label":"Formal"},{"id":"b","label":"Leve"}]}}';
  const first = registerUiPart(chat, { fence });
  assert.equal(first.ok, true);
  assert.ok(first.part.id);
  const second = registerUiPart(chat, { fence });
  assert.equal(second.part.id, first.part.id);
  const collected = collectFenceParts('c2', `texto\n\`\`\`genui\n${fence}\n\`\`\``, chat);
  assert.equal(collected[0].id, first.part.id);
  const byProps = findUiPartByProps(chat, 'question', first.part.props);
  assert.equal(byProps.step.id, first.part.id);
  const withMsg = {
    id: 'c2',
    messages: [{ role: 'assistant', content: `texto\n\`\`\`genui\n${fence}\n\`\`\`` }]
  };
  assert.equal(fenceInAssistantMessages(withMsg, fence), true);
  assert.equal(fenceInAssistantMessages(withMsg, '{"component":"approval","props":{"title":"Apagar tudo"}}'), false);
  assert.equal(fenceInAssistantMessages({ id: 'c2', messages: [] }, fence), false);
  forgetUiParts('c2');
});

test('URLs de imagem e href: só data: raster ou /api/files/<id> da conversa; href http(s)/relativo', () => {
  assert.equal(safeMediaUrl('https://atacante.example/?d=segredo'), '');
  assert.equal(safeMediaUrl('javascript:alert(1)'), '');
  assert.equal(safeMediaUrl('//cdn.evil/x.png'), '');
  assert.equal(safeMediaUrl('/logo.png'), '');
  assert.equal(safeMediaUrl('/api/settings'), '');
  assert.equal(safeMediaUrl('/api/files/abc'), '/api/files/abc');
  assert.equal(safeMediaUrl('/api/files/../etc/passwd'), '');
  assert.equal(safeMediaUrl('/api/files/abc?x=1'), '');
  assert.ok(safeMediaUrl('data:image/png;base64,aaa=').startsWith('data:image/png'));
  assert.equal(safeMediaUrl('data:image/svg+xml;base64,PHN2Zz4='), '');
  const allowed = new Set(['mine']);
  assert.equal(safeMediaUrl('/api/files/mine', { allowedFileIds: allowed }), '/api/files/mine');
  assert.equal(safeMediaUrl('/api/files/other', { allowedFileIds: allowed }), '');
  const scope = allowedGenuiFileIds([
    { id: 'mine', chatId: 'c1' },
    { id: 'agentf', agentId: 'a1' },
    { id: 'team', team: true },
    { id: 'foreign', agentId: 'a2', chatId: 'c2' }
  ], { id: 'c1', agentId: 'a1' });
  assert.ok(scope.has('mine') && scope.has('agentf') && scope.has('team'));
  assert.equal(scope.has('foreign'), false);
  const stripped = sanitizeGenuiProps('media_gallery', {
    title: 'A',
    items: [{ src: '/api/files/foreign', name: 'x' }, { src: '/api/files/mine', name: 'ok' }]
  }, { allowedFileIds: scope });
  assert.equal(stripped.items[0].src, '');
  assert.equal(stripped.items[1].src, '/api/files/mine');
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('https://user:pass@evil.test/'), '');
  assert.equal(safeHref('https://docs.ripper.dev/x'), 'https://docs.ripper.dev/x');
  assert.equal(hrefHost('https://docs.ripper.dev/x'), 'docs.ripper.dev');
  const dirty = sanitizeGenuiProps('link_preview', {
    url: 'javascript:alert(1)',
    icon: 'https://atacante.example/i.png',
    title: 'X'
  });
  assert.equal(dirty.icon, undefined);
  assert.equal(dirty.url, undefined);
  const ok = sanitizeGenuiProps('media_gallery', {
    title: 'A',
    items: [{ src: 'https://evil/x.png', name: 'x' }, { src: '/api/files/a', name: 'ok' }]
  });
  assert.equal(ok.items[0].src, '');
  assert.equal(ok.items[1].src, '/api/files/a');
});

test('prévia HTML leva CSP própria e slimUiPart corta o HTML de 80 KB', () => {
  const html = `<script>alert(1)</script><p>${'x'.repeat(1000)}</p>`;
  const src = htmlPreviewSrcdoc(html);
  assert.match(src, /Content-Security-Policy/);
  assert.match(src, /script-src 'none'/);
  assert.equal(src.includes(HTML_PREVIEW_CSP), true);
  const part = presentGenui({ component: 'html_preview', props: { title: 'T', html: 'y'.repeat(20_000) } }).part;
  const slim = slimUiPart(part);
  assert.equal(slim.slim, true);
  assert.equal(slim.props.html, undefined);
  assert.equal(slim.props.bytes, 20_000);
  assert.ok(JSON.stringify(slim).length < 2000);
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
  assert.equal(normalizeMetricRoute('/api/chats/abc123xyz/ui-parts'), '/api/chats/:id/ui-parts');
});

test('ferramentas show_* só mostram o cartão (sem efeito colateral)', async () => {
  assert.ok(GENUI_TOOL_CATALOG.show_question.inputSchema.prompt);
  const shown = [];
  const tools = buildGenuiTools({ showUi: async (c, p) => { shown.push([c, p]); return 'ok'; } });
  assert.equal(tools.length, 14);
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
