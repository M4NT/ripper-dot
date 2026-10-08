// Verificação independente da assinatura do infEvento (só node:crypto): recalcula o digest e a RSA-SHA1 com a chave pública
// do certificado que vem no próprio KeyInfo. Usado pelos testes da Ciência; nunca chama a Receita.
import { createHash, createVerify, X509Certificate } from 'node:crypto';

export function verificaAssinatura(xml) {
  const inf = /<infEvento Id="([^"]+)">[\s\S]*?<\/infEvento>/.exec(xml)?.[0];
  const sig = /<Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">[\s\S]*?<\/Signature>/.exec(xml)?.[0];
  if (!inf || !sig) return { ok: false, motivo: 'sem infEvento ou sem Signature' };
  const id = /Id="([^"]+)"/.exec(inf)[1];
  const reference = /<Reference URI="([^"]+)">/.exec(sig)?.[1];
  const signedInfo = /<SignedInfo[\s\S]*?<\/SignedInfo>/.exec(sig)[0];
  const digest = /<DigestValue>([^<]+)<\/DigestValue>/.exec(sig)[1];
  const value = /<SignatureValue>([^<]+)<\/SignatureValue>/.exec(sig)[1];
  const cert = new X509Certificate(Buffer.from(/<X509Certificate>([^<]+)<\/X509Certificate>/.exec(sig)[1], 'base64'));
  // C14N do infEvento com o namespace padrão da NF-e no ancestral.
  const canon = inf.replace(`<infEvento Id="${id}">`, `<infEvento xmlns="http://www.portalfiscal.inf.br/nfe" Id="${id}">`);
  const digestOk = createHash('sha1').update(canon, 'utf8').digest('base64') === digest;
  const sigOk = createVerify('RSA-SHA1').update(signedInfo, 'utf8').verify(cert.publicKey, value, 'base64');
  return { ok: digestOk && sigOk && reference === `#${id}`, digestOk, sigOk, referenceOk: reference === `#${id}`, id, cert };
}
