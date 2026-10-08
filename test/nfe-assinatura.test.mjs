// Assinatura XMLDSig do infEvento (NF-e, evento 210210). Certificado sintético gerado com openssl em pasta temporária.
// Sem rede: nada chama a Receita. Verificação pela chave pública do próprio certificado (helpers/xmldsig.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verificaAssinatura } from './helpers/xmldsig.mjs';

const { loadSigningCredential, assinarInfEvento, c14nInfEvento } = await import('../lib/nfe-assinatura.mjs');
const { eventoCienciaEnvelope } = await import('../lib/nfe-ciencia.mjs');
const { DfeError } = await import('../lib/dfe.mjs');

const CNPJ = '11222333000181'; // sintético
const PASS = 'senha-teste-assinatura';
const K = '3'.repeat(44);
const NOW = Date.parse('2026-10-08T12:00:00-03:00');
const dir = mkdtempSync(join(tmpdir(), 'ripper-assinatura-'));

function makePfx(name, { password = PASS, extra = [] } = {}) {
  const key = join(dir, `${name}.key`), crt = join(dir, `${name}.crt`), pfx = join(dir, `${name}.pfx`);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '30',
    '-subj', `/CN=TESTE LTDA:${CNPJ}/O=ICP-Brasil-TESTE`], { stdio: 'ignore' });
  execFileSync('openssl', ['pkcs12', '-export', ...extra, '-inkey', key, '-in', crt, '-out', pfx, '-passout', `pass:${password}`], { stdio: 'ignore' });
  return { pfx: readFileSync(pfx), crt: readFileSync(crt, 'utf8') };
}

const c = makePfx('a1');

test('aceita .pfx com cifra legada (3DES/RC2, como em certificados A1 mais antigos)', () => {
  const legado = makePfx('legado', { extra: ['-legacy'] });
  const cred = loadSigningCredential(legado.pfx, PASS);
  const xml = eventoCienciaEnvelope({ chave: K, cnpj: CNPJ, tpAmb: 2, now: NOW, assinar: inf => assinarInfEvento(inf, cred) });
  assert.equal(verificaAssinatura(xml).ok, true);
});

test('assina o infEvento: digest e RSA-SHA1 conferem com a chave pública do certificado', async () => {
  const cred = loadSigningCredential(c.pfx, PASS);
  const xml = eventoCienciaEnvelope({ chave: K, cnpj: CNPJ, tpAmb: 2, now: NOW, assinar: inf => assinarInfEvento(inf, cred) });
  const v = verificaAssinatura(xml);
  assert.equal(v.digestOk, true, 'digest SHA-1 do infEvento (C14N)');
  assert.equal(v.sigOk, true, 'RSA-SHA1 do SignedInfo');
  assert.equal(v.referenceOk, true, 'Reference URI = #ID210210 + chave + 01');
  assert.equal(v.id, `ID210210${K}01`);
  // O Signature é irmão do infEvento dentro de <evento>, como o schema pede (ds:Signature depois de infEvento).
  assert.match(xml, /<\/infEvento><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">/);
  // Só o certificado do usuário final vai no KeyInfo (EndCertOnly, MOC 7.0 Tabela 4-2).
  assert.equal((xml.match(/<X509Certificate>/g) || []).length, 1);
  assert.equal(v.cert.subject.includes(`TESTE LTDA:${CNPJ}`), true);
});

test('adulterar o infEvento depois de assinar quebra a assinatura', () => {
  const cred = loadSigningCredential(c.pfx, PASS);
  const xml = eventoCienciaEnvelope({ chave: K, cnpj: CNPJ, tpAmb: 2, now: NOW, assinar: inf => assinarInfEvento(inf, cred) });
  const adulterado = xml.replace('<tpAmb>2</tpAmb>', '<tpAmb>1</tpAmb>');
  const v = verificaAssinatura(adulterado);
  assert.equal(v.digestOk, false, 'o digest deixa de bater');
  assert.equal(v.ok, false);
});

test('senha errada é recusada, sem vazar a senha na mensagem', () => {
  assert.throws(() => loadSigningCredential(c.pfx, 'senha-errada'), err => {
    assert.ok(err instanceof DfeError);
    assert.match(err.message, /Senha incorreta/);
    assert.ok(!err.message.includes('senha-errada'));
    return true;
  });
});

test('c14n do infEvento põe o namespace padrão da NF-e e exige Id', () => {
  assert.equal(c14nInfEvento(`<infEvento Id="ID1">x</infEvento>`), `<infEvento xmlns="http://www.portalfiscal.inf.br/nfe" Id="ID1">x</infEvento>`);
  assert.throws(() => c14nInfEvento('<infEvento>x</infEvento>'), /sem Id/);
});
