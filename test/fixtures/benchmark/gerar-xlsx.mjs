// Gera os .xlsx das fixtures do benchmark sem dependências (zip "store" + XML mínimo do Excel).
//   node test/fixtures/benchmark/gerar-xlsx.mjs
import { writeFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';

function zip(files) {
  const local = [], central = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = Buffer.from(name), d = Buffer.from(text), crc = crc32(d);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(d.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    local.push(h, n, d); central.push(c, n); off += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(central.length / 2, 8); e.writeUInt16LE(central.length / 2, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, e]);
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const col = i => String.fromCharCode(65 + i);
function xlsx(rows) {
  const sheet = rows.map((r, y) => `<row r="${y + 1}">${r.map((v, x) => typeof v === 'number'
    ? `<c r="${col(x)}${y + 1}"><v>${v}</v></c>`
    : `<c r="${col(x)}${y + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('')}</row>`).join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Planilha1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`
  });
}

const here = new URL('./', import.meta.url);
// Totais: Ana 62.000, Bruno 41.500, Carla 50.000, Diego 75.800 → comissões 2.100 / 1.245 / 1.500 / 2.790.
writeFileSync(new URL('vendas_setembro.xlsx', here), xlsx([
  ['data', 'vendedor', 'cliente', 'valor'],
  ['03/09/2026', 'Ana', 'Mercado Bom Preço', 20000], ['05/09/2026', 'Bruno', 'Padaria Sol', 12000],
  ['08/09/2026', 'Carla', 'Hotel Vista Mar', 25000], ['09/09/2026', 'Diego', 'Atacadão Norte', 30000],
  ['12/09/2026', 'Ana', 'Restaurante Sabor da Terra', 15500], ['15/09/2026', 'Bruno', 'Loja Parceira', 18500],
  ['17/09/2026', 'Diego', 'Distribuidora Alfa', 22800], ['19/09/2026', 'Carla', 'Grupo Vértice', 25000],
  ['22/09/2026', 'Ana', 'Mercado Bom Preço', 26500], ['24/09/2026', 'Bruno', 'Café Central', 11000],
  ['29/09/2026', 'Diego', 'Atacadão Norte', 23000]
]));
// Igual ao extrato.csv, menos a tarifa de 12/09 (45,90) e o PIX da Padaria Sol de 19/09 (1.280,00).
writeFileSync(new URL('lancamentos.xlsx', here), xlsx([
  ['data', 'historico', 'valor'],
  ['02/09/2026', 'Venda Mercado Bom Preço', 3450], ['05/09/2026', 'Fornecedor Distribuidora Alfa', -2180],
  ['08/09/2026', 'Aluguel setembro', -4500], ['15/09/2026', 'Venda Restaurante Sabor da Terra', 2760],
  ['22/09/2026', 'DAS Simples Nacional', -2340.5], ['26/09/2026', 'Venda Hotel Vista Mar', 5900]
]));
