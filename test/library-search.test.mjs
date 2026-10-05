import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchLibrary, snippet } from '../lib/library-search.mjs';

const items = [
  { kind: 'artifact', id: '1', title: 'Proposta comercial', text: 'Valor total de R$ 12.500 para a implantação.', at: 1 },
  { kind: 'file', id: '2', title: 'notas.md', text: 'Reunião sobre a PROPOSTA: revisar implantação e prazos.', at: 2 },
  { kind: 'memory', id: '3', title: 'Memória', text: 'Cliente prefere contato por WhatsApp.', at: 3 }
];

test('sem acento/maiúscula, todas as palavras, título pesa mais', () => {
  const r = searchLibrary(items, 'proposta implantacao');
  assert.deepEqual(r.map(x => x.id), ['1', '2'], 'título casando vem primeiro');
  assert.deepEqual(searchLibrary(items, 'whatsapp').map(x => x.id), ['3']);
  assert.deepEqual(searchLibrary(items, 'inexistente'), []);
  assert.deepEqual(searchLibrary(items, 'a'), [], 'palavra de 1 letra não busca');
});

test('trecho em volta da palavra, com reticências', () => {
  const long = 'x '.repeat(200) + 'palavra-chave aqui ' + 'y '.repeat(200);
  const s = snippet(long, ['palavra']);
  assert.match(s, /^….*palavra-chave.*…$/);
  assert.ok(s.length <= 165);
});
