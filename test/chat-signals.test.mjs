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
  // o aviso diz o motivo provável (item 12) e o tempo
  assert.equal(stallLabel('Pensando', 20000), 'Pensando: pensando com calma · 20 s');
  assert.equal(stallLabel('Rodando o build', 40500), 'Rodando o build: o comando ainda está rodando · 40 s');
  assert.equal(stallLabel('X', 185000), 'X: ainda trabalhando · 3 min');
  assert.equal(stallLabel('Lendo página', 30000), 'Lendo página: esperando o site responder · 30 s');
  // imagem costuma levar 2–3 min: só avisa depois disso
  assert.equal(stallLabel('Gerando imagem com o ChatGPT', 150000, 200000), null);
  assert.match(stallLabel('Gerando imagem com o ChatGPT', 210000, 200000), /ainda trabalhando/);
});
