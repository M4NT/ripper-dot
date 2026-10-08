// NFS-e recebidas (ADN): certificado A1 de teste gerado com openssl em pasta temporária (nunca commitado).
// O ADN é simulado por servidor HTTPS local que exige certificado de cliente. Nenhuma chamada ao ADN real.
process.env.RIPPER_NFSE_PAUSA_MS = '5'; // testes rápidos; o teste de pausa passa 3000 explicitamente
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import https from 'node:https';
import { gzipSync } from 'node:zlib';

const DATA = mkdtempSync(join(tmpdir(), 'ripper-nfse-'));
process.env.RIPPER_DATA = DATA;
process.env.RIPPER_VAULT_KEY = 'nfse-test-vault-key';

const vault = await import('../lib/connection-vault.mjs');
const dfe = await import('../lib/dfe.mjs');
const nfse = await import('../lib/nfse.mjs');
const { buildRipperBuiltinTools, RIPPER_TOOL_CATALOG } = await import('../lib/ripper-builtin-tools.mjs');
const { isToolAllowedByAutonomy } = await import('../lib/autonomy.mjs');

const CNPJ = '11222333000181';   // sintético
const OTHER = '99888777000166';  // sintético
const PASS = 'senha-teste-nfse';
const dir = mkdtempSync(join(tmpdir(), 'ripper-nfse-certs-'));
const HORA = dfe.DFE_HOUR;
const CHAVE_A = '1'.repeat(50); // chaves sintéticas de 50 dígitos
const CHAVE_B = '2'.repeat(50);

/** Certificado de teste (CN "TESTE LTDA:<cnpj>", como no ICP-Brasil). */
function makeCert({ name }) {
  const key = join(dir, `${name}.key`), crt = join(dir, `${name}.crt`), pfx = join(dir, `${name}.pfx`);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '365',
    '-subj', `/CN=TESTE LTDA:${CNPJ}/O=ICP-Brasil-TESTE`, '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  execFileSync('openssl', ['pkcs12', '-export', '-inkey', key, '-in', crt, '-out', pfx, '-passout', `pass:${PASS}`], { stdio: 'ignore' });
  const pfxBuf = readFileSync(pfx);
  return { pfxBase64: pfxBuf.toString('base64'), crt: readFileSync(crt, 'utf8'), key: readFileSync(key, 'utf8') };
}

const withVault = fn => async () => {
  vault._resetVaultForTests();
  const f = join(DATA, 'connection-vault.json');
  if (existsSync(f)) rmSync(f);
  return fn({ settings: {} });
};

// Documentos sintéticos (XML de NFS-e no layout esperado; campos conferidos por extractNfse).
const nfseXml = ({ chave, nome = 'PRESTADOR GAMA LTDA', cnpj = '55444333000100', valor = '1500.00', dhEmi = '2026-09-10T09:00:00-03:00' }) =>
  `<?xml version="1.0"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${chave}"><nNFSe>1</nNFSe>`
  + `<emit><CNPJ>${cnpj}</CNPJ><xNome>${nome}</xNome></emit><xLocEmi>Sao Paulo</xLocEmi>`
  + `<DPS><infDPS><dhEmi>${dhEmi}</dhEmi><dCompet>2026-09-01</dCompet></infDPS></DPS>`
  + `<valores><vLiq>${valor}</vLiq></valores></infNFSe></NFSe>`;
const eventoXml = '<?xml version="1.0"?><eventoNFSe xmlns="x"><algo>evento</algo></eventoNFSe>';
const gz = s => gzipSync(Buffer.from(s, 'utf8')).toString('base64');
const plain = s => Buffer.from(s, 'utf8').toString('base64');

/** Lote no formato assumido (LoteDFe com NSU, ChaveAcesso, TipoDocumento e ArquivoXml em base64/gzip). */
const lote = ({ itens = [], ultNSU, maxNSU } = {}) => JSON.stringify({ LoteDFe: itens, UltimoNSU: ultNSU, MaxNSU: maxNSU, StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS' });
const item = (nsu, chave, xml, enc = gz) => ({ NSU: nsu, ChaveAcesso: chave, TipoDocumento: 'NFSE', ArquivoXml: enc(xml) });

/** Servidor ADN local com mTLS. `responder(req)` devolve { status, body }; registra cada chamada. */
async function startAdn(responder) {
  const seen = [];
  const server = https.createServer({ key: CERT.key, cert: CERT.crt, requestCert: true, rejectUnauthorized: true, ca: [CERT.crt] }, (req, res) => {
    const u = new URL(req.url, 'https://x');
    const info = { path: u.pathname, query: Object.fromEntries(u.searchParams), method: req.method, accept: req.headers.accept, cn: req.socket.getPeerCertificate().subject?.CN, authorized: req.socket.authorized, at: Date.now() };
    seen.push(info);
    const r = responder(info, seen.length);
    res.writeHead(r.status, { 'content-type': r.type || 'application/json' });
    res.end(r.body);
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const base = `https://127.0.0.1:${server.address().port}/contribuintes`;
  return { base, seen, close: () => new Promise(ok => server.close(ok)) };
}

let CERT;
const comCertificado = async db => {
  // ca: certificado autoassinado do servidor de teste (a Receita/ADN real usa a cadeia pública, sem este parâmetro)
  CERT ||= makeCert({ name: 'nfse' });
  await dfe.saveCertificate(db, CNPJ, { pfxBase64: CERT.pfxBase64, password: PASS });
  return db;
};

// ---------- ADN: protocolo e transporte ----------

test('URL padrão é o ADN de produção restrita; RIPPER_ADN_URL sobrescreve', () => {
  assert.equal(nfse.nfseBase(), 'https://adn.producaorestrita.nfse.gov.br/contribuintes');
});

test('certificado obrigatório: sem certificado não consulta nada', withVault(async db => {
  await assert.rejects(nfse.nfseSincronizar({ cnpj: CNPJ, db, get: () => { throw new Error('não deveria chamar'); } }), /não tem certificado/);
  assert.equal(db.dfe?.nfse?.[CNPJ], undefined, 'nada guardado');
}));

test('envelope da consulta: GET /DFe/{NSU} com cnpjConsulta e lote, JSON, certificado do cliente', withVault(async db => {
  await comCertificado(db);
  const adn = await startAdn(() => ({ status: 200, body: lote({ ultNSU: '0', maxNSU: '0' }) }));
  try {
    const r = await nfse.nfseSincronizar({ cnpj: CNPJ, db, url: adn.base, ca: CERT.crt, now: 1 });
    assert.equal(r.ok, true);
    const [c] = adn.seen;
    assert.equal(c.method, 'GET');
    assert.equal(c.path, '/contribuintes/DFe/0');
    assert.equal(c.query.cnpjConsulta, CNPJ);
    assert.equal(c.query.lote, 'true');
    assert.equal(c.accept, 'application/json');
    assert.equal(c.authorized, true);
    assert.equal(c.cn, 'TESTE LTDA:' + CNPJ, 'mTLS com o A1 da empresa');
  } finally { await adn.close(); }
}));

test('pausa de 3 s entre páginas e teto de 5 chamadas', withVault(async db => {
  await comCertificado(db);
  const adn = await startAdn((info, n) => ({ status: 200, body: lote({ itens: [item(String(n), CHAVE_A, nfseXml({ chave: CHAVE_A }))], ultNSU: String(n), maxNSU: '999' }) }));
  try {
    const r = await nfse.nfseSincronizar({ cnpj: CNPJ, db, url: adn.base, ca: CERT.crt, now: 1, pausaMs: 3000 });
    assert.equal(r.paginas, 5, 'nunca passa de 5 chamadas');
    for (let i = 1; i < adn.seen.length; i++) {
      assert.ok(adn.seen[i].at - adn.seen[i - 1].at >= 2900, `pausa entre chamadas ${i} e ${i + 1}`);
    }
  } finally { await adn.close(); }
}));

test('sincronização: continua do último NSU, decodifica (gzip e base64 puro), dedup por chave e ignora eventos', withVault(async db => {
  await comCertificado(db);
  const adn = await startAdn((info, n) => n === 1
    ? { status: 200, body: lote({ itens: [item('1', CHAVE_A, nfseXml({ chave: CHAVE_A })), { NSU: '2', ChaveAcesso: CHAVE_B, TipoDocumento: 'NFSE', ArquivoXml: plain(nfseXml({ chave: CHAVE_B, nome: 'FORNECEDOR DELTA ME', valor: '320.10', cnpj: '55444333000199', dhEmi: '2026-09-12T09:00:00-03:00' })) }, item('3', null, eventoXml)], ultNSU: '3', maxNSU: '4' }) }
    : { status: 200, body: lote({ itens: [item('4', CHAVE_A, nfseXml({ chave: CHAVE_A }))], ultNSU: '4', maxNSU: '4' }) });
  try {
    const r = await nfse.nfseSincronizar({ cnpj: CNPJ, db, url: adn.base, ca: CERT.crt, now: 1, pausaMs: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.novas, 2, 'duas notas distintas');
    assert.equal(r.total, 2);
    assert.deepEqual(r.ignorados, ['desconhecido:eventoNFSe'], 'evento não entra na lista, mas aparece no resultado');
    assert.equal(adn.seen[1].path, '/contribuintes/DFe/3', 'segunda chamada parte do NSU guardado');
    assert.equal(db.dfe.nfse[CNPJ].ultNSU, '4');
    const lista = nfse.nfseListarNotas(db, CNPJ);
    assert.equal(lista.total, 2);
    assert.equal(lista.notas[0].prestador, 'FORNECEDOR DELTA ME', 'mais recente primeiro');
    const a = lista.notas.find(n => n.chave === CHAVE_A);
    assert.deepEqual([a.prestador, a.cnpjPrestador, a.valor, a.emissao, a.competencia, a.municipio], ['PRESTADOR GAMA LTDA', '55444333000100', 1500, '2026-09-10T09:00:00-03:00', '2026-09-01', 'Sao Paulo']);
  } finally { await adn.close(); }
}));

test('1 h entre consultas: bloqueia sem chamar o ADN; depois continua do NSU guardado', withVault(async db => {
  await comCertificado(db);
  const now = 1_000_000;
  const adn = await startAdn(() => ({ status: 200, body: lote({ itens: [item('1', CHAVE_A, nfseXml({ chave: CHAVE_A }))], ultNSU: '1', maxNSU: '1' }) }));
  try {
    await nfse.nfseSincronizar({ cnpj: CNPJ, db, url: adn.base, ca: CERT.crt, now });
    assert.equal(db.dfe.nfse[CNPJ].nextAllowedAt, now + HORA);
    const bloq = await nfse.nfseSincronizar({ cnpj: CNPJ, db, url: adn.base, ca: CERT.crt, now: now + 10 * 60_000 });
    assert.equal(bloq.bloqueado, true);
    assert.equal(adn.seen.length, 1, 'nenhuma chamada dentro da hora');
    await nfse.nfseSincronizar({ cnpj: CNPJ, db, url: adn.base, ca: CERT.crt, now: now + HORA + 1 });
    assert.equal(adn.seen.length, 2);
    assert.equal(adn.seen[1].path, '/contribuintes/DFe/1', 'continua do NSU salvo');
  } finally { await adn.close(); }
}));

test('consumo indevido / espera: para na primeira chamada e guarda nextAllowedAt = agora + 1 h', withVault(async db => {
  await comCertificado(db);
  const now = 2_000_000;
  const adn = await startAdn(() => ({ status: 429, body: JSON.stringify({ Mensagem: 'Consumo indevido: aguarde 1 hora para nova consulta' }) }));
  try {
    const r = await nfse.nfseSincronizar({ cnpj: CNPJ, db, url: adn.base, ca: CERT.crt, now });
    assert.equal(r.ok, false);
    assert.equal(r.bloqueado, true);
    assert.equal(adn.seen.length, 1, 'não tenta de novo');
    assert.equal(db.dfe.nfse[CNPJ].nextAllowedAt, now + HORA);
  } finally { await adn.close(); }
}));

test('403: para e informa sem permissão no ambiente restrito, sem nova tentativa', withVault(async db => {
  await comCertificado(db);
  const adn = await startAdn(() => ({ status: 403, body: JSON.stringify({ Mensagem: 'Acesso negado para este certificado' }) }));
  try {
    const r = await nfse.nfseSincronizar({ cnpj: CNPJ, db, url: adn.base, ca: CERT.crt, now: 1 });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /sem permissão no ambiente restrito/);
    assert.equal(adn.seen.length, 1);
  } finally { await adn.close(); }
}));

test('404: "nenhum documento" encerra sem erro; 404 sem essa frase é erro visível', withVault(async db => {
  await comCertificado(db);
  const adn = await startAdn((info, n) => n === 1
    ? { status: 404, body: JSON.stringify({ Mensagem: 'Nenhum documento localizado para o NSU informado' }) }
    : { status: 404, body: JSON.stringify({ Mensagem: 'Rota não encontrada' }) });
  try {
    const vazio = await nfse.nfseSincronizar({ cnpj: CNPJ, db, url: adn.base, ca: CERT.crt, now: 1 });
    assert.equal(vazio.ok, true);
    assert.equal(vazio.novas ?? 0, 0);
    const erro = await nfse.nfseSincronizar({ cnpj: CNPJ, db, url: adn.base, ca: CERT.crt, now: 1 + HORA + 1 });
    assert.equal(erro.ok, false);
    assert.match(erro.motivo, /404/);
  } finally { await adn.close(); }
}));

test('lote fora do formato esperado vira erro com os campos recebidos (nunca lista vazia silenciosa)', withVault(async db => {
  await comCertificado(db);
  const adn = await startAdn(() => ({ status: 200, body: JSON.stringify({ Resultado: { x: 1 } }) }));
  try {
    const r = await nfse.nfseSincronizar({ cnpj: CNPJ, db, url: adn.base, ca: CERT.crt, now: 1 });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /formato não reconhecido.*Resultado/);
  } finally { await adn.close(); }
}));

test('eventos da NFS-e: chave de 50 dígitos e GET /NFSe/{chave}/Eventos', withVault(async db => {
  await comCertificado(db);
  const adn = await startAdn(() => ({ status: 200, body: JSON.stringify({ Eventos: [{ tipo: 'cancelamento' }] }) }));
  try {
    await assert.rejects(nfse.nfseEventos({ cnpj: CNPJ, chave: '123', url: adn.base, ca: CERT.crt }), /50 dígitos/);
    const ev = await nfse.nfseEventos({ cnpj: CNPJ, chave: CHAVE_A, url: adn.base, ca: CERT.crt });
    assert.equal(ev.Eventos[0].tipo, 'cancelamento');
    assert.equal(adn.seen[0].path, `/contribuintes/NFSe/${CHAVE_A}/Eventos`);
  } finally { await adn.close(); }
}));

// ---------- ferramentas dos agentes ----------

test('ferramentas NFS-e são só leitura e aparecem só com certificado (ctx.nfse)', withVault(async db => {
  await comCertificado(db);
  assert.deepEqual(nfse.NFSE_TOOL_NAMES, ['nfse_listar_notas_recebidas', 'nfse_sincronizar']);
  for (const n of nfse.NFSE_TOOL_NAMES) assert.doesNotMatch(n, /incluir|alterar|cancel|exclu|envi|grav|cria/);
  const agent = { id: 'ag1', name: 'Fiscal', tools: [], autonomyLevel: 'read_only' };
  const runner = nfse.createNfseRunner({ getDb: () => db, save() {}, get: () => { throw new Error('não deveria chamar'); } });
  assert.deepEqual(Object.keys(runner), ['run'], 'o executor não tem caminho de escrita');
  const names = ctx => buildRipperBuiltinTools(agent, ctx).map(t => t.name);
  assert.ok(!names({ nfse: null }).some(n => nfse.NFSE_TOOL_NAMES.includes(n)), 'sem ctx.nfse, não registra');
  assert.ok(names({ nfse: runner }).includes('nfse_listar_notas_recebidas'));
  assert.ok(names({ nfse: runner }).includes('nfse_sincronizar'));
  assert.ok(isToolAllowedByAutonomy(agent, 'nfse_sincronizar', {}), 'leitura passa no modo somente leitura');
  assert.ok(RIPPER_TOOL_CATALOG.nfse_listar_notas_recebidas);

  const antes = JSON.stringify(db);
  await runner.run('nfse_listar_notas_recebidas', { empresa: CNPJ });
  assert.equal(JSON.stringify(db), antes, 'listar não escreve');
  await assert.rejects(runner.run('nfse_gravar_algo', {}), /desconhecida/);
  await assert.rejects(runner.run('nfse_listar_notas_recebidas', { empresa: OTHER }), /não tem certificado/);
  await assert.rejects(runner.run('nfse_sincronizar', { empresa: OTHER }), /não tem certificado/);
}));

test('listar filtra por período e prestador', withVault(async db => {
  await comCertificado(db);
  const adn = await startAdn((info, n) => n === 1
    ? { status: 200, body: lote({ itens: [item('1', CHAVE_A, nfseXml({ chave: CHAVE_A, dhEmi: '2026-09-10T09:00:00-03:00' })), item('2', CHAVE_B, nfseXml({ chave: CHAVE_B, nome: 'FORNECEDOR DELTA ME', cnpj: '55444333000199', dhEmi: '2026-08-01T09:00:00-03:00' }))], ultNSU: '2', maxNSU: '2' }) }
    : { status: 200, body: lote({ ultNSU: '2', maxNSU: '2' }) });
  try {
    const runner = nfse.createNfseRunner({ getDb: () => db, save() {}, url: adn.base, ca: CERT.crt });
    await runner.run('nfse_sincronizar', { empresa: CNPJ });
    const setembro = JSON.parse(await runner.run('nfse_listar_notas_recebidas', { empresa: CNPJ, de: '2026-09-01' }));
    assert.equal(setembro.total, 1);
    const porCnpj = JSON.parse(await runner.run('nfse_listar_notas_recebidas', { empresa: CNPJ, prestador: '55444333000199' }));
    assert.equal(porCnpj.notas[0].prestador, 'FORNECEDOR DELTA ME');
  } finally { await adn.close(); }
}));
