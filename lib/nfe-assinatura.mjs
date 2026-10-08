// NF-e: assinatura XMLDSig do infEvento (evento de manifestação do destinatário, NT 2020.001 §6.3.1 e §6.3.7).
// Padrão do MOC 7.0 §4.2.4 (Tabela 4-2): RSA-SHA1, digest SHA-1, C14N 1.0, enveloped, só o certificado do usuário final.
// Só o node-forge lê o .pfx (PKCS#12); a assinatura e a verificação usam node:crypto. Nada é logado.
// ponytail: C14N só para o infEvento gerado por eventoCienciaEnvelope (sem comentários, sem entidades, atributo só Id);
// não é um C14N geral. Upgrade: trocar por uma lib C14N se o leiaute ganhar atributos ou texto com escape.
import forge from 'node-forge';
import { createHash, createSign } from 'node:crypto';
import { DfeError } from './dfe.mjs';

export const DSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';
export const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';

/** Chave privada (PEM, só em memória) e certificado da folha (DER em base64) do .pfx. Senha errada → DfeError. */
export function loadSigningCredential(pfx, passphrase) {
  let p12;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(pfx).toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, passphrase);
  } catch {
    throw new DfeError('Senha incorreta, ou o arquivo não é um certificado .pfx/.p12 válido.');
  }
  const keyBags = [...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [])];
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []).map(b => b.cert).filter(Boolean);
  const key = keyBags[0]?.key;
  // A folha é o certificado cuja chave pública é a da chave privada (não confiar na ordem do arquivo).
  const cert = key && certs.find(c => c.publicKey.n.compareTo(key.n) === 0);
  if (!key || !cert) throw new DfeError('O .pfx não traz chave privada e certificado da mesma folha.');
  return {
    privateKeyPem: forge.pki.privateKeyToPem(key),
    certB64: forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes())
  };
}

/** Forma canônica do infEvento: só o namespace padrão da NF-e no ancestral (o nfeDadosMsg é tratado como documento próprio). */
export function c14nInfEvento(inf) {
  const m = /^<infEvento Id="([^"]+)">/.exec(inf);
  if (!m) throw new DfeError('infEvento sem Id.');
  return `<infEvento xmlns="${NFE_NS}" Id="${m[1]}">` + inf.slice(m[0].length);
}

/** Bloco <Signature> para o infEvento (irmão dele dentro de <evento>, como pede o schema). */
export function assinarInfEvento(inf, cred) {
  const id = /^<infEvento Id="([^"]+)">/.exec(inf)?.[1];
  if (!id) throw new DfeError('infEvento sem Id.');
  const digest = createHash('sha1').update(c14nInfEvento(inf), 'utf8').digest('base64');
  const signedInfo = `<SignedInfo xmlns="${DSIG_NS}"><CanonicalizationMethod Algorithm="${C14N}"/>`
    + `<SignatureMethod Algorithm="${DSIG_NS}rsa-sha1"/><Reference URI="#${id}"><Transforms>`
    + `<Transform Algorithm="${DSIG_NS}enveloped-signature"/><Transform Algorithm="${C14N}"/></Transforms>`
    + `<DigestMethod Algorithm="${DSIG_NS}sha1"/><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
  const value = createSign('RSA-SHA1').update(signedInfo, 'utf8').sign(cred.privateKeyPem, 'base64');
  return `<Signature xmlns="${DSIG_NS}">${signedInfo}<SignatureValue>${value}</SignatureValue>`
    + `<KeyInfo><X509Data><X509Certificate>${cred.certB64}</X509Certificate></X509Data></KeyInfo></Signature>`;
}
