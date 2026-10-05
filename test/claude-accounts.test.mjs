import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccounts, accountOrder, isLimitError, markExhausted, applyAccountEnv, limitResetAt, PRINCIPAL } from '../lib/claude-accounts.mjs';
import { explainError } from '../lib/human-errors.mjs';

test('limite da sessão (texto real do Claude Code): reconhece, lê o horário de volta e explica em português', () => {
  const msg = "You've hit your session limit · resets 5:20pm (America/Sao_Paulo)";
  const now = new Date(2026, 9, 5, 15, 0);
  assert.ok(isLimitError(msg));
  const at = new Date(limitResetAt(msg, now));
  assert.deepEqual([at.getDate(), at.getHours(), at.getMinutes()], [5, 17, 20]);
  assert.equal(new Date(limitResetAt('resets 9am', now)).getDate(), 6, 'horário que já passou = amanhã');
  assert.equal(limitResetAt('fetch failed', now), null);
  assert.equal(explainError(msg).title, 'A assinatura do Claude chegou ao limite.');
});

test('contas: id a partir do nome, sem duplicar nem sobrescrever a principal', () => {
  assert.deepEqual(normalizeAccounts([{ label: 'Teams da Empresa' }, { label: 'teams da empresa' }, { label: 'x', id: 'principal' }]), [{ id: 'teams-da-empresa', label: 'Teams da Empresa' }, { id: 'x', label: 'x' }]);
  assert.deepEqual(normalizeAccounts(undefined, [{ id: 'pro', label: 'Pro' }]), [{ id: 'pro', label: 'Pro' }], 'patch sem contas mantém as atuais');
});

test('ordem: conta do agente primeiro; troca automática pode ser desligada; conta no limite sai da fila', () => {
  const settings = { claude: { accounts: [{ id: 'teams', label: 'Teams' }], defaultAccount: 'teams' } };
  assert.equal(accountOrder(settings, {})[0], 'teams', 'padrão do Ripper');
  assert.equal(accountOrder(settings, { claudeAccount: PRINCIPAL })[0], PRINCIPAL, 'escolha do agente vence');
  assert.deepEqual(accountOrder({ claude: { ...settings.claude, autoSwitch: false } }, {}), ['teams']);
  markExhausted(PRINCIPAL);
  assert.ok(!accountOrder(settings, {}).includes(PRINCIPAL), 'principal no limite não entra como reserva');
});

test('limite da assinatura é reconhecido; conta extra usa CLAUDE_CONFIG_DIR, principal não', () => {
  assert.ok(isLimitError(new Error('Claude AI usage limit reached|1791230000')));
  assert.ok(isLimitError("You've hit your limit · resets 3pm"));
  assert.ok(!isLimitError(new Error('fetch failed')));
  assert.match(applyAccountEnv({}, 'teams').CLAUDE_CONFIG_DIR, /claude-accounts[\\/]teams$/);
  assert.equal(applyAccountEnv({ CLAUDE_CONFIG_DIR: 'x' }, PRINCIPAL).CLAUDE_CONFIG_DIR, undefined);
});
