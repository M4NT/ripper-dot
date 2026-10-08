// NF-e recebidas (DF-e): certificado A1 de teste gerado com openssl em pasta temporária (nunca commitado),
// Receita simulada por servidor local. Nenhuma chamada à Receita real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import https from 'node:https';
import { gzipSync } from 'node:zlib';
import { X509Certificate } from 'node:crypto';

const DATA = mkdtempSync(join(tmpdir(), 'ripper-dfe-'));
process.env.RIPPER_DATA = DATA;
process.env.RIPPER_VAULT_KEY = 'dfe-test-vault-key';

const vault = await import('../lib/connection-vault.mjs');
const dfe = await import('../lib/dfe.mjs');
const { buildRipperBuiltinTools, RIPPER_TOOL_CATALOG } = await import('../lib/ripper-builtin-tools.mjs');
const { isToolAllowedByAutonomy } = await import('../lib/autonomy.mjs');

const CNPJ = '11222333000181';   // sintético
const ROOT_CNPJ = '11222333000199'; // mesma raiz (filial)
const OTHER = '99888777000166';  // outra empresa, sintético
const PASS = 'senha-teste-1';
const DAY = 86400_000;
const dir = mkdtempSync(join(tmpdir(), 'ripper-dfe-certs-'));

/** Certificado de teste: CN "TESTE LTDA:<cnpj>" como no ICP-Brasil; PFX com senha PASS. */
function makeCert({ cnpj = CNPJ, name = 'c1', days = 365 } = {}) {
  const key = join(dir, `${name}.key`), crt = join(dir, `${name}.crt`), pfx = join(dir, `${name}.pfx`);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', String(days),
    '-subj', `/CN=TESTE LTDA:${cnpj}/O=ICP-Brasil-TESTE`, '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  execFileSync('openssl', ['pkcs12', '-export', '-inkey', key, '-in', crt, '-out', pfx, '-passout', `pass:${PASS}`], { stdio: 'ignore' });
  const pfxBuf = readFileSync(pfx);
  return { pfx: pfxBuf, pfxBase64: pfxBuf.toString('base64'), crt: readFileSync(crt, 'utf8'), key: readFileSync(key, 'utf8') };
}

const freshDb = () => ({ settings: {} });
const withVault = fn => async () => {
  vault._resetVaultForTests();
  const db = freshDb();
  const f = join(DATA, 'connection-vault.json');
  if (existsSync(f)) rmSync(f);
  return fn(db);
};

// Documentos de exemplo (XML sintéticos) em cada layout.
const NFE_ID = '35260911222333000181550010000000011000000019';
const resNFe = `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe"><chNFe>${NFE_ID}</chNFe><CNPJ>44555666000177</CNPJ><xNome>FORNECEDOR ALFA LTDA</xNome><vNF>1234.56</vNF><dhEmi>2026-09-15T10:00:00-03:00</dhEmi></resNFe>`;
const procNFe = `<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${NFE_ID.replace(/0000000011000000019$/, '0000000011000000020')}" versao="4.00"><ide><dhEmi>2026-09-20T08:30:00-03:00</dhEmi><NFref><refNFe>${NFE_ID}</refNFe></NFref></ide><emit><CNPJ>77888999000122</CNPJ><xNome>FORNECEDOR BETA S/A</xNome></emit><dest><CNPJ>${CNPJ}</CNPJ><xNome>TESTE LTDA</xNome></dest><total><ICMSTot><vNF>987.65</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
const layoutNovo = `<?xml version="1.0"?><proc2026 xmlns="x"><algo>sem chave</algo></proc2026>`;
const gz = s => gzipSync(Buffer.from(s, 'utf8')).toString('base64');

/** Resposta retDistDFeInt (SOAP 1.2) com o lote de docZip. */
function retorno({ cStat = '138', motivo = 'Documento localizado', ultNSU = '000000000000001', maxNSU = '000000000000001', docs = [] } = {}) {
  const lote = docs.map(d => `<docZip NSU="${d.nsu}" schema="${d.schema || 'resNFe_v1.01.xsd'}">${gz(d.xml)}</docZip>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDistDFeInteresseResult><retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>2</tpAmb><verAplic>TESTE</verAplic><cStat>${cStat}</cStat><xMotivo>${motivo}</xMotivo><dhResp>2026-10-08T10:00:00-03:00</dhResp><ultNSU>${ultNSU}</ultNSU><maxNSU>${maxNSU}</maxNSU>${lote ? `<loteDistDFeInt>${lote}</loteDistDFeInt>` : ''}</retDistDFeInt></nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap12:Body></soap12:Envelope>`;
}

/** Stub de post: recebe a chamada e devolve a próxima resposta da fila. */
function stubPost(respostas) {
  const calls = [];
  const post = async opts => {
    calls.push(opts);
    const r = respostas.shift();
    if (!r) throw new Error('chamada inesperada à Receita (stub sem resposta)');
    return { status: 200, body: r };
  };
  return { post, calls };
}

// ---------- certificado ----------

test('senha errada é recusada e nada é guardado', withVault(async db => {
  const c = makeCert({ name: 'senha' });
  await assert.rejects(dfe.saveCertificate(db, CNPJ, { pfxBase64: c.pfxBase64, password: 'errada' }), /Senha incorreta/);
  assert.deepEqual(dfe.certificadosList(db), []);
  assert.equal(vault.listVaultEntries().entries.length, 0);
}));

test('CNPJ de outra empresa é recusado; a raiz de 8 dígitos (filial) vale', withVault(async db => {
  const c = makeCert({ name: 'cnpj' });
  await assert.rejects(dfe.saveCertificate(db, OTHER, { pfxBase64: c.pfxBase64, password: PASS }), /outra empresa/);
  assert.equal(dfe.certificadosList(db).length, 0);
  const ok = await dfe.saveCertificate(db, ROOT_CNPJ, { pfxBase64: c.pfxBase64, password: PASS });
  assert.equal(ok.titular, 'TESTE LTDA');
}));

test('certificado vencido é recusado', withVault(async db => {
  const c = makeCert({ name: 'venc', days: 1 });
  const validTo = Date.parse(dfe.certificateInfo(new X509Certificate(c.crt)).validTo);
  await assert.rejects(dfe.saveCertificate(db, CNPJ, { pfxBase64: c.pfxBase64, password: PASS, now: validTo + DAY }), /venceu/);
  assert.equal(dfe.certificadosList(db).length, 0);
}));

test('certificado bom: guardado cifrado, sem pfx nem senha em claro; status calculado', withVault(async db => {
  const c = makeCert({ name: 'bom' });
  const meta = await dfe.saveCertificate(db, CNPJ, { pfxBase64: c.pfxBase64, password: PASS });
  assert.equal(meta.status, 'ok');
  assert.equal(meta.cnpj, CNPJ);
  const vaultText = readFileSync(join(DATA, 'connection-vault.json'), 'utf8');
  assert.ok(!vaultText.includes(c.pfxBase64.slice(0, 40)), 'pfx não aparece em claro no cofre');
  assert.ok(!vaultText.includes(PASS), 'senha não aparece no cofre');
  assert.ok(!JSON.stringify(db).includes(PASS) && !JSON.stringify(db).includes(c.pfxBase64.slice(0, 40)), 'db sem segredo');
  assert.ok(!JSON.stringify(dfe.certificadosList(db)).includes(PASS), 'listagem sem senha');
  assert.deepEqual(dfe.loadCertificate(CNPJ).pfx, c.pfx, 'o servidor recupera o pfx para o mTLS');
  // status: vence em menos de 30 dias e vencido
  const validTo = Date.parse(meta.validTo);
  assert.equal(dfe.certificateStatus({ validTo: new Date(validTo).toISOString() }, validTo - 10 * DAY).status, 'vence_em_breve');
  assert.equal(dfe.certificateStatus({ validTo: new Date(validTo).toISOString() }, validTo + DAY).status, 'vencido');
  assert.equal(dfe.certificateAlerts(db, validTo - 10 * DAY).length, 1);
  assert.equal(dfe.removeCertificate(db, CNPJ), true);
  assert.equal(dfe.certificadosList(db).length, 0);
  assert.throws(() => dfe.loadCertificate(CNPJ), /não tem certificado/);
}));

// ---------- protocolo ----------

test('envelope SOAP do nfeDistDFeInteresse: tpAmb, cUFAutor, CNPJ e ultNSU de 15 dígitos', () => {
  const xml = dfe.dfeEnvelope({ cnpj: CNPJ, ultNSU: '42', tpAmb: 2 });
  assert.match(xml, /<nfeDistDFeInteresse xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe\/wsdl\/NFeDistribuicaoDFe">/);
  assert.match(xml, /<distDFeInt xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe" versao="1\.01">/);
  assert.match(xml, /<tpAmb>2<\/tpAmb><cUFAutor>35<\/cUFAutor><CNPJ>11222333000181<\/CNPJ>/);
  assert.match(xml, /<distNSU><ultNSU>000000000000042<\/ultNSU><\/distNSU>/);
  assert.equal(dfe.dfeUrl(2), 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx');
  assert.equal(dfe.dfeUrl(1), 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx');
});

test('docZip: decodifica resNFe, nfeProc e layout desconhecido (visível em schema)', () => {
  const a = dfe.extractNota(dfe.decodeDocZip(gz(resNFe)));
  assert.deepEqual([a.chNFe, a.xNome, a.vNF, a.dhEmi, a.schema], [NFE_ID, 'FORNECEDOR ALFA LTDA', 1234.56, '2026-09-15T10:00:00-03:00', 'resNFe']);
  const b = dfe.extractNota(dfe.decodeDocZip(gz(procNFe)));
  assert.equal(b.schema, 'nfeProc');
  assert.equal(b.xNome, 'FORNECEDOR BETA S/A', 'nome do emitente, não do destinatário');
  assert.equal(b.cnpjEmitente, '77888999000122');
  assert.equal(b.vNF, 987.65);
  assert.equal(b.dhEmi, '2026-09-20T08:30:00-03:00');
  assert.match(b.chNFe, /^\d{44}$/);
  const c = dfe.extractNota(dfe.decodeDocZip(gz(layoutNovo)));
  assert.equal(c.schema, 'desconhecido:proc2026');
  assert.equal(c.chNFe, null);
});

test('sincronização: continua do último NSU, guarda notas e não repete por chNFe', withVault(async db => {
  const c = makeCert({ name: 'sync' });
  await dfe.saveCertificate(db, CNPJ, { pfxBase64: c.pfxBase64, password: PASS });
  const { post, calls } = stubPost([
    retorno({ ultNSU: '000000000000001', maxNSU: '000000000000002', docs: [{ nsu: '000000000000001', xml: resNFe }] }),
    retorno({ ultNSU: '000000000000002', maxNSU: '000000000000002', docs: [{ nsu: '000000000000002', xml: procNFe }] })
  ]);
  const r = await dfe.dfeSincronizar({ cnpj: CNPJ, db, tpAmb: 2, post, url: 'https://invalido.local/x', now: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.novas, 2);
  assert.equal(calls.length, 2, 'para no maxNSU');
  assert.match(calls[1].xml, /<ultNSU>000000000000001<\/ultNSU>/, 'segunda chamada parte do NSU anterior');
  assert.equal(db.dfe.companies[CNPJ].ultNSU, '000000000000002', 'NSU guardado por empresa');
  // nova rodada: a Receita devolve a mesma nota (e nada novo): não duplica
  const again = stubPost([retorno({ ultNSU: '000000000000002', maxNSU: '000000000000002', docs: [{ nsu: '000000000000001', xml: resNFe }] })]);
  const r2 = await dfe.dfeSincronizar({ cnpj: CNPJ, db, tpAmb: 2, post: again.post, url: 'x', now: 2 });
  assert.equal(r2.novas, 0);
  assert.equal(r2.total, 2);
  const lista = dfe.dfeListarNotas(db, CNPJ);
  assert.equal(lista.total, 2);
  assert.equal(lista.notas[0].emitente, 'FORNECEDOR BETA S/A', 'mais recente primeiro');
}));

test('656 (consumo indevido): para, guarda nextAllowedAt = agora + 1 h e não chama de novo nesse intervalo', withVault(async db => {
  const c = makeCert({ name: 'b656' });
  await dfe.saveCertificate(db, CNPJ, { pfxBase64: c.pfxBase64, password: PASS });
  const now = 1_000_000;
  const { post, calls } = stubPost([retorno({ cStat: '656', motivo: 'Rejeição: Consumo indevido' })]);
  const r = await dfe.dfeSincronizar({ cnpj: CNPJ, db, tpAmb: 2, post, url: 'x', now });
  assert.equal(r.cStat, '656');
  assert.equal(db.dfe.companies[CNPJ].nextAllowedAt, now + dfe.DFE_HOUR);
  assert.equal(calls.length, 1);
  const r2 = await dfe.dfeSincronizar({ cnpj: CNPJ, db, tpAmb: 2, post, url: 'x', now: now + 10 * 60_000 });
  assert.equal(r2.bloqueado, true);
  assert.equal(calls.length, 1, 'nenhuma chamada dentro da hora');
  // depois de 1 h: pode consultar de novo
  const again = stubPost([retorno({ ultNSU: '000000000000000', maxNSU: '000000000000000', cStat: '137', motivo: 'Nenhum documento localizado' })]);
  const r3 = await dfe.dfeSincronizar({ cnpj: CNPJ, db, tpAmb: 2, post: again.post, url: 'x', now: now + dfe.DFE_HOUR + 1 });
  assert.equal(r3.ok, true);
  assert.equal(again.calls.length, 1);
}));

test('teto de chamadas: nunca passa de 5 chamadas numa sincronização', withVault(async db => {
  const c = makeCert({ name: 'teto' });
  await dfe.saveCertificate(db, CNPJ, { pfxBase64: c.pfxBase64, password: PASS });
  const respostas = Array.from({ length: 9 }, (_, i) => retorno({ ultNSU: String(i + 1).padStart(15, '0'), maxNSU: '000000000000999' }));
  const { post, calls } = stubPost(respostas);
  await dfe.dfeSincronizar({ cnpj: CNPJ, db, tpAmb: 2, post, url: 'x', now: 1 });
  assert.equal(calls.length, 5);
}));

test('mTLS de ponta a ponta: o certificado A1 vai como cliente TLS até uma Receita local', withVault(async db => {
  const c = makeCert({ name: 'mtls' });
  await dfe.saveCertificate(db, CNPJ, { pfxBase64: c.pfxBase64, password: PASS });
  const seen = {};
  const server = https.createServer({ key: c.key, cert: c.crt, requestCert: true, rejectUnauthorized: true, ca: [c.crt] }, (req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      seen.cn = req.socket.getPeerCertificate().subject?.CN;
      seen.authorized = req.socket.authorized;
      seen.path = req.url;
      seen.action = req.headers['content-type'];
      seen.body = body;
      res.writeHead(200, { 'content-type': 'application/soap+xml; charset=utf-8' });
      res.end(retorno({ ultNSU: '000000000000001', maxNSU: '000000000000001', docs: [{ nsu: '000000000000001', xml: resNFe }] }));
    });
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  try {
    const url = `https://127.0.0.1:${server.address().port}/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx`;
    const r = await dfe.dfeSincronizar({ cnpj: CNPJ, db, tpAmb: 2, url, ca: c.crt, now: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.novas, 1);
    assert.equal(seen.authorized, true, 'cliente autenticado pelo certificado');
    assert.equal(seen.cn, 'TESTE LTDA:' + CNPJ);
    assert.equal(seen.path, '/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx');
    assert.match(seen.action, /application\/soap\+xml/);
    assert.match(seen.body, /<nfeDistDFeInteresse/);
  } finally {
    await new Promise(ok => server.close(ok));
  }
}));

// ---------- ferramentas dos agentes ----------

test('ferramentas DF-e são só leitura e aparecem só com certificado cadastrado', withVault(async db => {
  const c = makeCert({ name: 'tools' });
  await dfe.saveCertificate(db, CNPJ, { pfxBase64: c.pfxBase64, password: PASS });
  assert.deepEqual(dfe.DFE_TOOL_NAMES, ['dfe_listar_notas_recebidas', 'dfe_sincronizar']);
  for (const n of dfe.DFE_TOOL_NAMES) assert.doesNotMatch(n, /incluir|alterar|cancel|exclu|envi|grav|cria/);
  const agent = { id: 'ag1', name: 'Fiscal', tools: [], autonomyLevel: 'read_only' };
  const runner = dfe.createDfeRunner({ getDb: () => db, save() {} });
  assert.deepEqual(Object.keys(runner), ['run'], 'o executor não tem caminho de escrita');
  const names = ctx => buildRipperBuiltinTools(agent, ctx).map(t => t.name);
  assert.ok(!names({ dfe: null }).some(n => dfe.DFE_TOOL_NAMES.includes(n)), 'sem ctx.dfe, não registra');
  assert.ok(names({ dfe: runner }).includes('dfe_listar_notas_recebidas'));
  assert.ok(names({ dfe: runner }).includes('dfe_sincronizar'));
  assert.ok(isToolAllowedByAutonomy(agent, 'dfe_sincronizar', {}), 'leitura passa até no modo somente leitura');
  assert.ok(RIPPER_TOOL_CATALOG.dfe_listar_notas_recebidas);

  // listar não altera o db
  const antes = JSON.stringify(db);
  await runner.run('dfe_listar_notas_recebidas', { empresa: CNPJ });
  assert.equal(JSON.stringify(db), antes, 'listar não escreve');
  await assert.rejects(runner.run('dfe_gravar_algo', {}), /desconhecida/);
  await assert.rejects(runner.run('dfe_listar_notas_recebidas', { empresa: OTHER }), /não tem certificado/);
}));

// ---------- rotas HTTP (servidor de verdade, mesmo padrão do teste do cofre) ----------

test('rotas /api/certificados: erro sem vazar arquivo nem senha; sucesso só com metadados; remover', async () => {
  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const { freePort } = await import('./helpers/free-port.mjs');
  const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));
  const httpDir = mkdtempSync(join(tmpdir(), 'ripper-dfe-http-'));
  const port = await freePort();
  const env = { ...process.env, RIPPER_DATA: httpDir, RIPPER_VAULT_KEY: 'dfe-http-vault-key', PORT: String(port), HOST: '127.0.0.1', RIPPER_TOKEN: 'dfe-http-token' };
  const child = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: 'Bearer dfe-http-token', 'content-type': 'application/json' };
  const c = makeCert({ name: 'http' });
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try { if ((await fetch(base + '/api/health', { headers: auth })).ok) break; } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    const bad = await fetch(`${base}/api/certificados/${CNPJ}`, { method: 'POST', headers: auth, body: JSON.stringify({ pfxBase64: c.pfxBase64, password: 'senha-errada' }) });
    const badText = await bad.text();
    assert.equal(bad.status, 400);
    assert.match(badText, /Senha incorreta/);
    assert.ok(!badText.includes(c.pfxBase64.slice(0, 40)) && !badText.includes('senha-errada'));

    const ok = await fetch(`${base}/api/certificados/${CNPJ}`, { method: 'POST', headers: auth, body: JSON.stringify({ pfxBase64: c.pfxBase64, password: PASS }) });
    const okText = await ok.text();
    assert.equal(ok.status, 200, okText);
    assert.match(okText, /TESTE LTDA/);
    assert.ok(!okText.includes(c.pfxBase64.slice(0, 40)) && !okText.includes(PASS), 'resposta sem arquivo nem senha');

    const list = await (await fetch(`${base}/api/certificados`, { headers: auth })).json();
    assert.equal(list.certificados.length, 1);
    assert.equal(list.certificados[0].status, 'ok');

    const del = await fetch(`${base}/api/certificados/${CNPJ}`, { method: 'DELETE', headers: auth });
    assert.equal(del.status, 200);
    assert.equal((await (await fetch(`${base}/api/certificados`, { headers: auth })).json()).certificados.length, 0);
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('exit', r));
  }
});
