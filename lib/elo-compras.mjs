// Elo de compras: para cada NF-e recebida, liga o CT-e (frete), a conta a pagar no Omie (da NF e do frete),
// a NFS-e citada e o pedido de compra. buildChain é pura (sem rede, sem db). compras_fechar_elo só lê:
// as notas salvas (DF-e/NFS-e) e o Omie por leitura. O que não bate vira alerta ou gap, nunca chute.
import { z } from 'zod';
import { DfeError, dfeCompanies } from './dfe.mjs';
import { omieCall, omieCredentials, OMIE_SLUG_RE, pedidosCompraParam } from './omie.mjs';

export const ELO_TOOL_NAMES = ['compras_fechar_elo'];
const TOL = 0.01;          // "valor dentro de 0,01"
const MAX_PAGINAS = 20;    // teto de páginas por leitura do Omie
const MAX_CADASTROS = 300; // teto de fornecedores consultados (um ConsultarCliente cada)
const MAX_NOTAS = 200;

export const GAP = {
  semCte: 'sem CT-e',
  semConta: 'sem conta',
  semContaFrete: 'sem conta do frete',
  semDepartamento: 'sem departamento',
  semProjeto: 'sem projeto',
  refInconsistente: 'referência inconsistente',
  pedidoNaoEncontrado: 'pedido não encontrado'
};

const digits = s => String(s ?? '').replace(/\D/g, '');
/** Sem zeros à esquerda ("000145599" -> "145599"). Vazio continua vazio. */
const semZeros = s => digits(s).replace(/^0+(?=\d)/, '');
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
/** Chave de acesso de 44 dígitos: nNF/nCT ficam nas posições 25–33; CNPJ do emitente nas 6–19. */
const chNumero = chave => semZeros(String(chave).slice(25, 34));
const chCnpj = chave => String(chave).slice(6, 20);
const valorIgual = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) <= TOL + 1e-9;
const cnpjDoForn = (t, cad) => digits(cad[String(t.codigo_cliente_fornecedor)]);
const temProjeto = p => Number(p) > 0;

function indexarTitulos(titulos) {
  const porNumero = new Map();
  for (const t of titulos) {
    const k = semZeros(t.numero_documento_fiscal);
    if (!k) continue;
    if (!porNumero.has(k)) porNumero.set(k, []);
    porNumero.get(k).push(t);
  }
  return porNumero;
}

/** Forma do título no resultado (sem o objeto inteiro do Omie). */
const linkTitulo = (t, cad) => ({
  codigo: t.codigo_lancamento_omie ?? null,
  numero: semZeros(t.numero_documento_fiscal),
  fornecedorCnpj: cnpjDoForn(t, cad) || null,
  valor: Number(t.valor_documento),
  vencimento: t.data_vencimento ?? null,
  categoria: t.codigo_categoria ?? null
});

/**
 * Casa um documento (NF-e, CT-e ou NFS-e) com um título: mesmo número, fornecedor = CNPJ do documento e valor a 0,01.
 * Só o que bate inteiro vira vínculo; título com só o número igual vira alerta.
 */
function casarTitulo({ numero, cnpj, valor, porNumero, cad, rotulo }) {
  let achado = null;
  const warnings = [];
  for (const t of porNumero.get(numero) || []) {
    const fornOk = cnpjDoForn(t, cad) === cnpj;
    if (fornOk && valorIgual(t.valor_documento, valor)) {
      if (!achado) achado = t;
      else warnings.push(`${rotulo}: mais de um título bate, usei o código ${achado.codigo_lancamento_omie}`);
      continue;
    }
    const motivo = !fornOk ? 'mesmo número, fornecedor diferente' : 'mesmo número e fornecedor, valor diferente';
    warnings.push(`${rotulo}: ${motivo} (título ${t.codigo_lancamento_omie ?? '?'})`);
  }
  return { titulo: achado, warnings };
}

/** NFS-e (prestador = fornecedor) ligada ao título pelo número e pelo CNPJ do prestador. */
export function vincularNfse(s, { porNumero, cad }) {
  const numero = semZeros(s.numero);
  const cnpj = digits(s.prestadorCnpj);
  const r = casarTitulo({ numero, cnpj, valor: s.valor, porNumero, cad, rotulo: 'NFS-e' });
  return { chave: s.chave ?? null, numero, prestadorCnpj: cnpj || null, titulo: r.titulo ? linkTitulo(r.titulo, cad) : null, warnings: r.warnings };
}

/** Itens conferem se algum item do pedido tem código ou descrição igual a algum item da NF-e (texto normalizado). */
export function itensConferem(nItens = [], pItens = []) {
  const nf = new Set(nItens.flatMap(i => [i.cProd, i.xProd].filter(Boolean).map(norm)));
  return pItens.some(p => [p.codigo, p.descricao].filter(Boolean).map(norm).some(v => nf.has(v)));
}

/**
 * Monta o elo de cada NF-e (uma entrada por NF-e, na ordem recebida).
 * notas: NF-e (chNFe, vNF, itens, infCpl); cte: CT-e (chCTe, nCT, cnpjEmitente, vTPrest, chNFeTransportadas);
 * nfse: NFS-e (chave, numero, prestadorCnpj, valor); titulos: contas a pagar do Omie (formato da API);
 * pedidos: {numero, nCodFor, itens:[{codigo, descricao}]}; cadastroCnpjPorCodigo: código Omie -> CNPJ/CPF.
 */
export function buildChain({ notas = [], cte = [], nfse = [], titulos = [], pedidos = [], cadastroCnpjPorCodigo = {} } = {}) {
  const cad = cadastroCnpjPorCodigo;
  const porNumero = indexarTitulos(titulos);
  const cteDaChave = new Map();
  for (const c of cte) for (const k of c.chNFeTransportadas || []) if (!cteDaChave.has(k)) cteDaChave.set(k, c);
  const pedidoPorNumero = new Map(pedidos.map(p => [semZeros(p.numero), p]));

  return notas.filter(n => /^\d{44}$/.test(n.chNFe || '')).map(n => {
    const chave = n.chNFe;
    const nNF = chNumero(chave);
    const emit = chCnpj(chave);
    const gaps = [];
    const warnings = [];

    const c = cteDaChave.get(chave) || null;
    if (!c) gaps.push(GAP.semCte);

    const nf = casarTitulo({ numero: nNF, cnpj: emit, valor: n.vNF, porNumero, cad, rotulo: 'NF-e' });
    warnings.push(...nf.warnings);
    const fr = c ? casarTitulo({ numero: semZeros(c.nCT), cnpj: digits(c.cnpjEmitente), valor: c.vTPrest, porNumero, cad, rotulo: 'CT-e' }) : { titulo: null, warnings: [] };
    warnings.push(...fr.warnings);

    if (!nf.titulo && !fr.titulo) gaps.push(GAP.semConta);
    else if (c && !fr.titulo) gaps.push(GAP.semContaFrete);

    // Departamento e projeto: só do título (NF, ou do frete se a NF não tem conta). Nunca inventados.
    const origem = nf.titulo || fr.titulo;
    const departamentos = (origem?.distribuicao || []).map(d => ({ departamento: d.cCodDepartamento ?? null, percentual: d.nPerDepartamento ?? null }));
    const projeto = temProjeto(origem?.codigo_projeto) ? String(origem.codigo_projeto) : null;
    if (!departamentos.length) gaps.push(GAP.semDepartamento);
    if (!projeto) gaps.push(GAP.semProjeto);

    // Pedido: o do título, ou o citado nas informações complementares da NF-e. Aceito só se fornecedor e itens conferem.
    const citado = /pedido\D{0,12}(\d{1,10})/i.exec(n.infCpl || '')?.[1];
    const numPedido = semZeros(nf.titulo?.numero_pedido || fr.titulo?.numero_pedido || citado);
    let pedido = null;
    let pedidoCitado = null;
    if (numPedido) {
      const p = pedidoPorNumero.get(numPedido);
      if (!p) gaps.push(GAP.pedidoNaoEncontrado);
      else {
        const pCnpj = digits(cad[String(p.nCodFor)]);
        const itensOk = itensConferem(n.itens, p.itens);
        const motivos = [];
        if (pCnpj !== emit) motivos.push('fornecedor do pedido é outro');
        if (!itensOk) motivos.push(n.itens?.length ? 'itens não conferem' : 'NF-e sem itens para conferir');
        if (motivos.length) {
          gaps.push(GAP.refInconsistente);
          pedidoCitado = { numero: p.numero, motivos };
        } else {
          pedido = { numero: p.numero, fornecedorCnpj: pCnpj, itensConferidos: true };
        }
      }
    }

    // NFS-e: as que a NF-e cita pelo número e cujo prestador é o emitente.
    const citados = new Set([...(n.infCpl || '').matchAll(/\d+/g)].map(m => semZeros(m[0])));
    const nfsesNF = nfse
      .filter(s => semZeros(s.numero) && citados.has(semZeros(s.numero)) && digits(s.prestadorCnpj) === emit)
      .map(s => vincularNfse(s, { porNumero, cad }));
    for (const s of nfsesNF) warnings.push(...s.warnings);

    return {
      chNFe: chave,
      nNF,
      emitenteCnpj: emit,
      valor: n.vNF ?? null,
      emissao: n.dhEmi ?? null,
      cte: c ? { chCTe: c.chCTe, nCT: semZeros(c.nCT), transportadorCnpj: digits(c.cnpjEmitente) || null, valor: c.vTPrest ?? null } : null,
      titulo: nf.titulo ? linkTitulo(nf.titulo, cad) : null,
      tituloFrete: fr.titulo ? linkTitulo(fr.titulo, cad) : null,
      departamentos,
      projeto,
      pedido,
      pedidoCitado,
      nfse: nfsesNF.map(({ warnings: _w, ...rest }) => rest),
      gaps,
      warnings
    };
  });
}

/** Contagens do elo: quantas NF-e têm cada vínculo e quantas ficaram sem gap. */
export function resumirElo(chains) {
  const conta = f => chains.filter(f).length;
  return {
    notas: chains.length,
    comCte: conta(x => x.cte),
    comConta: conta(x => x.titulo || x.tituloFrete),
    comDepartamento: conta(x => x.departamentos.length),
    comProjeto: conta(x => x.projeto),
    comPedido: conta(x => x.pedido),
    comNfse: conta(x => x.nfse.length),
    completas: conta(x => !x.gaps.length),
    comGap: conta(x => x.gaps.length),
    alertas: chains.reduce((t, x) => t + x.warnings.length, 0)
  };
}

// ---------- leitura do Omie (paginada; resposta inteira, sem o corte de 20 KB do runner de leitura) ----------

const ddmmyyyy = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

async function lerTitulos(c, now = new Date()) {
  const ini = new Date(now.getTime() - 400 * 86400_000);
  const out = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const r = await c({ path: 'financas/contapagar/', call: 'ListarContasPagar', param: { pagina, registros_por_pagina: 500, filtrar_por_data_de: ddmmyyyy(ini), filtrar_por_data_ate: ddmmyyyy(now) } });
    out.push(...(r.conta_pagar_cadastro || []));
    if (pagina >= (r.total_de_paginas || 1)) break;
  }
  return out;
}

async function lerPedidos(c) {
  const base = pedidosCompraParam({ param: { nRegsPorPagina: 100 } });
  const out = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const r = await c({ path: 'produtos/pedidocompra/', call: 'PesquisarPedCompra', param: { ...base, nPagina: pagina } });
    for (const x of r.pedidos_pesquisa || []) {
      const h = x.cabecalho_consulta || {};
      out.push({ numero: h.cNumero, nCodFor: h.nCodFor, itens: (x.produtos_consulta || []).map(i => ({ codigo: i.cCodProd ?? i.cCodItem, descricao: i.cDescProd ?? i.cDescItem })) });
    }
    if (pagina >= (r.nTotalPaginas || 1)) break;
  }
  return out;
}

/** CNPJ/CPF de cada código de fornecedor usado pelos títulos e pedidos (um ConsultarCliente por código). */
async function lerCadastro(c, codigos) {
  const cad = {};
  for (const cod of [...new Set(codigos.filter(x => x != null).map(String))].slice(0, MAX_CADASTROS)) {
    const f = await c({ path: 'geral/clientes/', call: 'ConsultarCliente', param: { codigo_cliente_omie: +cod } }).catch(() => null);
    if (f?.cnpj_cpf) cad[cod] = f.cnpj_cpf;
  }
  return cad;
}

// ---------- ferramenta do agente (somente leitura) ----------

const EMP = z.string().regex(/^\d{14}$/).describe('CNPJ da empresa (14 dígitos) com certificado cadastrado (NF-e/NFS-e recebidas)');
export const ELO_TOOL_CATALOG = {
  compras_fechar_elo: {
    description: 'Fecha o elo de compras de uma empresa: NF-e recebida -> CT-e (frete) -> conta a pagar no Omie (NF e frete) -> departamento e projeto, com NFS-e citada e pedido de compra. Lista o que falta: sem CT-e, sem conta, sem departamento, sem projeto, referência inconsistente. Só leitura. Use as notas já baixadas (dfe_sincronizar / nfse_sincronizar antes).',
    inputSchema: {
      empresa: EMP,
      omie_empresa: z.string().regex(OMIE_SLUG_RE).describe('Slug da empresa no Omie, ex.: ecmach'),
      nNF: z.string().max(12).optional().describe('Número da NF-e para olhar só ela')
    }
  }
};

/**
 * Executor da ferramenta. getDb: banco atual; call(slug, opts): leitura Omie (padrão: omieCall com o cofre).
 * Nenhum caminho de escrita: só ListarContasPagar, PesquisarPedCompra e ConsultarCliente.
 */
/**
 * Monta o elo das NF-e salvas da empresa (todas, ou só a de nNF). Lê o Omie por leitura e não escreve nada.
 * Usado pela ferramenta do elo e pelo cartão de documento.
 */
export async function montarCadeias({ db, empresa, omie_empresa, nNF = null, call }) {
  const callOmie = call || ((slug, o) => omieCall(omieCredentials(slug), o));
  const c = o => callOmie(omie_empresa, o);
  const salvas = Object.values(db.dfe?.companies?.[empresa]?.notes || {});
  const notas = salvas.filter(n => /^\d{44}$/.test(n.chNFe || '') && (!nNF || chNumero(n.chNFe) === nNF));
  const cte = salvas.filter(n => n.chCTe);
  const nfse = Object.values(db.dfe?.nfse?.[empresa]?.notes || {});

  const titulos = await lerTitulos(c);
  const pedidos = await lerPedidos(c);
  const cadastro = await lerCadastro(c, [...titulos.map(t => t.codigo_cliente_fornecedor), ...pedidos.map(p => p.nCodFor)]);
  const chains = buildChain({ notas, cte, nfse, titulos, pedidos, cadastroCnpjPorCodigo: cadastro });
  return { notas, chains };
}

export { chNumero };

export function createEloRunner({ getDb, call } = {}) {
  return {
    async run(name, a = {}) {
      if (name !== 'compras_fechar_elo') throw new Error(`ferramenta do elo desconhecida: ${name}`);
      const db = getDb();
      if (!dfeCompanies(db).includes(a.empresa)) throw new DfeError(`A empresa ${a.empresa} não tem certificado cadastrado.`);
      const { notas, chains } = await montarCadeias({ db, empresa: a.empresa, omie_empresa: a.omie_empresa, nNF: a.nNF ? semZeros(a.nNF) : null, call });
      return JSON.stringify({
        empresa: a.empresa,
        omie: a.omie_empresa,
        resumo: resumirElo(chains),
        aviso: notas.length ? undefined : 'Nenhuma NF-e salva para esta empresa. Rode dfe_sincronizar antes.',
        notas: chains.slice(0, MAX_NOTAS)
      });
    }
  };
}
