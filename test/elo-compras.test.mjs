// Elo de compras (NF-e -> CT-e -> conta a pagar -> pedido, e NFS-e). Dados 100% sintéticos; nenhuma chamada ao Omie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.RIPPER_DATA = mkdtempSync(join(tmpdir(), 'ripper-elo-'));
process.env.RIPPER_VAULT_KEY = 'elo-test-vault-key';

const { buildChain, createEloRunner, resumirElo, vincularNfse, itensConferem, GAP, ELO_TOOL_NAMES } = await import('../lib/elo-compras.mjs');
const { extractNota } = await import('../lib/dfe.mjs');
const { buildRipperBuiltinTools, RIPPER_TOOL_CATALOG } = await import('../lib/ripper-builtin-tools.mjs');
const { isToolAllowedByAutonomy } = await import('../lib/autonomy.mjs');

// Sintéticos: a empresa compradora, dois fornecedores (produto e transportadora) e um prestador de serviço.
const EMPRESA = '11222333000181';
const FORN_PROD = '11444777000161';   // emitente da NF-e de produto (código Omie 1001)
const FORN_OUTRO = '99888777000166';  // outro fornecedor (código Omie 1002)
const TRANSP = '22333444000155';      // transportadora (código Omie 900001)
const PREST = '33444555000122';       // prestador de serviço (código Omie 800)
const COD = { prod: 1001, outro: 1002, transp: 900001, prest: 800, pedOutro: 700 };
const CAD = { [COD.prod]: FORN_PROD, [COD.outro]: FORN_OUTRO, [COD.transp]: TRANSP, [COD.prest]: PREST, [COD.pedOutro]: FORN_OUTRO };

/** Chave de acesso sintética de 44 dígitos: cUF(2) AAMM(4) CNPJ(14) mod(2) série(3) nº(9) tpEmis(1) cNF(8) DV(1). */
const chave = ({ cnpj, numero, mod = '55' }) => ['35', '2609', cnpj, mod, '001', String(numero).padStart(9, '0'), '1', '12345678', '0'].join('');
const CHAVE_NF = chave({ cnpj: FORN_PROD, numero: 500 });
const CHAVE_NF11 = chave({ cnpj: FORN_PROD, numero: 11 });
const CHAVE_CTE = chave({ cnpj: TRANSP, numero: 77, mod: '57' });

const nota = o => ({ chNFe: CHAVE_NF, vNF: 2000, dhEmi: '2026-09-10T09:00:00-03:00', itens: [{ cProd: 'P1', xProd: 'CHAPA DE AÇO' }], infCpl: '', ...o });
const cteDoc = o => ({ chCTe: CHAVE_CTE, nCT: '145599', cnpjEmitente: TRANSP, vTPrest: 397.62, chNFeTransportadas: [CHAVE_NF], ...o });
/** Título do Omie no formato da API (campos usados pelo elo). */
const titulo = o => ({
  codigo_lancamento_omie: 5001, codigo_cliente_fornecedor: COD.transp, numero_documento_fiscal: '000145599',
  valor_documento: 397.62, data_vencimento: '15/01/2026', codigo_categoria: '2.01.02', codigo_projeto: 11065220294,
  numero_pedido: '', distribuicao: [{ cCodDepartamento: 'ECM-0130_25', nPerDepartamento: 100 }], ...o
});
const pedido = o => ({ numero: '440', nCodFor: COD.outro, itens: [{ codigo: 'Y9', descricao: 'CABO FLEXIVEL' }], ...o });

// ---------- caso 1: frete totalmente ligado ----------

test('frete ligado: NF-e -> CT-e (pela chave) -> conta do frete -> departamento e projeto, sem gap', () => {
  const [c] = buildChain({ notas: [nota()], cte: [cteDoc()], titulos: [titulo()], cadastroCnpjPorCodigo: CAD });
  assert.equal(c.cte.chCTe, CHAVE_CTE);
  assert.equal(c.cte.nCT, '145599', 'número do CT-e sem zeros à esquerda');
  assert.equal(c.tituloFrete.codigo, 5001);
  assert.equal(c.titulo, null, 'a NF-e não tem conta própria: a conta é a do frete');
  assert.deepEqual(c.departamentos, [{ departamento: 'ECM-0130_25', percentual: 100 }]);
  assert.equal(c.projeto, '11065220294');
  assert.deepEqual(c.gaps, []);
  assert.deepEqual(c.warnings, []);
});

test('frete: CT-e que não transporta esta NF-e não liga', () => {
  const [c] = buildChain({ notas: [nota()], cte: [cteDoc({ chNFeTransportadas: [CHAVE_NF11] })], titulos: [titulo()], cadastroCnpjPorCodigo: CAD });
  assert.equal(c.cte, null);
  assert.ok(c.gaps.includes(GAP.semCte));
});

// ---------- caso 2: NF 11 com lacunas ----------

test('NF 11: sem CT-e, sem conta, sem departamento, sem projeto e pedido 440 de outro fornecedor = referência inconsistente', () => {
  const nf11 = nota({ chNFe: CHAVE_NF11, vNF: 1000, infCpl: 'Ref. Pedido de compra 440', itens: [{ cProd: 'X1', xProd: 'PARAFUSO M8' }] });
  const [c] = buildChain({ notas: [nf11], titulos: [titulo()], pedidos: [pedido()], cadastroCnpjPorCodigo: CAD });
  assert.equal(c.titulo, null);
  assert.equal(c.cte, null);
  assert.equal(c.pedido, null, 'referência não aceita');
  assert.deepEqual(c.pedidoCitado.motivos.sort(), ['fornecedor do pedido é outro', 'itens não conferem'].sort());
  assert.deepEqual(c.gaps.sort(), [GAP.semConta, GAP.semCte, GAP.semDepartamento, GAP.semProjeto, GAP.refInconsistente].sort());
});

// ---------- caso 3: mesmo número, fornecedor diferente = alerta, não vínculo ----------

test('mesmo número com fornecedor diferente vira alerta e não liga', () => {
  const doOutro = nota({ chNFe: chave({ cnpj: FORN_OUTRO, numero: 145599 }), vNF: 397.62 });
  const [c] = buildChain({ notas: [doOutro], titulos: [titulo()], cadastroCnpjPorCodigo: CAD });
  assert.equal(c.titulo, null);
  assert.ok(c.warnings.some(w => /mesmo número, fornecedor diferente/.test(w)), c.warnings.join(' | '));
  assert.ok(c.gaps.includes(GAP.semConta));
});

test('mesmo número e fornecedor com valor diferente: alerta, não vínculo', () => {
  const doMesmo = nota({ chNFe: chave({ cnpj: TRANSP, numero: 145599 }), vNF: 400 });
  const [c] = buildChain({ notas: [doMesmo], titulos: [titulo()], cadastroCnpjPorCodigo: CAD });
  assert.equal(c.titulo, null);
  assert.ok(c.warnings.some(w => /valor diferente/.test(w)));
});

// ---------- caso 4: pedido ----------

test('pedido citado: aceito só com fornecedor e itens conferindo', () => {
  const ok = nota({ infCpl: 'Pedido 440', itens: [{ cProd: 'Y9', xProd: 'CABO' }] });
  const [c] = buildChain({ notas: [ok], pedidos: [pedido({ nCodFor: COD.prod })], cadastroCnpjPorCodigo: CAD, titulos: [titulo({ numero_documento_fiscal: '500', codigo_cliente_fornecedor: COD.prod, valor_documento: 2000, codigo_projeto: 1, distribuicao: [{ cCodDepartamento: 'D1', nPerDepartamento: 100 }] })] });
  assert.equal(c.pedido.numero, '440');
  assert.equal(c.pedido.itensConferidos, true);
  assert.ok(!c.gaps.includes(GAP.refInconsistente));
});

test('pedido do título com itens que não conferem: referência inconsistente', () => {
  const [c] = buildChain({
    notas: [nota({ itens: [{ cProd: 'P1', xProd: 'CHAPA' }] })],
    pedidos: [pedido({ nCodFor: COD.prod })], cadastroCnpjPorCodigo: CAD,
    titulos: [titulo({ numero_documento_fiscal: '500', codigo_cliente_fornecedor: COD.prod, valor_documento: 2000, numero_pedido: '440' })]
  });
  assert.equal(c.pedido, null);
  assert.deepEqual(c.pedidoCitado.motivos, ['itens não conferem']);
  assert.ok(c.gaps.includes(GAP.refInconsistente));
});

test('pedido citado que não está na lista: pedido não encontrado', () => {
  const [c] = buildChain({ notas: [nota({ infCpl: 'pedido 9999' })], pedidos: [], cadastroCnpjPorCodigo: CAD });
  assert.ok(c.gaps.includes(GAP.pedidoNaoEncontrado));
});

test('itensConferem: basta um item do pedido igual a um da NF-e (texto normalizado)', () => {
  assert.equal(itensConferem([{ cProd: 'a', xProd: 'Cabo  flexível' }], [{ codigo: 'Z', descricao: 'CABO FLEXIVEL' }]), true);
  assert.equal(itensConferem([], [{ codigo: 'Z', descricao: 'CABO' }]), false, 'NF-e sem itens não confere');
});

// ---------- caso 5: NFS-e ----------

test('NFS-e liga ao título pelo número e pelo CNPJ do prestador, com valor a 0,01', () => {
  const s = { chave: '3'.repeat(50), numero: '1234', prestadorCnpj: PREST, valor: 1500.004 };
  const porNumero = new Map([['1234', [titulo({ numero_documento_fiscal: '1234', codigo_cliente_fornecedor: COD.prest, valor_documento: 1500 })]]]);
  const r = vincularNfse(s, { porNumero, cad: CAD });
  assert.equal(r.titulo.numero, '1234');
  assert.equal(r.titulo.fornecedorCnpj, PREST);
  assert.deepEqual(r.warnings, []);
});

test('NFS-e de outro prestador não liga, e aparece como alerta', () => {
  const s = { chave: '3'.repeat(50), numero: '1234', prestadorCnpj: FORN_OUTRO, valor: 1500 };
  const porNumero = new Map([['1234', [titulo({ numero_documento_fiscal: '1234', codigo_cliente_fornecedor: COD.prest, valor_documento: 1500 })]]]);
  const r = vincularNfse(s, { porNumero, cad: CAD });
  assert.equal(r.titulo, null);
  assert.ok(r.warnings.some(w => /NFS-e: mesmo número, fornecedor diferente/.test(w)));
});

test('NFS-e citada na NF-e (prestador = emitente) aparece no elo da NF-e', () => {
  const nfseDoc = { chave: '3'.repeat(50), numero: '1234', prestadorCnpj: FORN_PROD, valor: 1500 };
  const [c] = buildChain({ notas: [nota({ infCpl: 'Servico NFS-e 1234' })], nfse: [nfseDoc], cadastroCnpjPorCodigo: CAD });
  assert.equal(c.nfse.length, 1);
  assert.equal(c.nfse[0].numero, '1234');
});

// ---------- CT-e: detecção de layout ----------

const cteXml = `<?xml version="1.0"?><cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><CTe><infCte Id="CTe${CHAVE_CTE}" versao="4.00">`
  + `<ide><nCT>145599</nCT><dhEmi>2026-09-11T08:00:00-03:00</dhEmi></ide>`
  + `<emit><CNPJ>${TRANSP}</CNPJ><xNome>TRANSPORTADORA EXEMPLO LTDA</xNome></emit>`
  + `<infDoc><infNFe><chave>${CHAVE_NF}</chave></infNFe></infDoc>`
  + `<vPrest><vTPrest>397.62</vTPrest></vPrest></infCte></CTe></cteProc>`;

test('CT-e (procCTe/cteProc) é reconhecido: chave, nº, valor do frete e NF-e transportadas', () => {
  const n = extractNota(cteXml);
  assert.equal(n.schema, 'cteProc');
  assert.equal(n.chCTe, CHAVE_CTE);
  assert.equal(n.nCT, '145599');
  assert.equal(n.vTPrest, 397.62);
  assert.equal(n.cnpjEmitente, TRANSP);
  assert.deepEqual(n.chNFeTransportadas, [CHAVE_NF]);
  assert.equal(n.chNFe, null, 'CT-e não é NF-e');
});

test('procCTe e resCTe são reconhecidos; raiz desconhecida continua visível', () => {
  assert.equal(extractNota(cteXml.replace('cteProc', 'procCTe')).schema, 'procCTe');
  assert.equal(extractNota(`<resCTe xmlns="x"><chCTe>${CHAVE_CTE}</chCTe><CNPJ>${TRANSP}</CNPJ><xNome>TRANSP</xNome></resCTe>`).schema, 'resCTe');
  assert.equal(extractNota('<algoEstranho><x>1</x></algoEstranho>').schema, 'desconhecido:algoEstranho');
});

test('NF-e completa: itens e informação complementar (pedido citado) são guardados', () => {
  const xml = `<nfeProc xmlns="x"><NFe><infNFe Id="NFe${CHAVE_NF}"><emit><CNPJ>${FORN_PROD}</CNPJ><xNome>FORN</xNome></emit>`
    + `<det nItem="1"><prod><cProd>P1</cProd><xProd>CHAPA</xProd></prod></det><total><ICMSTot><vNF>2000.00</vNF></ICMSTot></total>`
    + `<infAdic><infCpl>Ref. Pedido 440</infCpl></infAdic></infNFe></NFe><protNFe/></nfeProc>`;
    const n = extractNota(xml);
  assert.equal(n.schema, 'nfeProc');
  assert.deepEqual(n.itens, [{ cProd: 'P1', xProd: 'CHAPA' }]);
  assert.equal(n.infCpl, 'Ref. Pedido 440');
});

// ---------- executor e registro (sem rede: Omie simulado) ----------

test('compras_fechar_elo: lê Omie paginado, monta o elo, só lê e fica registrado só com certificado + Omie', async () => {
  const db = { dfe: {
    certs: { [EMPRESA]: { cnpj: EMPRESA } },
    companies: { [EMPRESA]: { notes: {
      [CHAVE_NF]: nota(), [CHAVE_CTE]: cteDoc({ chNFe: undefined }),
    } } },
    nfse: {}
  } };
  const chamadas = [];
  const fake = async (slug, o) => {
    chamadas.push(`${slug}:${o.call}`);
    assert.equal(slug, 'ecmach');
    if (o.call === 'ListarContasPagar') {
      return o.param.pagina === 1
        ? { total_de_paginas: 2, conta_pagar_cadastro: [] }
        : { total_de_paginas: 2, conta_pagar_cadastro: [titulo()] };
    }
    if (o.call === 'PesquisarPedCompra') return { nTotalPaginas: 1, pedidos_pesquisa: [] };
    if (o.call === 'ConsultarCliente') return { cnpj_cpf: CAD[o.param.codigo_cliente_omie] };
    throw new Error(`chamada inesperada: ${o.call}`);
  };
  const runner = createEloRunner({ getDb: () => db, call: fake });
  const out = JSON.parse(await runner.run('compras_fechar_elo', { empresa: EMPRESA, omie_empresa: 'ecmach' }));
  assert.equal(out.resumo.notas, 1);
  assert.equal(out.resumo.comCte, 1);
  assert.equal(out.notas[0].tituloFrete.codigo, 5001, 'página 2 de títulos foi lida');
  assert.ok(chamadas.every(c => /ListarContasPagar|PesquisarPedCompra|ConsultarCliente$/.test(c.split(':')[1])), 'só leitura');
  assert.deepEqual(ELO_TOOL_NAMES, ['compras_fechar_elo']);
  assert.equal(RIPPER_TOOL_CATALOG.compras_fechar_elo.description.includes('Só leitura'), true);
  assert.ok(isToolAllowedByAutonomy({ id: 'a', tools: [], autonomyLevel: 'read_only' }, 'compras_fechar_elo', {}));
  await assert.rejects(runner.run('compras_fechar_elo', { empresa: '99888777000166', omie_empresa: 'ecmach' }), /não tem certificado/);
  await assert.rejects(runner.run('compras_gravar', {}), /desconhecida/);

  const names = ctx => buildRipperBuiltinTools({ id: 'a', tools: [], autonomyLevel: 'read_only' }, ctx).map(t => t.name);
  assert.ok(!names({ elo: null }).includes('compras_fechar_elo'), 'sem ctx.elo, não registra');
  assert.ok(names({ elo: runner }).includes('compras_fechar_elo'));
});

test('resumo conta vínculos e gaps', () => {
  const chains = buildChain({ notas: [nota(), nota({ chNFe: CHAVE_NF11, vNF: 1 })], cte: [cteDoc()], titulos: [titulo()], cadastroCnpjPorCodigo: CAD });
  const r = resumirElo(chains);
  assert.equal(r.notas, 2);
  assert.equal(r.comCte, 1);
  assert.equal(r.completas, 1);
  assert.equal(r.comGap, 1);
});
