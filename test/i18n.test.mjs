import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLocale,
  assertUiLocale,
  translateApiError,
  translateKey,
  fmtAgoLocalized,
  DEFAULT_LOCALE
} from '../lib/i18n.mjs';

test('normalizeLocale aceita aliases e cai no padrão', () => {
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(normalizeLocale('pt'), 'pt-BR');
  assert.equal(normalizeLocale(undefined), DEFAULT_LOCALE);
  assert.equal(normalizeLocale('fr'), DEFAULT_LOCALE);
});

test('assertUiLocale rejeita valor inválido', () => {
  assert.equal(assertUiLocale('en'), 'en');
  assert.throws(() => assertUiLocale('de'), /inválido/);
});

test('translateApiError só traduz erros mapeados em inglês', () => {
  assert.equal(translateApiError('Modelo padrão desconhecido.', 'pt-BR'), 'Modelo padrão desconhecido.');
  assert.equal(translateApiError('Modelo padrão desconhecido.', 'en'), 'Unknown default model.');
  assert.equal(translateApiError('Outro erro.', 'en'), 'Outro erro.');
});

test('translateKey interpola variáveis e usa fallback', () => {
  const primary = { hello: 'Olá {name}' };
  const fb = { hello: 'Hi {name}', onlyFb: 'x' };
  assert.equal(translateKey(primary, fb, 'hello', { name: 'Ana' }), 'Olá Ana');
  assert.equal(translateKey({}, fb, 'onlyFb'), 'x');
  assert.equal(translateKey({}, fb, 'missing'), 'missing');
});

test('fmtAgoLocalized respeita locale', () => {
  const now = Date.now();
  assert.equal(fmtAgoLocalized(now - 30_000, 'pt-BR'), 'agora');
  assert.equal(fmtAgoLocalized(now - 30_000, 'en'), 'now');
});
