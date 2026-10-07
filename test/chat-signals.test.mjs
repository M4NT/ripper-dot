import test from 'node:test';
import assert from 'node:assert/strict';
import { seenLabel, stallLabel } from '../web/src/lib.js';

test('seenLabel: um, dois e vários agentes', () => {
  assert.equal(seenLabel([]), '');
  assert.equal(seenLabel(['Ripper']), 'Ripper viu');
  assert.equal(seenLabel(['Ripper', 'Donald']), 'Ripper e Donald viram');
  assert.equal(seenLabel(['A', 'B', 'C']), 'A, B e C viram');
});

test('stallLabel: só aparece a partir de 20 s', () => {
  assert.equal(stallLabel('Pensando', 19999), null);
  assert.equal(stallLabel('Pensando', 20000), 'ainda em: Pensando · 20 s');
  assert.equal(stallLabel('Rodando o build', 40500), 'ainda em: Rodando o build · 40 s');
  assert.equal(stallLabel('X', 185000), 'ainda em: X · 3 min');
});
