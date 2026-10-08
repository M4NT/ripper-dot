// Omie ERP como integração nativa: a API do Omie direto, uma empresa por chave de aplicativo.
// Chave e segredo ficam no cofre cifrado (connection-vault), nunca em settings, logs ou respostas.
// Toda escrita passa por `approve` (Caixa), em qualquer nível de autonomia.
import { z } from 'zod';
import { getVaultCredential, putVaultCredential, deleteVaultCredential, vaultConfigured } from './connection-vault.mjs';

const API = () => process.env.OMIE_API_URL || 'https://app.omie.com.br/api/v1'; // override só para testes
export const OMIE_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,59}$/;
export const omieVaultKey = slug => `omie.${slug}`;

export class OmieError extends Error {}

const scrub = (text, c) => [c.appKey, c.appSecret].reduce((t, v) => (v ? t.split(v).join('••••') : t), String(text));

/**
 * Uma chamada à API Omie. REDUNDANT ("Consumo redundante… Aguarde N segundos") espera N s e tenta de novo.
 * O segredo nunca sai na mensagem de erro.
 */
export async function omieCall(creds, { path, call, param = {} }, { fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), maxTries = 4 } = {}) {
  const body = JSON.stringify({ call, app_key: creds.appKey, app_secret: creds.appSecret, param: [param] });
  for (let attempt = 1; ; attempt++) {
    const res = await fetchImpl(`${API()}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    if (res.ok && data && !data.faultstring) return data;
    const msg = scrub(data?.faultstring || text.slice(0, 200) || `HTTP ${res.status}`, creds);
    const wait = /aguarde\s+(\d+)\s+segundo/i.exec(msg);
    if (/redundante/i.test(msg) && attempt < maxTries) { await sleep((+wait?.[1] || 2) * 1000); continue; }
    throw new OmieError(msg);
  }
}

/** Botão "Testar conexão": leitura inofensiva (uma conta corrente). */
export async function omieTestConnection(creds, opts) {
  await omieCall(creds, { path: 'geral/contacorrente/', call: 'ListarContasCorrentes', param: { pagina: 1, registros_por_pagina: 1 } }, opts);
  return { ok: true };
}

/** Chave e segredo da empresa, do cofre. Lança erro se a empresa não tem chave. */
export function omieCredentials(slug) {
  if (!vaultConfigured()) throw new Error('Cofre não configurado: defina RIPPER_VAULT_KEY ou RIPPER_TOKEN.');
  const row = getVaultCredential(omieVaultKey(slug), { internal: true });
  if (!row?.auth?.apiKey || !row.auth.clientSecret) throw new Error(`Falta a chave da empresa ${slug} no Omie.`);
  return { appKey: row.auth.apiKey, appSecret: row.auth.clientSecret };
}

/** Empresas cadastradas com status "conectada" ou "falta chave". Não devolve segredo. */
export function omieCompanyList(settings) {
  return (settings?.omie?.companies || []).map(c => {
    let ok = true;
    try { omieCredentials(c.slug); } catch { ok = false; }
    return { slug: c.slug, status: ok ? 'conectada' : 'falta chave' };
  });
}

/** Adiciona ou troca a chave de uma empresa (vai para o cofre; em settings só fica o slug). */
export function omieAddCompany(settings, { slug, appKey, appSecret }) {
  slug = String(slug || '').trim().toLowerCase();
  if (!OMIE_SLUG_RE.test(slug)) throw new Error('Nome Omie inválido: use o nome da empresa no Omie, só letras minúsculas, números e hífen (ex.: ecmach).');
  if (!appKey || !appSecret) throw new Error('Informe a chave e o segredo do aplicativo.');
  putVaultCredential(omieVaultKey(slug), { label: slug, connector: 'omie', credential: { auth: { mode: 'none', apiKey: String(appKey), clientSecret: String(appSecret) } } });
  settings.omie = { companies: [...(settings.omie?.companies || []).filter(c => c.slug !== slug), { slug }] };
  return settings.omie.companies;
}

export function omieRemoveCompany(settings, slug) {
  deleteVaultCredential(omieVaultKey(slug));
  settings.omie = { companies: (settings.omie?.companies || []).filter(c => c.slug !== slug) };
}

// ---------- Catálogo: uma ferramenta por capacidade Omie (nomes/contratos do Multipli, omie.*) ----------
const EMP = z.string().min(2).max(60).describe('Slug da empresa no Omie, ex.: ecmach. Sempre informe: nunca reaproveite a empresa de outra mensagem.');
const PARAM = z.record(z.string(), z.any()).optional().describe('Filtros e paginação da API Omie, ex.: {"pagina":1,"registros_por_pagina":50}');
const PAYLOAD = z.record(z.string(), z.any()).describe('Corpo (param) da chamada Omie, como na documentação da API');
const DOC = z.string().min(11).max(18).describe('CNPJ ou CPF, só números ou com pontuação');
const READ_SHAPE = { empresa: EMP, param: PARAM };
const WRITE_SHAPE = { empresa: EMP, param: PAYLOAD };
// PesquisarPedCompra: nomes exatos da documentação (nRegsPorPagina, flags T/F, datas dd/mm/aaaa). Sem datas e com só "pendentes" a Omie devolve vazio.
const ddmmyyyy = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
// Resumo enxuto para o agente (sem as observações longas, que estouravam o limite de resposta).
export function resumoPedidosCompra(r) {
  const pedidos = (r.pedidos_pesquisa || []).map(p => {
    const c = p.cabecalho_consulta || {};
    const valor = (p.produtos_consulta || []).reduce((t, x) => t + (Number(x.nValTot) || 0), 0);
    return { numero: c.cNumero, etapa: c.cEtapa, fornecedor_codigo: c.nCodFor, previsao: c.dDtPrevisao, incluido_em: c.dIncData, valor_total: Math.round(valor * 100) / 100, parcelas: (p.parcelas_consulta || []).map(x => ({ vencimento: x.dVencto, valor: x.nValor })), codigo_pedido: c.nCodPed };
  });
  return { pagina: r.nPagina, total_paginas: r.nTotalPaginas, total_registros: r.nTotalRegistros, pedidos };
}
export function pedidosCompraParam(a = {}) {
  const hoje = new Date(); const ini = new Date(hoje.getTime() - 180 * 86400_000);
  const todas = Object.fromEntries(['lExibirPedidosPendentes', 'lExibirPedidosFaturados', 'lExibirPedidosRecebidos', 'lExibirPedidosCancelados', 'lExibirPedidosEncerrados', 'lExibirPedidosRecParciais', 'lExibirPedidosFatParciais'].map(k => [k, 'T']));
  return { nPagina: 1, nRegsPorPagina: 10, lApenasImportadoApi: 'F', lApenasAlterados: 'F', dDataInicial: ddmmyyyy(ini), dDataFinal: ddmmyyyy(hoje), ...todas, ...(a.param || {}) };
}
const digits = s => String(s || '').replace(/\D/g, '');

// Cadastro (cliente, fornecedor, transportadora): mesmo IncluirCliente, com tag.
const CAD_SHAPE = {
  empresa: EMP,
  razao_social: z.string().min(2).max(120),
  cnpj_cpf: DOC,
  email: z.string().max(120).optional(),
  nome_fantasia: z.string().max(120).optional(),
  telefone1_ddd: z.string().max(4).optional(),
  telefone1_numero: z.string().max(20).optional(),
  endereco: z.string().max(120).optional(),
  endereco_numero: z.string().max(20).optional(),
  bairro: z.string().max(80).optional(),
  cidade: z.string().max(80).optional(),
  estado: z.string().max(2).optional(),
  cep: z.string().max(10).optional(),
  codigo_cliente_integracao: z.string().max(60).optional()
};
const cadastroParam = (a, tag) => ({
  razao_social: a.razao_social, cnpj_cpf: a.cnpj_cpf, email: a.email, nome_fantasia: a.nome_fantasia,
  telefone1_ddd: a.telefone1_ddd, telefone1_numero: a.telefone1_numero, endereco: a.endereco, endereco_numero: a.endereco_numero,
  bairro: a.bairro, cidade: a.cidade, estado: a.estado, cep: a.cep, codigo_cliente_integracao: a.codigo_cliente_integracao,
  ...(tag ? { tags: [{ tag }] } : {})
});
const CLIENTES = { call: 'IncluirCliente', path: 'geral/clientes/' };

/** Antes de cadastrar: o CNPJ/CPF já existe no cadastro? Se sim, não duplica. */
async function cadastroPrecheck(a, call) {
  const doc = digits(a.cnpj_cpf);
  const r = await call({ path: 'geral/clientes/', call: 'ListarClientes', param: { pagina: 1, registros_por_pagina: 5, clientesFiltro: { cnpj_cpf: doc } } });
  const hit = (r.clientes_cadastro || []).find(c => digits(c.cnpj_cpf) === doc);
  if (hit) return { stop: `Já existe no cadastro da ${a.empresa}: ${hit.razao_social} (código ${hit.codigo_cliente_omie}, ${hit.cnpj_cpf}). Não cadastrei de novo; para mudar os dados use a alteração.` };
  return { note: 'CNPJ/CPF não está no cadastro: será um cadastro novo.' };
}

/** Antes de lançar pedido ou conta a pagar: o fornecedor existe no cadastro (código Omie, nunca CNPJ solto de documento). */
async function fornecedorPrecheck(a, call, codigo) {
  if (codigo == null) return { stop: 'Informe o código Omie do fornecedor (confira em omie_listar_clientes). Nada foi lançado.' };
  const f = await call({ path: 'geral/clientes/', call: 'ConsultarCliente', param: { codigo_cliente_omie: +codigo } }).catch(() => null);
  if (!f?.razao_social) return { stop: `Fornecedor ${codigo} não existe no cadastro da ${a.empresa}. Nada foi lançado: confira o código ou cadastre o fornecedor antes.` };
  return { note: `Fornecedor conferido no cadastro: ${f.razao_social} (${f.cnpj_cpf}).` };
}

const R = (name, call, path, desc, extra = {}) => ({ name, call, path, desc, write: false, ...extra });
const W = (name, call, path, risk, desc, extra = {}) => ({ name, call, path, risk, desc, write: true, schema: WRITE_SHAPE, ...extra });

export const OMIE_CAPS = [
  // ----- leitura -----
  R('listar_contas_pagar', 'ListarContasPagar', 'financas/contapagar/', 'Lista contas a pagar (filtros de status, período e fornecedor).', { schema: READ_SHAPE }),
  R('listar_contas_receber', 'ListarContasReceber', 'financas/contareceber/', 'Lista contas a receber (todos os status).', { schema: READ_SHAPE }),
  R('detalhar_conta_pagar', 'ConsultarContaPagar', 'financas/contapagar/', 'Detalha uma conta a pagar pelo codigo_lancamento_omie.', { schema: READ_SHAPE }),
  R('listar_titulos_aberto', null, null, 'Títulos em aberto: tipo "pagar" ou "receber" (filtro por nome em param).', {
    schema: { empresa: EMP, tipo: z.enum(['pagar', 'receber']), param: PARAM },
    plan: a => a.tipo === 'receber'
      ? { call: 'ListarContasReceber', path: 'financas/contareceber/', param: { status_titulo: 'ABERTO', ...(a.param || {}) } }
      : { call: 'ListarContasPagar', path: 'financas/contapagar/', param: { status_titulo: 'ABERTO', ...(a.param || {}) } }
  }),
  R('aging_pagar', 'ListarAgingPagar', 'financas/aging/', 'Relatório de vencimentos (aging) de contas a pagar.', { schema: READ_SHAPE }),
  R('aging_receber', 'ListarAgingReceber', 'financas/aging/', 'Relatório de vencimentos (aging) de contas a receber.', { schema: READ_SHAPE }),
  R('listar_categorias', 'ListarCategorias', 'geral/categorias/', 'Categorias financeiras para contas a pagar/receber.', { schema: READ_SHAPE }),
  R('listar_contas_correntes', 'ListarContasCorrentes', 'geral/contacorrente/', 'Contas correntes bancárias cadastradas.', { schema: READ_SHAPE }),
  R('consultar_conta_corrente', 'ConsultarContaCorrente', 'geral/contacorrente/', 'Consulta uma conta corrente (codigo_conta_corrente em param).', { schema: READ_SHAPE }),
  R('listar_extrato_cc', 'ListarLancCC', 'financas/contacorrentelancamentos/', 'Movimentos de conta corrente no período (extrato).', { schema: READ_SHAPE }),
  R('listar_nf_entrada', 'ListarNotaEnt', 'produtos/notaentrada/', 'Notas fiscais de compra recebidas (NF de entrada) cadastradas na Omie.', { schema: READ_SHAPE, plan: a => ({ call: 'ListarNotaEnt', path: 'produtos/notaentrada/', param: { nPagina: 1, nRegistrosPorPagina: 20, ...(a.param || {}) } }) }),
  R('listar_nfse', 'ListarNFSe', 'servicos/nfse/', 'Notas fiscais de serviço (NFS-e) emitidas.', { schema: READ_SHAPE }),
  R('listar_nf_emitidas', 'ListarNFe', 'produtos/nfe/', 'NF-e de venda já emitidas.', { schema: READ_SHAPE }),
  R('listar_pedidos_compra', 'PesquisarPedCompra', 'produtos/pedidocompra/', 'Pesquisa pedidos de compra com a etapa de cada um (cEtapa). Traz todas as situações e os últimos 180 dias por padrão.', { schema: READ_SHAPE, plan: a => ({ call: 'PesquisarPedCompra', path: 'produtos/pedidocompra/', param: pedidosCompraParam(a) }), compact: resumoPedidosCompra }),
  R('consultar_pedido_compra', 'ConsultarPedCompra', 'produtos/pedidocompra/', 'Detalhes de um pedido de compra (código Omie ou de integração).', { schema: READ_SHAPE }),
  R('listar_pedidos_venda', 'ListarPedidos', 'produtos/pedido/', 'Pedidos de venda de produtos.', { schema: READ_SHAPE }),
  R('listar_clientes', 'ListarClientes', 'geral/clientes/', 'Clientes e fornecedores do cadastro (filtros de nome, CNPJ, status).', { schema: READ_SHAPE }),
  R('consultar_cliente', 'ConsultarCliente', 'geral/clientes/', 'Consulta um cliente ou fornecedor por codigo_cliente_omie ou CNPJ.', { schema: READ_SHAPE }),
  R('listar_transportadoras', 'ListarClientes', 'geral/clientes/', 'Transportadoras (cadastro com tag Transportadora).', {
    schema: READ_SHAPE, plan: a => ({ call: 'ListarClientes', path: 'geral/clientes/', param: { filtrar_por_tag: [{ tag: 'Transportadora' }], ...(a.param || {}) } })
  }),
  R('listar_departamentos', 'ListarDepartamentos', 'geral/departamentos/', 'Departamentos e centros de custo para rateio.', { schema: READ_SHAPE }),
  R('listar_cenarios_fiscais', 'ListarCenarios', 'geral/cenarios/', 'Cenários fiscais cadastrados.', { schema: READ_SHAPE }),
  R('listar_cfop', 'ListarCFOP', 'produtos/cfop/', 'Códigos CFOP (operações fiscais).', { schema: READ_SHAPE }),
  R('listar_ncm', 'ListarNCM', 'produtos/ncm/', 'NCM (nomenclatura comum do Mercosul).', { schema: READ_SHAPE }),
  R('listar_movimentos_estoque', 'ListarMovimentoEstoque', 'estoque/consulta/', 'Entradas e saídas de estoque no período.', { schema: READ_SHAPE }),
  R('listar_locais_estoque', 'ListarLocaisEstoque', 'estoque/local/', 'Almoxarifados e locais de estoque.', { schema: READ_SHAPE }),
  R('listar_lotes_estoque', 'ListarLotes', 'estoque/lote/', 'Lotes de estoque (controle por lote).', { schema: READ_SHAPE }),
  R('listar_ordens_producao', 'ListarOrdemProducao', 'produtos/op/', 'Ordens de produção em andamento ou concluídas.', { schema: READ_SHAPE }),
  R('listar_cadastro_dre', 'ListarCadastroDRE', 'geral/dre/', 'Plano de contas da DRE (estrutura, não movimento por período).', { schema: READ_SHAPE }),
  // ----- escrita: sempre com aprovação; nunca roda sem a Caixa -----
  W('incluir_cliente', CLIENTES.call, CLIENTES.path, 'medium', 'Cadastra cliente (confere antes se o CNPJ/CPF já existe).', {
    schema: CAD_SHAPE, plan: a => ({ ...CLIENTES, param: cadastroParam(a) }), precheck: cadastroPrecheck
  }),
  W('incluir_fornecedor', CLIENTES.call, CLIENTES.path, 'medium', 'Cadastra fornecedor (tag Fornecedor; confere antes se o CNPJ/CPF já existe).', {
    schema: CAD_SHAPE, plan: a => ({ ...CLIENTES, param: cadastroParam(a, 'Fornecedor') }), precheck: cadastroPrecheck
  }),
  W('incluir_transportadora', CLIENTES.call, CLIENTES.path, 'medium', 'Cadastra transportadora (tag Transportadora; confere antes).', {
    schema: CAD_SHAPE, plan: a => ({ ...CLIENTES, param: cadastroParam(a, 'Transportadora') }), precheck: cadastroPrecheck
  }),
  W('alterar_cliente', 'AlterarCliente', 'geral/clientes/', 'medium', 'Altera cadastro de cliente.'),
  W('alterar_fornecedor', 'AlterarCliente', 'geral/clientes/', 'medium', 'Altera cadastro de fornecedor.'),
  W('incluir_produto', 'IncluirProduto', 'geral/produtos/', 'medium', 'Cadastra produto ou serviço.'),
  W('incluir_familia_produto', 'IncluirFamilia', 'produtos/familia/', 'medium', 'Cadastra família de produto.'),
  W('incluir_pedido_compra', 'IncluirPedCompra', 'produtos/pedidocompra/', 'high', 'Cria pedido de compra (confere antes se o fornecedor existe no cadastro).', {
    precheck: (a, call) => fornecedorPrecheck(a, call, a.param?.nCodFor ?? a.param?.codigo_fornecedor ?? a.param?.cabecalho?.nCodFor)
  }),
  W('alterar_pedido_compra', 'AlterarPedCompra', 'produtos/pedidocompra/', 'medium', 'Altera pedido de compra existente.'),
  W('cancelar_pedido_compra', 'ExcluirPedCompra', 'produtos/pedidocompra/', 'high', 'Cancela (exclui) pedido de compra.'),
  W('associar_pedido_recebimento_nfe', 'AlterarRecebimento', 'produtos/recebimento/', 'medium', 'Vincula item de NF-e de entrada a um pedido de compra (cAcao=ASSOCIAR-PEDIDO).'),
  W('incluir_ajuste_estoque', 'IncluirAjusteEstoque', 'estoque/ajuste/', 'high', 'Ajuste de estoque: entrada, saída ou inventário, com lote.'),
  W('incluir_conta_pagar', 'IncluirContaPagar', 'financas/contapagar/', 'medium', 'Cria conta a pagar (confere antes se o fornecedor existe no cadastro).', {
    precheck: (a, call) => fornecedorPrecheck(a, call, a.param?.codigo_cliente_fornecedor)
  }),
  W('incluir_conta_corrente', 'IncluirContaCorrente', 'geral/contacorrente/', 'medium', 'Cadastra conta corrente bancária.'),
  W('alterar_conta_corrente', 'AlterarContaCorrente', 'geral/contacorrente/', 'medium', 'Altera conta corrente bancária.'),
  W('transferir_conta_corrente', 'IncluirTransferencia', 'financas/contacorrentelancamentos/', 'high', 'Transferência entre contas correntes (valor positivo).'),
  W('excluir_lancamento_cc', 'ExcluirLancCC', 'financas/contacorrentelancamentos/', 'high', 'Exclui lançamento manual de conta corrente (nCodLanc).'),
  W('conciliar_lancamento', 'ConciliarLancamento', 'financas/contacorrentelancamentos/', 'high', 'Concilia lançamento bancário.'),
  W('desconciliar_lancamento', 'DesconciliarLancamento', 'financas/contacorrentelancamentos/', 'high', 'Desconcilia lançamento bancário.'),
  W('anexar_documento', 'IncluirAnexo', 'geral/anexo/', 'medium', 'Anexa arquivo a um documento Omie (tabela: conta-pagar, conta-receber, pedido etc.).')
];

const TOOL_PREFIX = 'omie_';
export const OMIE_EMPRESAS_TOOL = TOOL_PREFIX + 'listar_empresas';
export const OMIE_WRITE_TOOLS = new Set(OMIE_CAPS.filter(c => c.write).map(c => TOOL_PREFIX + c.name));
export const OMIE_TOOL_NAMES = [OMIE_EMPRESAS_TOOL, ...OMIE_CAPS.map(c => TOOL_PREFIX + c.name)];

/** Entradas no formato RIPPER_TOOL_CATALOG (descrição + inputSchema zod). */
export const OMIE_TOOL_CATALOG = Object.fromEntries([
  [OMIE_EMPRESAS_TOOL, { description: 'Lista as empresas do Omie conectadas (slug e status). Use antes das outras ferramentas Omie para saber qual empresa usar.', inputSchema: {} }],
  ...OMIE_CAPS.map(c => [TOOL_PREFIX + c.name, {
    description: `Omie · ${c.desc} ${c.write ? 'Escrita: a sua aprovação é pedida antes de sair.' : ''}`.trim(),
    inputSchema: c.schema || (c.write ? WRITE_SHAPE : READ_SHAPE)
  }])
]);

const MAX_RESULT = 20000;
const MAX_SUMMARY = 1500;

/**
 * Executor das ferramentas Omie. Cada chamada usa a empresa informada (sem reaproveitar outra).
 * deps: getSettings() → settings atuais; approve(command, reason) → Promise<boolean> (Caixa);
 * record(meta) → registro de ação externa; fetchImpl/sleep só para teste.
 */
export function createOmieRunner({ getSettings = () => ({}), approve, record = () => {}, fetchImpl, sleep } = {}) {
  const opts = { fetchImpl, sleep };
  const credsFor = slug => {
    const list = omieCompanyList(getSettings());
    if (!list.some(c => c.slug === slug)) throw new Error(`Empresa "${slug}" não está no Omie. Empresas: ${list.map(c => c.slug).join(', ') || 'nenhuma'}.`);
    return omieCredentials(slug);
  };
  const run = async (name, a = {}) => {
    if (name === OMIE_EMPRESAS_TOOL) return JSON.stringify(omieCompanyList(getSettings()));
    const cap = OMIE_CAPS.find(c => TOOL_PREFIX + c.name === name);
    if (!cap) throw new Error(`ferramenta Omie desconhecida: ${name}`);
    const creds = credsFor(a.empresa);
    const plan = cap.plan ? cap.plan(a) : { call: cap.call, path: cap.path, param: a.param || {} };
    const call = o => omieCall(creds, o, opts);
    if (!cap.write) {
      const raw = await call(plan);
      const out = JSON.stringify(cap.compact ? cap.compact(raw) : raw);
      return out.length > MAX_RESULT ? out.slice(0, MAX_RESULT) + '\n[… cortado: filtre por período ou página]' : out;
    }
    let note = '';
    if (cap.precheck) {
      const p = await cap.precheck(a, call);
      if (p.stop) return p.stop;
      note = p.note || '';
    }
    const summary = JSON.stringify(plan.param, null, 2).slice(0, MAX_SUMMARY);
    const ok = await approve(`Omie · ${plan.call} · empresa ${a.empresa}\n${summary}`, `Escreve no Omie da empresa ${a.empresa} (risco ${cap.risk === 'high' ? 'alto' : 'médio'}). ${note}`.trim());
    if (!ok) return 'O usuário NÃO aprovou. Nada foi alterado no Omie.';
    const target = `${a.empresa} · ${plan.call}`;
    try {
      const r = await call(plan);
      record({ kind: 'omie.write', target, approved: 'user', ok: true });
      return `Feito no Omie (${plan.call}): ${JSON.stringify(r).slice(0, 4000)}`;
    } catch (e) {
      record({ kind: 'omie.write', target, approved: 'user', ok: false, error: e.message });
      return `Falhou no Omie: ${e.message}`;
    }
  };
  return { run, companies: () => omieCompanyList(getSettings()) };
}
