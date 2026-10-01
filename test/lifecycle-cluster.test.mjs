import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberAllowedCommand, execNeedsApproval, builtinToolAllowed, MAX_ALLOWED_COMMANDS } from '../lib/permissions.mjs';
import { listChatsPage, encodeChatCursor, decodeChatCursor } from '../lib/history.mjs';
import { repairInboxOnStartup, markInboxDeliveryFailed, inboxSummary } from '../lib/inbox.mjs';
import { lastUserTurnIndex, labelMessageForAgent } from '../lib/agent-flow.mjs';
import { tryClaimRoutine, releaseRoutineClaim, _resetPersistCoordForTests } from '../lib/persist-coord.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('rememberAllowedCommand deduplica e limita tamanho', () => {
  const chat = { allowedCommands: [] };
  rememberAllowedCommand(chat, 'ls');
  rememberAllowedCommand(chat, 'ls');
  assert.deepEqual(chat.allowedCommands, ['ls']);
  chat.allowedCommands = Array.from({ length: MAX_ALLOWED_COMMANDS }, (_, i) => `c${i}`);
  rememberAllowedCommand(chat, 'novo');
  assert.equal(chat.allowedCommands.at(-1), 'novo');
  assert.equal(chat.allowedCommands.length, MAX_ALLOWED_COMMANDS);
});

test('execNeedsApproval usa lista persistida da conversa', () => {
  const chat = { allowedCommands: ['npm test'] };
  assert.equal(execNeedsApproval({ command: 'npm test', computerKind: 'docker', policy: 'always', chat }), null);
  assert.ok(execNeedsApproval({ command: 'rm -rf x', computerKind: 'docker', policy: 'risky', chat }));
});

test('builtinToolAllowed respeita tools do agente', () => {
  const agent = { tools: ['memory', 'web'] };
  assert.equal(builtinToolAllowed(agent, 'remember', {}), true);
  assert.equal(builtinToolAllowed(agent, 'schedule_routine', {}), false);
});

test('listChatsPage pagina de forma estável e não inventa chats', () => {
  const chats = [
    { id: 'b', title: 'Beta', createdAt: 1, updatedAt: 200, messages: [{ role: 'user', content: 'olá mundo' }] },
    { id: 'a', title: 'Alpha', createdAt: 1, updatedAt: 200, messages: [] },
    { id: 'c', title: 'Outro', createdAt: 1, updatedAt: 100, messages: [{ role: 'user', content: 'xyz' }] }
  ];
  const p1 = listChatsPage(chats, { limit: 2 });
  assert.equal(p1.total, 3);
  assert.equal(p1.items.length, 2);
  assert.ok(p1.nextCursor);
  const p2 = listChatsPage(chats, { limit: 2, cursor: p1.nextCursor });
  assert.equal(p2.items.length, 1);
  const found = listChatsPage(chats, { q: 'mundo' });
  assert.equal(found.total, 1);
  assert.equal(found.items[0].id, 'b');
  const cur = decodeChatCursor(encodeChatCursor(chats[0]));
  assert.equal(cur.id, 'b');
});

test('inbox repair e summary', () => {
  const msgs = [
    { id: '1', status: 'delivering' },
    { id: '2', status: 'failed', attempts: 1 },
    { id: '3', status: 'delivered' }
  ];
  repairInboxOnStartup(msgs);
  assert.equal(msgs[0].status, 'queued');
  assert.equal(msgs[1].status, 'queued');
  const m = { status: 'delivering', attempts: 0 };
  markInboxDeliveryFailed(m, 'x');
  assert.equal(m.status, 'queued');
  markInboxDeliveryFailed(m, 'y');
  markInboxDeliveryFailed(m, 'z');
  assert.equal(m.status, 'failed');
  assert.deepEqual(inboxSummary([{ status: 'queued' }, { status: 'failed' }]), { queued: 1, delivering: 0, delivered: 0, failed: 1 });
});

test('lastUserTurnIndex ignora mensagens de inbox', () => {
  const messages = [
    { role: 'user', content: 'pergunta real' },
    { role: 'assistant', content: 'ok', agentId: 'a' },
    { role: 'user', content: '[inbox]', inbox: { from: 'b' } }
  ];
  assert.equal(lastUserTurnIndex(messages), 0);
});

test('labelMessageForAgent rotula colega em grupo', () => {
  const m = { role: 'assistant', agentId: 'b', content: 'oi' };
  const out = labelMessageForAgent(m, 'a', () => 'Berta', { group: true });
  assert.match(out.content, /Berta disse/);
});

test('tryClaimRoutine evita dupla execução entre processos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-claim-'));
  const prev = process.env.RIPPER_DATA;
  process.env.RIPPER_DATA = dir;
  _resetPersistCoordForTests();
  assert.equal(tryClaimRoutine('r1'), true);
  assert.equal(tryClaimRoutine('r1'), false);
  releaseRoutineClaim('r1');
  assert.equal(tryClaimRoutine('r1'), true);
  _resetPersistCoordForTests();
  process.env.RIPPER_DATA = prev;
});
