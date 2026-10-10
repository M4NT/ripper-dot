import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SKILL = readFileSync(new URL('../skills/token-the-ripper.md', import.meta.url), 'utf8');

test('token-the-ripper mantém regras operacionais (pt-BR, Caixa, fonte, Omie)', () => {
  assert.match(SKILL, /português do Brasil/);
  assert.match(SKILL, /ask_owner/);
  assert.match(SKILL, /gov\.br/);
  assert.match(SKILL, /omie_\*/);
});

test('token-the-ripper pede resposta natural e proporcional, sem corte cego nem formulário obrigatório', () => {
  assert.match(SKILL, /Raciocine quando isso ajuda/);
  assert.match(SKILL, /econômico, não telegráfico/i);
  assert.match(SKILL, /profundidade/);
  assert.match(SKILL, /sem rodapé vazio/);
  assert.doesNotMatch(SKILL, /Corte sem dó/);
  assert.doesNotMatch(SKILL, /só com "\?" ou "explique"/);
  assert.doesNotMatch(SKILL, /mesmo que a última seja só "Nada\."/);
  assert.doesNotMatch(SKILL, /Feche sempre com estas três linhas/);
});
