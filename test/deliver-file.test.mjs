import test from 'node:test';
import assert from 'node:assert/strict';
import { vmPathToData, mimeOf, inlineType } from '../lib/deliver-file.mjs';

test('caminho da VM vira caminho do Ripper; fuga é recusada', () => {
  assert.equal(vmPathToData('/shared/eleicoes.docx', 'a1'), 'shared/eleicoes.docx');
  assert.equal(vmPathToData('/work/out/vendas.xlsx', 'a1'), 'sandbox/a1/out/vendas.xlsx');
  assert.equal(vmPathToData('relatorio.pdf', 'a1'), 'sandbox/a1/relatorio.pdf');
  assert.equal(vmPathToData('/work/../../db.json', 'a1'), null);
  assert.equal(vmPathToData('../segredo', 'a1'), null);
  assert.equal(vmPathToData('/etc/passwd', 'a1'), null);
  assert.equal(vmPathToData('', 'a1'), null);
});

test('tipo por extensão; só tipos seguros abrem na aba (HTML/SVG como texto)', () => {
  assert.match(mimeOf('a.docx'), /wordprocessingml/);
  assert.equal(inlineType(mimeOf('a.pdf')), 'application/pdf');
  assert.equal(inlineType(mimeOf('a.html')), 'text/plain; charset=utf-8');
  assert.equal(inlineType(mimeOf('a.docx')), null);
});
