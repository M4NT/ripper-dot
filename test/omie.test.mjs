import './helpers/signed-in.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePort } from './helpers/free-port.mjs';

// Cofre e dados em pasta temporária; Omie só por um servidor HTTP falso (nunca a API real).
const DATA = mkdtempSync(join(tmpdir(), 'ripper-omie-'));
process.env.RIPPER_DATA = DATA;
process.env.RIPPER_VAULT_KEY = 'omie-test-vault-key';

const { omieAddCompany, omieCall, omieCompanyList, OMIE_CAPS, OMIE_WRITE_TOOLS, OMIE_TOOL_NAMES, OMIE_TOOL_CATALOG, createOmieRunner } = await import('../lib/omie.mjs');
const { RIPPER_TOOL_CATALOG, buildRipperBuiltinTools } = await import('../lib/ripper-builtin-tools.mjs');
const { isToolAllowedByAutonomy } = await import('../lib/autonomy.mjs');

/** Servidor HTTP falso no formato da API Omie: cada chamada vai para `seen`; `handler` decide a resposta. */
async function fakeOmie(handler = () => null) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const b = JSON.parse(raw);
      const rec = { call: b.call, app_key: b.app_key, app_secret: b.app_secret, param: b.param?.[0] || {}, path: req.url };
      seen.push(rec);
      const fallback = defaults(rec);
      const r = handler(rec, seen) || fallback;
      res.writeHead(r.status || 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.body ?? r));
    });
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  return { seen, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(ok => server.close(ok)) };
}

function defaults(rec) {
  if (rec.call === 'ListarClientes') return { clientes_cadastro: [] };
  if (rec.call === 'ConsultarCliente') return { codigo_cliente_omie: 1, razao_social: 'Fornecedor Teste Ltda', cnpj_cpf: '11.222.333/0001-44' };
  return { ok: true, call: rec.call };
}

function setup(companies) {
  const settings = {};
  for (const [slug, key, secret] of companies) omieAddCompany(settings, { slug, appKey: key, appSecret: secret });
  return settings;
}

test('cada chamada usa a empresa informada: alfa com a chave de alfa, beta com a de beta; empresa desconhecida não chama a API', async () => {
  const f = await fakeOmie();
  process.env.OMIE_API_URL = f.url;
  try {
    const settings = setup([['alfa', 'KA-1', 'SA-1'], ['beta', 'KB-2', 'SB-2']]);
    const approve = async () => true;
    const runner = createOmieRunner({ getSettings: () => settings, approve });
    await runner.run('omie_listar_contas_pagar', { empresa: 'alfa', param: { pagina: 1 } });
    await runner.run('omie_listar_contas_pagar', { empresa: 'beta', param: { pagina: 1 } });
    assert.deepEqual(f.seen.map(x => [x.call, x.app_key]), [['ListarContasPagar', 'KA-1'], ['ListarContasPagar', 'KB-2']]);
    assert.match(f.seen[0].path, /\/financas\/contapagar\/$/);
    await assert.rejects(runner.run('omie_listar_contas_pagar', { empresa: 'gama' }), /não está no Omie/);
    assert.equal(f.seen.length, 2, 'empresa desconhecida não chega à API');
    assert.deepEqual(omieCompanyList(settings), [{ slug: 'alfa', status: 'conectada' }, { slug: 'beta', status: 'conectada' }]);
  } finally { delete process.env.OMIE_API_URL; await f.close(); }
});

test('REDUNDANT: espera o número de segundos da resposta e tenta de novo', async () => {
  let n = 0;
  const f = await fakeOmie(() => (n++ === 0 ? { status: 500, body: { faultcode: 'SOAP-ENV:Client-6', faultstring: 'Consumo redundante detectado. Aguarde 3 segundos para repetir.' } } : null));
  const waits = [];
  process.env.OMIE_API_URL = f.url;
  try {
    const out = await omieCall({ appKey: 'K', appSecret: 'S' }, { path: 'geral/clientes/', call: 'ListarClientes', param: {} }, { sleep: async ms => { waits.push(ms); } });
    assert.deepEqual(waits, [3000]);
    assert.equal(f.seen.length, 2, 'uma tentativa redundante e uma que deu certo');
    assert.deepEqual(out.clientes_cadastro, []);
  } finally { delete process.env.OMIE_API_URL; await f.close(); }
});

test('toda escrita pede aprovação; sem aprovação nenhuma escrita chega ao Omie (para as 20 escritas)', async () => {
  const f = await fakeOmie();
  process.env.OMIE_API_URL = f.url;
  try {
    const settings = setup([['alfa', 'KA-1', 'SA-1']]);
    const asked = [];
    const runner = createOmieRunner({ getSettings: () => settings, approve: async (cmd, reason) => { asked.push({ cmd, reason }); return false; } });
    const writeNames = OMIE_CAPS.filter(c => c.write).map(c => 'omie_' + c.name);
    const writeCalls = new Set(OMIE_CAPS.filter(c => c.write).map(c => c.call));
    for (const name of writeNames) {
      const out = await runner.run(name, { empresa: 'alfa', razao_social: 'Acme Ltda', cnpj_cpf: '12.345.678/0001-90', param: { nCodFor: 1, codigo_cliente_fornecedor: 1 } });
      assert.match(out, /NÃO aprovou/, name);
    }
    assert.equal(asked.length, writeNames.length, 'uma pergunta por escrita');
    assert.ok(asked.every(x => /empresa alfa/.test(x.cmd)));
    assert.equal(f.seen.filter(x => writeCalls.has(x.call)).length, 0, 'nenhuma escrita foi enviada');
    assert.ok(OMIE_CAPS.filter(c => c.write).every(c => ['medium', 'high'].includes(c.risk)), 'escritas são no mínimo média');
  } finally { delete process.env.OMIE_API_URL; await f.close(); }
});

test('escrita aprovada vai ao Omie da empresa certa e fica registrada como ação externa (sem segredo)', async () => {
  const f = await fakeOmie();
  process.env.OMIE_API_URL = f.url;
  try {
    const settings = setup([['beta', 'KB-2', 'SB-2']]);
    const recorded = [];
    const runner = createOmieRunner({ getSettings: () => settings, approve: async () => true, record: m => recorded.push(m) });
    const out = await runner.run('omie_incluir_cliente', { empresa: 'beta', razao_social: 'Acme Ltda', cnpj_cpf: '12.345.678/0001-90', email: 'a@acme.test' });
    assert.match(out, /Feito no Omie \(IncluirCliente\)/);
    const write = f.seen.find(x => x.call === 'IncluirCliente');
    assert.equal(write.app_key, 'KB-2');
    assert.equal(write.param.razao_social, 'Acme Ltda');
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].kind, 'omie.write');
    assert.ok(!JSON.stringify(recorded).includes('SB-2'), 'registro sem segredo');
  } finally { delete process.env.OMIE_API_URL; await f.close(); }
});

test('cadastro: CNPJ já existente no cadastro não é cadastrado de novo e nem chega à aprovação', async () => {
  const f = await fakeOmie(rec => (rec.call === 'ListarClientes' ? { clientes_cadastro: [{ codigo_cliente_omie: 77, razao_social: 'Acme Ltda', cnpj_cpf: '12.345.678/0001-90' }] } : null));
  process.env.OMIE_API_URL = f.url;
  try {
    const settings = setup([['alfa', 'KA-1', 'SA-1']]);
    let asked = 0;
    const runner = createOmieRunner({ getSettings: () => settings, approve: async () => { asked++; return true; } });
    const out = await runner.run('omie_incluir_fornecedor', { empresa: 'alfa', razao_social: 'Acme', cnpj_cpf: '12345678000190' });
    assert.match(out, /Já existe no cadastro da alfa: Acme Ltda \(código 77/);
    assert.equal(asked, 0);
    assert.equal(f.seen.filter(x => x.call === 'IncluirCliente').length, 0);
  } finally { delete process.env.OMIE_API_URL; await f.close(); }
});

test('pedido e conta a pagar: fornecedor precisa existir no cadastro (código Omie), senão nada é lançado', async () => {
  const f = await fakeOmie(rec => (rec.call === 'ConsultarCliente' ? { status: 500, body: { faultstring: 'Cliente não cadastrado para o código informado' } } : null));
  process.env.OMIE_API_URL = f.url;
  try {
    const settings = setup([['alfa', 'KA-1', 'SA-1']]);
    let asked = 0;
    const runner = createOmieRunner({ getSettings: () => settings, approve: async () => { asked++; return true; } });
    const out = await runner.run('omie_incluir_pedido_compra', { empresa: 'alfa', param: { nCodFor: 999 } });
    assert.match(out, /não existe no cadastro da alfa/);
    assert.equal(asked, 0);
    assert.equal(f.seen.filter(x => x.call === 'IncluirPedCompra').length, 0);
  } finally { delete process.env.OMIE_API_URL; await f.close(); }
});

test('segredo nunca aparece em mensagem de erro nem no registro, mesmo se o Omie o devolver', async () => {
  const f = await fakeOmie(rec => ({ status: 500, body: { faultstring: `Chave inválida: ${rec.app_secret}` } }));
  process.env.OMIE_API_URL = f.url;
  try {
    const settings = setup([['alfa', 'KA-1', 'SEGREDO-ALFA-9']]);
    const recorded = [];
    const runner = createOmieRunner({ getSettings: () => settings, approve: async () => true, record: m => recorded.push(m) });
    await assert.rejects(runner.run('omie_listar_contas_pagar', { empresa: 'alfa' }), e => {
      assert.ok(!e.message.includes('SEGREDO-ALFA-9'));
      assert.match(e.message, /••••/);
      return true;
    });
    const out = await runner.run('omie_incluir_produto', { empresa: 'alfa', param: { descricao: 'x', codigo: 'y' } });
    assert.match(out, /Falhou no Omie/);
    assert.ok(!out.includes('SEGREDO-ALFA-9'));
    assert.ok(!JSON.stringify(recorded).includes('SEGREDO-ALFA-9'));
    assert.equal(recorded[0].ok, false);
  } finally { delete process.env.OMIE_API_URL; await f.close(); }
});

test('catálogo: cada capacidade tem ferramenta, nomes únicos e escritas fora do modo somente leitura', () => {
  assert.equal(new Set(OMIE_TOOL_NAMES).size, OMIE_TOOL_NAMES.length);
  for (const n of OMIE_TOOL_NAMES) {
    assert.ok(RIPPER_TOOL_CATALOG[n], n);
    assert.ok(OMIE_TOOL_CATALOG[n].description.length > 10, n);
  }
  const agent = { id: 'a', tools: [], templateId: 'x' };
  const ro = { ...agent, autonomyLevel: 'read_only' };
  for (const w of OMIE_WRITE_TOOLS) assert.equal(isToolAllowedByAutonomy(ro, w, {}), false, w);
  assert.equal(isToolAllowedByAutonomy(ro, 'omie_listar_clientes', {}), true);
  assert.equal(isToolAllowedByAutonomy({ ...agent, autonomyLevel: 'fully_autonomous' }, 'omie_incluir_cliente', {}), true, 'autonomia não dispensa a Caixa: a checagem de aprovação é do executor');
});

test('ferramentas Omie entram no contexto do agente quando a empresa está conectada, e executam pelo executor', async () => {
  const settings = setup([['alfa', 'KA-1', 'SA-1']]);
  const runner = createOmieRunner({ getSettings: () => settings, approve: async () => false });
  const agent = { id: 'a1', name: 'Financeiro', tools: [], templateId: 'x' };
  const tools = buildRipperBuiltinTools(agent, { omie: runner, settings: {} });
  const names = tools.map(t => t.name);
  assert.ok(names.includes('omie_listar_empresas'));
  assert.ok(names.includes('omie_incluir_cliente'));
  const list = tools.find(t => t.name === 'omie_listar_empresas');
  assert.match((await list.execute({})).content[0].text, /alfa/);
  assert.equal(buildRipperBuiltinTools(agent, { settings: {} }).some(t => t.name.startsWith('omie_')), false, 'sem empresa conectada, nada aparece');
});

test('servidor: cadastrar, listar, testar e remover empresa; chave só no cofre cifrado', async () => {
  const f = await fakeOmie();
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-omie-srv-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TEST_PROVIDER: 'stream', HOME: dataDir, USERPROFILE: dataDir, RIPPER_SECRET_KEY_FILE: join(dataDir, 'k'), JULIA_AUTOSTART: '0', RIPPER_VAULT_KEY: 'omie-server-test-key', OMIE_API_URL: f.url },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  const send = (path, b, method = 'POST') => fetch(base + path, { method, headers: { 'content-type': 'application/json', origin: base }, body: b === undefined ? undefined : JSON.stringify(b) });
  try {
    for (let i = 0; i < 300; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
    const add = await send('/api/omie/companies', { slug: 'alfa', appKey: 'KA-SRV', appSecret: 'SEGREDO-SRV-7' });
    assert.equal(add.status, 200);
    const addText = await add.text();
    assert.ok(!addText.includes('SEGREDO-SRV-7') && !addText.includes('KA-SRV'), 'resposta sem chave nem segredo');
    assert.deepEqual(JSON.parse(addText).companies, [{ slug: 'alfa', status: 'conectada' }]);
    const list = await (await fetch(base + '/api/omie')).text();
    assert.ok(!list.includes('SEGREDO-SRV-7') && !list.includes('KA-SRV'));
    assert.match(list, /"status":"conectada"/);
    const t = await send('/api/omie/companies/alfa/test', {});
    assert.equal(t.status, 200);
    assert.equal(f.seen.at(-1).call, 'ListarContasCorrentes');
    assert.equal(f.seen.at(-1).app_key, 'KA-SRV');
    const bad = await send('/api/omie/companies', { slug: 'Alfa!', appKey: 'x', appSecret: 'y' });
    assert.equal(bad.status, 400);
    // disco: o segredo não fica em texto puro (o cofre cifra; o db só tem o nome da empresa)
    for (let i = 0; i < 100 && !existsSync(join(dataDir, 'connection-vault.json')); i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 400));
    const disk = readFileSync(join(dataDir, 'connection-vault.json'), 'utf8') + readFileSync(join(dataDir, 'db.json'), 'utf8');
    assert.ok(!disk.includes('SEGREDO-SRV-7') && !disk.includes('KA-SRV'), 'chave não fica em texto puro');
    const del = await send('/api/omie/companies/alfa', undefined, 'DELETE');
    assert.equal(del.status, 200);
    assert.deepEqual((await del.json()).companies, []);
  } finally { child.kill(); await f.close(); }
});
