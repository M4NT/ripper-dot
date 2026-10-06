import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { fileText } from '../lib/attachments.mjs';

// zip mínimo (deflate, crc 0: o leitor não confere) para montar xlsx/docx de teste
function zip(files) {
  const locals = [], central = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text)), n = Buffer.from(name);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(8, 8); l.writeUInt32LE(data.length, 18); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    locals.push(l, n, data); central.push(c, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(central.length / 2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}

test('xlsx vira CSV por aba (texto compartilhado, número, célula pulada)', () => {
  const buf = zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Vendas" sheetId="1"/></sheets></workbook>',
    'xl/sharedStrings.xml': '<sst><si><t>Produto</t></si><si><t>Café, 1kg</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Qtd</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="C2"><v>12</v></c></row></sheetData></worksheet>'
  });
  assert.equal(fileText('v.xlsx', buf), '# Aba: Vendas\nProduto,Qtd\n"Café, 1kg",,12');
});

test('docx vira parágrafos; binário desconhecido é null; csv passa direto', () => {
  const buf = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Olá &amp; bem-vindo</w:t></w:r></w:p><w:p><w:r><w:t>Fim</w:t></w:r></w:p></w:body></w:document>' });
  assert.equal(fileText('a.docx', buf), 'Olá & bem-vindo\nFim');
  assert.equal(fileText('a.bin', Buffer.from([1, 2])), null);
  assert.equal(fileText('a.csv', Buffer.from('a,b')), 'a,b');
});
