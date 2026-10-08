import test from 'node:test';
import assert from 'node:assert/strict';
import { route } from '../lib/router.mjs';

// Sem Julia no ar (porta fechada) → heurística.
const settings = { julia: { url: 'http://127.0.0.1:9' }, models: {} };

test('conversa curta vai para o Haiku; pergunta normal não', async () => {
  assert.equal((await route('obrigado!', [], settings, { effort: 'low' })).model, 'claude-haiku-5-5');
  assert.equal((await route('ok', [], settings, { effort: 'low' })).model, 'claude-haiku-5-5');
  assert.notEqual((await route('ok, agora planeje a estratégia de vendas do trimestre', [], settings, { effort: 'low' })).model, 'claude-haiku-5-5');
});

