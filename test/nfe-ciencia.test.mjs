// Ciência da Operação (evento 210210): certificado A1 de teste gerado com openssl em pasta temporária (nunca commitado).
// Receita simulada por servidor local com mTLS. Nenhuma chamada à Receita real. Chaves sintéticas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import https from 'node:https';
import { z } from 'zod';

const DATA = mkdtempSync(join(tmpdir(), 'ripper-ciencia-'));
process.env.RIPPER_DATA = DATA;
process.env.RIPPER_VAULT_KEY = 'ciencia-test-vault-key';

const vault = await import('../lib/connection-vault.mjs');
const dfe = await import('../lib/dfe.mjs');
const cien = await import('../lib/nfe-ciencia.mjs');
const { ApprovalGate } = await import('../lib/approvals.mjs');
const { buildRipperBuiltinTools, RIPPER_TOOL_CATALOG } = await import('../lib/ripper-builtin-tools.mjs');
const { isToolAllowedByAutonomy } = await import('../lib/autonomy.mjs');

const CNPJ = '11222333000181';  // sintético
const OTHER = '99888777000166'; // outra empresa, sintético
const PASS = 'senha-teste-ciencia';
const dir = mkdtempSync(join(tmpdir(), 'ripper-ciencia-certs-'));
const NOW = Date.parse('2026-10-08T12:00:00-03:00');
const DAY = 86400_000;

// Chaves sintéticas de 44 dígitos.
const K = i => String(i).padStart(44, '3');

function makeCert({ name = 'c1' } = {}) {
  const key = join(dir, `${name}.key`), crt = join(dir, `${name}.crt`), pfx = join(dir, `${name}.pfx`);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '365',
    '-subj', `/CN=TESTE LTDA:${CNPJ}/O=ICP-Brasil-TESTE`, '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  execFileSync('openssl', ['pkcs12', '-export', '-inkey', key, '-in', crt, '-out', pfx, '-passout', `pass:${PASS}`], { stdio: 'ignore' });
  const pfxBuf = readFileSync(pfx);
  return { pfx: pfxBuf, pfxBase64: pfxBuf.toString('base64'), crt: readFileSync(crt, 'utf8'), key: readFileSync(key, 'utf8') };
}

const withVault = fn => async () => {
  vault._resetVaultForTests();
  const f = join(DATA, 'connection-vault.json');
  if (existsSync(f)) rmSync(f);
  const db = { settings: {}, dfe: { certs: {}, companies: {} } };
  return fn(db);
};

/** Notas recebidas de exemplo: 1 e 2 recentes (7 dias), 3 antiga (68 dias). */
function comNotas(db) {
  const nota = (i, dhEmi) => ({ chNFe: K(i), xNome: `FORNECEDOR ${i} LTDA`, cnpjEmitente: '44555666000177', vNF: 100 * i + 0.5, dhEmi, schema: 'resNFe' });
  db.dfe.companies[CNPJ] = {
    ultNSU: '3', maxNSU: '3', nextAllowedAt: 0,
    notes: {
      [K(1)]: nota(1, '2026-10-01T10:00:00-03:00'),
      [K(2)]: nota(2, '2026-09-30T10:00:00-03:00'),
      [K(3)]: nota(3, '2026-08-01T10:00:00-03:00')
    }
  };
  return db;
}

/** Resposta do serviço de eventos (SOAP 1.2) com o infEvento do cStat dado. */
function retEvento({ chave, cStat, motivo = 'motivo' }) {
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeRecepcaoEventoResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><nfeRecepcaoEventoResult><retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote><tpAmb>2</tpAmb><verAplic>TESTE</verAplic><cOrgao>91</cOrgao><cStat>128</cStat><xMotivo>Lote processado</xMotivo><retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><verAplic>TESTE</verAplic><cOrgao>91</cOrgao><cStat>${cStat}</cStat><xMotivo>${motivo}</xMotivo><chNFe>${chave}</chNFe><tpEvento>210210</tpEvento><xEvento>Ciencia da Operacao registrada</xEvento><nSeqEvento>1</nSeqEvento><CNPJDest>${CNPJ}</CNPJDest><dhRegEvento>2026-10-08T12:00:00-03:00</dhRegEvento><nProt>123456789012345</nProt></infEvento></retEvento></retEnvEvento></nfeRecepcaoEventoResult></nfeRecepcaoEventoResponse></soap12:Body></soap12:Envelope>`;
}

/** Stub de post: cada chamada responde com o próximo cStat da fila. */
function stubPost(codigos) {
  const calls = [];
  const post = async opts => {
    calls.push(opts);
    const chave = /<chNFe>(\d{44})<\/chNFe>/.exec(opts.xml)[1];
    const fila = codigos.shift();
    if (!fila) throw new Error('chamada inesperada (stub sem resposta)');
    return { status: 200, body: retEvento({ chave, cStat: fila }) };
  };
  return { post, calls };
}

/** Aprovação simulada: devolve sim/não e guarda o que foi perguntado. */
function aprova(ok) {
  const asked = [];
  return { asked, approve: async (command, reason) => { asked.push({ command, reason }); return ok; } };
}

const sleepSpy = () => { const ms = []; return { ms, sleep: async n => { ms.push(n); } }; };

const runner = (db, extra = {}) => cien.createNfeCienciaRunner({ getDb: () => db, now: () => NOW, approve: extra.approve, post: extra.post, sleep: extra.sleep ?? (async () => {}), record: extra.record ?? (() => {}), save: () => {}, ...extra });

// ---------- aprovação ----------

test('sem aprovação, nada é enviado: negada ou expirada', withVault(async db => {
  const c = makeCert({ name: 'neg' });
  await dfe.saveCertificate(db, CNPJ, { pfxBase64: c.pfxBase64, password: PASS });
  comNotas(db);
  // negada
  const nega = aprova(false);
  const s1 = stubPost([]);
  const audit = [];
  const r1 = await runner(db, { approve: nega.approve, post: s1.post, record: m => audit.push(m) }).run('nfe_manifestar_ciencia', { empresa: CNPJ, chaves: [K(1)] });
  assert.match(r1, /NÃO aprovou/);
  assert.equal(s1.calls.length, 0, 'negada: nenhuma chamada à Receita');
  assert.equal(db.dfe.companies[CNPJ].notes[K(1)].ciencia, undefined, 'negada: nota não marcada');
  assert.equal(audit[0].ok, false);
  // expirada (gate real com prazo curto: sem resposta do dono = expirou = não aprovado)
  const gate = new ApprovalGate({ timeoutMs: 20 });
  const expira = async (command, reason) => (await gate.request({ id: 'x', command, reason })).status === 'approved';
  const s2 = stubPost([]);
  const r2 = await runner(db, { approve: expira, post: s2.post }).run('nfe_manifestar_ciencia', { empresa: CNPJ, chaves: [K(1)] });
  assert.match(r2, /NÃO aprovou/);
  assert.equal(s2.calls.length, 0, 'expirada: nenhuma chamada à Receita');
}));

test('a aprovação mostra a lista em português e a frase exata sobre a ciência; só depois envia', withVault(async db => {
  const c = makeCert({ name: 'ok' });
  await dfe.saveCertificate(db, CNPJ, { pfxBase64: c.pfxBase64, password: PASS });
  comNotas(db);
  const ap = aprova(true);
  const s = stubPost([135, 136]);
  const r = JSON.parse(await runner(db, { approve: ap.approve, post: s.post }).run('nfe_manifestar_ciencia', { empresa: CNPJ, chaves: [K(1), K(2)] }));
  assert.equal(ap.asked.length, 1, 'uma aprovação para o lote');
  assert.ok(ap.asked[0].reason.includes('Ciência da Operação (210210), registra que você reconhece a nota; não confirma a compra'));
  assert.ok(ap.asked[0].command.includes(K(1)) && ap.asked[0].command.includes('FORNECEDOR 2 LTDA'), 'lista chave e emitente');
  assert.equal(r.ok, true);
  assert.equal(s.calls.length, 2, 'depois da aprovação, um evento por nota');
}));

// ---------- entrada ----------

test('lote com no máximo 20 chaves: 21 é recusado sem pedir aprovação nem enviar', withVault(async db => {
  const c = makeCert({ name: 'lote' });
  await dfe.saveCertificate(db, CNPJ, { pfxBase64: c.pfxBase64, password: PASS });
  comNotas(db);
  const ap = aprova(true);
  const s = stubPost([]);
  const chaves21 = Array.from({ length: 21 }, (_, i) => K(100 + i));
  const r = await runner(db, { approve: ap.approve, post: s.post }).run('nfe_manifestar_ciencia', { empresa: CNPJ, chaves: chaves21 });
  assert.match(r, /máximo é 20/);
  assert.equal(ap.asked.length + s.calls.length, 0);
  const schema = z.object(RIPPER_TOOL_CATALOG.nfe_manifestar_ciencia.inputSchema);
  assert.equal(schema.safeParse({ empresa: CNPJ, chaves: chaves21 }).success, false, 'o contrato também recusa 21');
  assert.equal(schema.safeParse({ empresa: CNPJ, chaves: Array.from({ length: 20 }, (_, i) => K(100 + i)) }).success, true, '20 passam');
}));

test('só notas recebidas da empresa e emitidas nos últimos 30 dias; qualquer uma fora → nada é enviado', withVault(async db => {
  const c = makeCert({ name: 'janela' });
  await dfe.saveCertificate(db, CNPJ, { pfxBase64: c.pfxBase64, password: PASS });
  comNotas(db);
  const ap = aprova(true);
  const s = stubPost([]);
  const r = await runner(db, { approve: ap.approve, post: s.post }).run('nfe_manifestar_ciencia', { empresa: CNPJ, chaves: [K(1), K(3)] });
  assert.match(r, /Nada foi enviado/);
  assert.match(r, new RegExp(`${K(3)}: emitida há mais de 30 dias`));
  const desconhecida = await runner(db, { approve: ap.approve, post: s.post }).run('nfe_manifestar_ciencia', { empresa: CNPJ, chaves: [K(999)] });
  assert.match(desconhecida, /não está entre as NF-e recebidas/);
  assert.equal(ap.asked.length, 0, 'recusada antes da aprovação');
  assert.equal(s.calls.length, 0);
  await assert.rejects(runner(db, { approve: ap.approve, post: s.post }).run('nfe_manifestar_ciencia', { empresa: OTHER, chaves: [K(1)] }), /não tem certificado/);
  assert.equal(ap.asked.length, 0, 'sem certificado: nem pergunta');
}));

// ---------- envelope ----------

test('envelope do evento 210210: Id, cOrgao 91, tpAmb, CNPJ, chave, sequência 1 e descrição', () => {
  const xml = cien.eventoCienciaEnvelope({ chave: K(1), cnpj: CNPJ, tpAmb: 2, now: NOW });
  assert.match(xml, new RegExp(`<infEvento Id="ID210210${K(1)}01">`));
  assert.match(xml, /<cOrgao>91<\/cOrgao><tpAmb>2<\/tpAmb><CNPJ>11222333000181<\/CNPJ>/);
  assert.match(xml, new RegExp(`<chNFe>${K(1)}</chNFe>`));
  assert.match(xml, /<dhEvento>2026-10-08T12:00:00-03:00<\/dhEvento><tpEvento>210210<\/tpEvento><nSeqEvento>1<\/nSeqEvento>/);
  assert.match(xml, /<detEvento versao="1\.00"><descEvento>Ciencia da Operacao<\/descEvento>/);
  assert.match(xml, /<envEvento xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe" versao="1\.00">/);
  assert.equal((xml.match(/<evento /g) || []).length, 1, 'um evento por envelope');
  assert.equal(cien.nfeEventoUrl(1), 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx');
});

// ---------- cStat ----------

test('135, 136 e 573 contam como sucesso e marcam a nota como manifestada', withVault(async db => {
  const c = makeCert({ name: 'sucesso' });
  await dfe.saveCertificate(db, CNPJ, { pfxBase64: c.pfxBase64, password: PASS });
  comNotas(db);
  const ap = aprova(true);
  const s = stubPost([135, 136, 573]);
  const sl = sleepSpy();
  const r = JSON.parse(await runner(db, { approve: ap.approve, post: s.post, sleep: sl.sleep }).run('nfe_manifestar_ciencia', { empresa: CNPJ, chaves: [K(1), K(2), K(1000)].slice(0, 2) }));
  assert.equal(r.ok, true);
  assert.equal(db.dfe.companies[CNPJ].notes[K(1)].ciencia, true);
  assert.equal(db.dfe.companies[CNPJ].notes[K(1)].cienciaEm, NOW);
  assert.equal(db.dfe.companies[CNPJ].notes[K(2)].ciencia, true);
  const s2 = stubPost([573]);
  const r2 = JSON.parse(await runner(db, { approve: aprova(true).approve, post: s2.post }).run('nfe_manifestar_ciencia', { empresa: CNPJ, chaves: [K(2)] }));
  assert.equal(r2.ok, true, '573 é sucesso');
  assert.equal(r2.resultados[0].cStat, '573');
}));

test('rejeição (ex.: 215) para no primeiro erro: a segunda nota não sai; o erro é reportado por chave', withVault(async db => {
  const c = makeCert({ name: 'erro' });
  await dfe.saveCertificate(db, CNPJ, { pfxBase64: c.pfxBase64, password: PASS });
  comNotas(db);
  db.dfe.companies[CNPJ].notes[K(3)] = { ...db.dfe.companies[CNPJ].notes[K(3)], dhEmi: '2026-10-05T10:00:00-03:00' };
  const ap = aprova(true);
  const s = stubPost([135, 215]);
  const audit = [];
  const sl = sleepSpy();
  const r = JSON.parse(await runner(db, { approve: ap.approve, post: s.post, sleep: sl.sleep, record: m => audit.push(m) }).run('nfe_manifestar_ciencia', { empresa: CNPJ, chaves: [K(1), K(3), K(2)] }));
  assert.equal(r.ok, false);
  assert.equal(r.parouEm, K(3));
  assert.deepEqual(r.naoEnviadas, [K(2)]);
  assert.equal(s.calls.length, 2, 'a terceira nota não foi enviada');
  assert.equal(r.resultados[1].cStat, '215');
  assert.equal(db.dfe.companies[CNPJ].notes[K(3)].ciencia, undefined, 'a nota com erro não é marcada');
  assert.equal(db.dfe.companies[CNPJ].notes[K(1)].ciencia, true);
  assert.equal(audit.length, 2, 'uma entrada de auditoria por tentativa');
  assert.equal(audit[1].ok, false);
}));

test('pausa de 3 s entre eventos (não antes do primeiro)', withVault(async db => {
  const c = makeCert({ name: 'pausa' });
  await dfe.saveCertificate(db, CNPJ, { pfxBase64: c.pfxBase64, password: PASS });
  comNotas(db);
  const sl = sleepSpy();
  const s = stubPost([135, 135]);
  await runner(db, { approve: aprova(true).approve, post: s.post, sleep: sl.sleep, pausaMs: 3000 }).run('nfe_manifestar_ciencia', { empresa: CNPJ, chaves: [K(1), K(2)] });
  assert.deepEqual(sl.ms, [3000]);
}));

// ---------- auditoria sem segredos ----------

test('auditoria: uma entrada por tentativa, sem certificado nem senha', withVault(async db => {
  const c = makeCert({ name: 'audit' });
  await dfe.saveCertificate(db, CNPJ, { pfxBase64: c.pfxBase64, password: PASS });
  comNotas(db);
  const audit = [];
  const s = stubPost([135]);
  await runner(db, { approve: aprova(true).approve, post: s.post, record: m => audit.push(m) }).run('nfe_manifestar_ciencia', { empresa: CNPJ, chaves: [K(1)] });
  assert.equal(audit.length, 1);
  assert.equal(audit[0].kind, 'nfe.ciencia');
  assert.equal(audit[0].approved, 'user');
  assert.equal(audit[0].ok, true);
  const texto = JSON.stringify(audit) + JSON.stringify(db.dfe.companies);
  assert.ok(!texto.includes(PASS), 'sem senha');
  assert.ok(!texto.includes(c.pfxBase64.slice(0, 40)), 'sem pfx');
  assert.ok(!texto.includes('PRIVATE KEY'), 'sem chave privada');
}));

// ---------- mTLS de ponta a ponta ----------

test('mTLS: o A1 da empresa vai como cliente TLS; SOAPAction do evento; sem pausa antes do primeiro', withVault(async db => {
  const c = makeCert({ name: 'mtls' });
  await dfe.saveCertificate(db, CNPJ, { pfxBase64: c.pfxBase64, password: PASS });
  comNotas(db);
  const seen = {};
  const server = https.createServer({ key: c.key, cert: c.crt, requestCert: true, rejectUnauthorized: true, ca: [c.crt] }, (req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      seen.cn = req.socket.getPeerCertificate().subject?.CN;
      seen.authorized = req.socket.authorized;
      seen.path = req.url;
      seen.ctype = req.headers['content-type'];
      seen.body = body;
      const chave = /<chNFe>(\d{44})<\/chNFe>/.exec(body)[1];
      res.writeHead(200, { 'content-type': 'application/soap+xml; charset=utf-8' });
      res.end(retEvento({ chave, cStat: '135' }));
    });
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  try {
    const url = `https://127.0.0.1:${server.address().port}/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx`;
    const r = JSON.parse(await runner(db, { approve: aprova(true).approve, url, ca: c.crt, sleep: sleepSpy().sleep }).run('nfe_manifestar_ciencia', { empresa: CNPJ, chaves: [K(1)], tpAmb: 2 }));
    assert.equal(r.ok, true);
    assert.equal(seen.authorized, true, 'cliente autenticado pelo certificado');
    assert.equal(seen.cn, 'TESTE LTDA:' + CNPJ);
    assert.equal(seen.path, '/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx');
    assert.match(seen.ctype, /application\/soap\+xml/);
    assert.match(seen.ctype, /NFeRecepcaoEvento4\/nfeRecepcaoEvento/);
    assert.match(seen.body, /<nfeRecepcaoEvento /);
    assert.match(seen.body, /<tpAmb>2<\/tpAmb>/);
  } finally {
    await new Promise(ok => server.close(ok));
  }
}));

// ---------- ferramenta registrada só com certificado; autonomia ----------

test('a ferramenta só é registrada com o executor (certificado cadastrado) e fica bloqueada no modo somente leitura', withVault(async db => {
  const c = makeCert({ name: 'reg' });
  await dfe.saveCertificate(db, CNPJ, { pfxBase64: c.pfxBase64, password: PASS });
  const agent = { id: 'ag1', name: 'Fiscal', tools: [], autonomyLevel: 'semi_autonomous' };
  const ro = { id: 'ag2', name: 'Leitor', tools: [], autonomyLevel: 'read_only' };
  const names = ctx => buildRipperBuiltinTools(agent, ctx).map(t => t.name);
  assert.ok(!names({ nfeCiencia: null }).includes('nfe_manifestar_ciencia'), 'sem executor, não registra');
  assert.ok(names({ nfeCiencia: runner(db, { approve: aprova(true).approve }) }).includes('nfe_manifestar_ciencia'));
  assert.equal(isToolAllowedByAutonomy(ro, 'nfe_manifestar_ciencia', {}), false, 'escrita: bloqueada em somente leitura');
  assert.ok(!buildRipperBuiltinTools(ro, { nfeCiencia: runner(db, { approve: aprova(true).approve }) }).some(t => t.name === 'nfe_manifestar_ciencia'), 'e não aparece para agente somente leitura');
  assert.deepEqual(cien.NFE_CIENCIA_TOOL_NAMES, ['nfe_manifestar_ciencia']);
}));

test('sem certificado: o executor recusa e nunca pergunta', withVault(async db => {
  comNotas(db);
  const ap = aprova(true);
  assert.deepEqual(dfe.dfeCompanies(db), []);
  await assert.rejects(runner(db, { approve: ap.approve, post: stubPost([]).post }).run('nfe_manifestar_ciencia', { empresa: CNPJ, chaves: [K(1)] }), /não tem certificado/);
  assert.equal(ap.asked.length, 0);
}));

// ---------- assinatura antes do envio; URLs confirmadas no Portal da NF-e ----------

test('o envio sempre leva o evento assinado (infEvento + Signature válidos) e a URL de homologação confere', withVault(async db => {
  const { verificaAssinatura } = await import('./helpers/xmldsig.mjs');
  const c = makeCert({ name: 'assina' });
  await dfe.saveCertificate(db, CNPJ, { pfxBase64: c.pfxBase64, password: PASS });
  comNotas(db);
  const s = stubPost([135]);
  const r = JSON.parse(await runner(db, { approve: aprova(true).approve, post: s.post }).run('nfe_manifestar_ciencia', { empresa: CNPJ, chaves: [K(1)], tpAmb: 2 }));
  assert.equal(r.ok, true);
  assert.equal(s.calls.length, 1);
  const v = verificaAssinatura(s.calls[0].xml);
  assert.equal(v.ok, true, 'assinatura válida no XML enviado');
  assert.equal(v.id, `ID210210${K(1)}01`);
  assert.equal(s.calls[0].url, 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx');
  assert.equal(cien.nfeEventoUrl(2), 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx');
  assert.equal(cien.nfeEventoUrl(1), 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx');
}));
