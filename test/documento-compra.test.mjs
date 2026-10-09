// Cartão de documento de compra (item 22): etiquetas, dados do cartão, ferramenta e decisão. Sem rede: Omie falso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.RIPPER_DATA = mkdtempSync(join(tmpdir(), 'ripper-documento-'));
process.env.RIPPER_VAULT_KEY = 'documento-test-vault-key';

const { buildChain, GAP } = await import('../lib/elo-compras.mjs');
const {
  DOCUMENTO_TOOL_NAMES, PRAZO_CIENCIA_MS, etiquetasDoDocumento, cardDoDocumento, createDocumentoRunner,
  estadoDocumento, pedirAprovacaoDocumento, rejeitarDocumento
} = await import('../lib/documento-compra.mjs');
const { DfeError } = await import('../lib/dfe.mjs');
const { RIPPER_TOOL_CATALOG } = await import('../lib/ripper-builtin-tools.mjs');
const { isToolAllowedByAutonomy } = await import('../lib/autonomy.mjs');

// Dados sintéticos (mesma linha do teste do elo): empresa compradora, fornecedor de produto e transportadora.
const EMPRESA = '11222333000181';
const FORN_PROD = '11444777000161';
const TRANSP = '22333444000155';
const COD = { prod: 1001, transp: 900001 };
const CAD = { [COD.prod]: FORN_PROD, [COD.transp]: TRANSP };
const chave = ({ cnpj, numero, mod = '55' }) => ['35', '2609', cnpj, mod, '001', String(numero).padStart(9, '0'), '1', '12345678', '0'].join('');
const CHAVE_NF = chave({ cnpj: FORN_PROD, numero: 500 });
const CHAVE_CTE = chave({ cnpj: TRANSP, numero: 77, mod: '57' });
const EMISSAO = '2026-09-10T09:00:00-03:00';
const nota = o => ({ chNFe: CHAVE_NF, xNome: 'ACO SUL LTDA', cnpjEmitente: FORN_PROD, vNF: 2000, dhEmi: EMISSAO, itens: [], infCpl: '', ciencia: true, ...o });
const cte = o => ({ chCTe: CHAVE_CTE, nCT: '145599', cnpjEmitente: TRANSP, vTPrest: 397.62, chNFeTransportadas: [CHAVE_NF], ...o });
const titulo = o => ({
  codigo_lancamento_omie: 5001, codigo_cliente_fornecedor: COD.prod, numero_documento_fiscal: '000000500',
  valor_documento: 2000, data_vencimento: '15/10/2026', codigo_categoria: '2.01.02', codigo_projeto: 11065220294,
  numero_pedido: '', distribuicao: [{ cCodDepartamento: 'ECM-0130_25', nPerDepartamento: 100 }], ...o
});
const CAGORA = Date.parse('2026-09-12T12:00:00-03:00'); // dentro do prazo da ciência

/** Cadeia com CT-e ligado e conta da NF-e; o frete fica sem conta própria (gap "sem conta do frete"). */
function cadeiaCompleta(notaO = nota()) {
  const [c] = buildChain({ notas: [notaO], cte: [cte()], titulos: [titulo()], cadastroCnpjPorCodigo: CAD });
  return c;
}

test('etiquetas: sem problema e com ciência feita mostram só "completo"', () => {
  assert.deepEqual(etiquetasDoDocumento({ gaps: [], nota: nota(), agora: CAGORA }), [{ texto: 'completo', nivel: 'ok' }]);
});

test('etiquetas: cada gap do elo vira uma etiqueta; o CT-e ainda pode chegar, então diz "por enquanto"', () => {
  const t = etiquetasDoDocumento({ gaps: [GAP.semCte, GAP.semDepartamento], nota: nota(), agora: CAGORA });
  assert.deepEqual(t, [
    { texto: 'sem CT-e (por enquanto)', nivel: 'alerta' },
    { texto: 'sem departamento', nivel: 'alerta' }
  ]);
});

test('etiquetas: ciência pendente dentro do prazo mostra a data limite; depois do prazo, outra etiqueta', () => {
  const pendente = nota({ ciencia: false });
  const dentro = etiquetasDoDocumento({ gaps: [], nota: pendente, agora: CAGORA });
  assert.equal(dentro.length, 1);
  assert.equal(dentro[0].nivel, 'alerta');
  assert.match(dentro[0].texto, /^ciência pendente até \d{2}\/\d{2}$/);
  const fora = etiquetasDoDocumento({ gaps: [], nota: pendente, agora: Date.parse(EMISSAO) + PRAZO_CIENCIA_MS + 86400_000 });
  assert.deepEqual(fora, [{ texto: 'ciência fora do prazo', nivel: 'alerta' }]);
});

test('cartão: fornecedor, número, valor e etiquetas vêm da cadeia e da nota; detalhes ficam para "Ver detalhes"', () => {
  const card = cardDoDocumento({ nota: nota({ ciencia: false }), chain: cadeiaCompleta(nota({ ciencia: false })), empresa: EMPRESA, omie: 'ecmach', agora: CAGORA });
  assert.equal(card.numero, '500');
  assert.equal(card.valor, 2000);
  assert.deepEqual(card.fornecedor, { nome: 'ACO SUL LTDA', cnpj: FORN_PROD });
  assert.equal(card.detalhes.cte.nCT, '145599');
  assert.equal(card.detalhes.projeto, '11065220294');
  assert.ok(card.etiquetas.some(t => /^ciência pendente/.test(t.texto)));
  assert.equal(card.agora, undefined, 'o instante de geração não vai para o cartão');
});

test('ferramenta mostrar_documento: lê o elo, chama o cartão e não escreve nada no Omie', async () => {
  const db = { dfe: { certs: { [EMPRESA]: { cnpj: EMPRESA } }, companies: { [EMPRESA]: { notes: { [CHAVE_NF]: nota({ ciencia: true }), [CHAVE_CTE]: cte({ chNFe: undefined }) } } }, nfse: {} }, approvals: [] };
  const chamadas = [];
  const fake = async (slug, o) => {
    chamadas.push(o.call);
    assert.equal(slug, 'ecmach');
    if (o.call === 'ListarContasPagar') return { total_de_paginas: 1, conta_pagar_cadastro: [titulo()] };
    if (o.call === 'PesquisarPedCompra') return { nTotalPaginas: 1, pedidos_pesquisa: [] };
    if (o.call === 'ConsultarCliente') return { cnpj_cpf: CAD[o.param.codigo_cliente_omie] };
    throw new Error(`chamada inesperada: ${o.call}`);
  };
  const cartoes = [];
  const runner = createDocumentoRunner({ getDb: () => db, call: fake, onCard: c => cartoes.push(c) });
  const texto = await runner.run('mostrar_documento', { empresa: EMPRESA, omie_empresa: 'ecmach', chNFe: CHAVE_NF });
  assert.equal(cartoes.length, 1);
  assert.equal(cartoes[0].numero, '500');
  assert.match(texto, /cartão da NF-e nº 500 de ACO SUL LTDA/);
  assert.match(texto, /Não diga que aprovou/);
  assert.ok(chamadas.every(c => ['ListarContasPagar', 'PesquisarPedCompra', 'ConsultarCliente'].includes(c)), 'só leitura no Omie');
});

test('ferramenta mostrar_documento: recusa nota não salva e empresa sem certificado', async () => {
  const db = { dfe: { certs: { [EMPRESA]: { cnpj: EMPRESA } }, companies: { [EMPRESA]: { notes: {} } }, nfse: {} } };
  const runner = createDocumentoRunner({ getDb: () => db, call: async () => ({}) });
  await assert.rejects(runner.run('mostrar_documento', { empresa: EMPRESA, omie_empresa: 'ecmach', chNFe: CHAVE_NF }), err => err instanceof DfeError && /não está salva/.test(err.message));
  await assert.rejects(runner.run('mostrar_documento', { empresa: '99888777000166', omie_empresa: 'ecmach', chNFe: CHAVE_NF }), /não tem certificado/);
});

test('ferramenta registrada no catálogo, só leitura (liberada em modo somente leitura)', () => {
  assert.deepEqual(DOCUMENTO_TOOL_NAMES, ['mostrar_documento']);
  assert.match(RIPPER_TOOL_CATALOG.mostrar_documento.description, /Aprovar cria um pedido na Caixa/);
  assert.ok(isToolAllowedByAutonomy({ id: 'a', tools: [], autonomyLevel: 'read_only' }, 'mostrar_documento', {}));
});

// ---------- decisão ----------

const CARD = cardDoDocumento({ nota: nota({ ciencia: true }), chain: cadeiaCompleta(), empresa: EMPRESA, omie: 'ecmach', agora: CAGORA });
let seq = 0;
const novoId = () => `ap${++seq}`;

test('decisão: sem nada, o estado é "nenhum"', () => {
  assert.deepEqual(estadoDocumento({ approvals: [] }, EMPRESA, CHAVE_NF), { estado: 'nenhum' });
});

test('Aprovar cria um pedido na Caixa (kind documento, sem agente esperando) e não duplica', () => {
  const db = { approvals: [], documentos: {} };
  const e1 = pedirAprovacaoDocumento(db, { empresa: EMPRESA, chNFe: CHAVE_NF, card: CARD, novoId, now: CAGORA });
  assert.equal(e1.estado, 'aguardando');
  assert.equal(db.approvals.length, 1);
  assert.equal(db.approvals[0].kind, 'documento');
  assert.equal(db.approvals[0].status, 'pending');
  assert.match(db.approvals[0].command, /NF-e nº 500 de ACO SUL LTDA/);
  assert.match(db.approvals[0].reason, /Nada é lançado no Omie/);
  const e2 = pedirAprovacaoDocumento(db, { empresa: EMPRESA, chNFe: CHAVE_NF, card: CARD, novoId, now: CAGORA });
  assert.equal(e2.estado, 'aguardando');
  assert.equal(db.approvals.length, 1, 'clicar de novo não cria outro pedido');
});

test('decisão da Caixa vira o estado do cartão: aprovado ou rejeitado; expirado quando o prazo passa', () => {
  const db = { approvals: [], documentos: {} };
  const { approvalId } = pedirAprovacaoDocumento(db, { empresa: EMPRESA, chNFe: CHAVE_NF, card: CARD, novoId, now: CAGORA });
  db.approvals[0].status = 'approved';
  assert.equal(estadoDocumento(db, EMPRESA, CHAVE_NF).estado, 'aprovado');
  assert.equal(estadoDocumento(db, EMPRESA, CHAVE_NF).approvalId, approvalId);
  db.approvals[0].status = 'denied';
  assert.equal(estadoDocumento(db, EMPRESA, CHAVE_NF).estado, 'rejeitado');
  db.approvals[0].status = 'expired';
  assert.equal(estadoDocumento(db, EMPRESA, CHAVE_NF).estado, 'expirado');
});

test('Rejeitar sem pedido: só registra; não cria nada na Caixa', () => {
  const db = { approvals: [], documentos: {} };
  const r = rejeitarDocumento(db, { empresa: EMPRESA, chNFe: CHAVE_NF, now: CAGORA });
  assert.equal(r.estado.estado, 'rejeitado');
  assert.equal(r.cancelado, null);
  assert.equal(db.approvals.length, 0, 'não cria pedido nem aviso na Caixa');
});

test('Rejeitar com pedido aberto cancela o pedido e não deixa duas decisões', () => {
  const db = { approvals: [], documentos: {} };
  pedirAprovacaoDocumento(db, { empresa: EMPRESA, chNFe: CHAVE_NF, card: CARD, novoId, now: CAGORA });
  const r = rejeitarDocumento(db, { empresa: EMPRESA, chNFe: CHAVE_NF, now: CAGORA });
  assert.equal(r.estado.estado, 'rejeitado');
  assert.equal(r.cancelado.status, 'cancelled');
  assert.equal(db.approvals.length, 1);
});

test('depois de rejeitado, Aprovar de novo abre outro pedido; depois de aprovado, Rejeitar é recusado', () => {
  const db = { approvals: [], documentos: {} };
  rejeitarDocumento(db, { empresa: EMPRESA, chNFe: CHAVE_NF, now: CAGORA });
  const e = pedirAprovacaoDocumento(db, { empresa: EMPRESA, chNFe: CHAVE_NF, card: CARD, novoId, now: CAGORA });
  assert.equal(e.estado, 'aguardando');
  db.approvals[0].status = 'approved';
  assert.throws(() => rejeitarDocumento(db, { empresa: EMPRESA, chNFe: CHAVE_NF, now: CAGORA }), /já foi aprovado/);
});
