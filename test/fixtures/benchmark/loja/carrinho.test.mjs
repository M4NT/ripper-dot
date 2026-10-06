// Rodar com: node --test carrinho.test.mjs (na mesma pasta de carrinho.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import { total } from './carrinho.mjs';

test('soma itens sem cupom', () => {
  assert.equal(total([{ preco: 50, qtd: 2 }, { preco: 19.9, qtd: 1 }]), 119.9);
});

test('aplica cupom de 10%', () => {
  assert.equal(total([{ preco: 100, qtd: 2 }], 10), 180);
});
