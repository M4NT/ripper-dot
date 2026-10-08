// NF-e: certificado A1 da empresa (cofre cifrado) e consulta SOMENTE LEITURA à Distribuição DF-e (Ambiente Nacional).
// O .pfx e a senha ficam no cofre; o db guarda só metadados (titular, validade) e as notas recebidas.
import { createServer as createTlsServer, connect as tlsConnect } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import https from 'node:https';
import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { getVaultCredential, putVaultObject, deleteVaultCredential, vaultConfigured } from './connection-vault.mjs';

export const DFE_HOUR = 3600_000;
const DFE_PAUSA_MS = +(process.env.RIPPER_DFE_PAUSA_MS || 3000);
export const CERT_WARN_DAYS = 30;
export const DFE_TOOL_NAMES = ['dfe_listar_notas_recebidas', 'dfe_sincronizar'];
const DFE_ACTION = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse';
const MAX_PFX_BYTES = 512 * 1024;
const MAX_PAGES = 5; // teto de chamadas por sincronização: nunca fica em loop

export class DfeError extends Error {}

export const dfeVaultKey = cnpj => `cert.${cnpj}`;
const onlyDigits = s => String(s || '').replace(/\D/g, '');
const brDate = iso => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/** Endpoints da Distribuição DF-e. tpAmb 1 = produção, 2 = homologação. RIPPER_DFE_URL só para teste (servidor local). */
export function dfeUrl(tpAmb = 1) {
  if (process.env.RIPPER_DFE_URL) return process.env.RIPPER_DFE_URL;
  return +tpAmb === 2
    ? 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx'
    : 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';
}

// ---------- certificado ----------

/** Certificado folha do .pfx. Um servidor TLS local só sobe com a senha certa; o handshake devolve o certificado (sem parser PKCS#12). */
export function readPfxLeaf(pfx, passphrase) {
  return new Promise((resolve, reject) => {
    let srv;
    try { srv = createTlsServer({ pfx, passphrase }); } catch (e) { return reject(e); }
    const fail = e => { srv.close(); reject(e); };
    srv.on('error', fail);
    srv.listen(0, '127.0.0.1', () => {
      const sock = tlsConnect({ host: '127.0.0.1', port: srv.address().port, rejectUnauthorized: false }, () => {
        const peer = sock.getPeerCertificate();
        sock.end();
        srv.close();
        peer?.raw ? resolve(new X509Certificate(peer.raw)) : reject(new Error('sem certificado'));
      });
      sock.on('error', fail);
    });
  });
}

/** Dados do titular: CN "NOME:CNPJ" do ICP-Brasil A1. */
export function certificateInfo(x509) {
  const cn = /CN=([^\n]+)/.exec(x509.subject)?.[1] || '';
  const cnpj = (/(\d{14})/.exec(cn) || /(\d{14})/.exec(x509.subject) || [])[1] || null;
  return {
    titular: cn.split(':')[0].trim() || 'Sem nome',
    cnpj,
    validFrom: new Date(x509.validFrom).toISOString(),
    validTo: new Date(x509.validTo).toISOString()
  };
}

/** Confere senha, CNPJ (ou a raiz de 8 dígitos) e validade. Lança DfeError com a mensagem para o dono. */
export async function validateCertificate({ pfx, password, cnpj, now = Date.now() }) {
  let x509;
  try { x509 = await readPfxLeaf(pfx, password); } catch {
    throw new DfeError('Senha incorreta, ou o arquivo não é um certificado .pfx/.p12 válido.');
  }
  const info = certificateInfo(x509);
  if (!info.cnpj) throw new DfeError('O certificado não tem CNPJ de empresa. Use o certificado A1 de pessoa jurídica.');
  if (info.cnpj !== cnpj && info.cnpj.slice(0, 8) !== cnpj.slice(0, 8)) {
    throw new DfeError(`Este certificado é de outra empresa (CNPJ ${info.cnpj}). Envie o certificado do CNPJ ${cnpj}.`);
  }
  if (Date.parse(info.validFrom) > now) throw new DfeError('Este certificado ainda não está válido.');
  if (Date.parse(info.validTo) < now) throw new DfeError(`Este certificado venceu em ${brDate(info.validTo)}. Envie um certificado válido.`);
  return info;
}

/** ok / vence em menos de 30 dias / vencido. */
export function certificateStatus(cert, now = Date.now()) {
  const diasRestantes = Math.floor((Date.parse(cert.validTo) - now) / 86400_000);
  const status = diasRestantes < 0 ? 'vencido' : diasRestantes < CERT_WARN_DAYS ? 'vence_em_breve' : 'ok';
  return { status, diasRestantes };
}

function dfeState(db) {
  db.dfe ||= {};
  db.dfe.certs ||= {};
  db.dfe.companies ||= {};
  return db.dfe;
}

function companyState(db, cnpj) {
  return (dfeState(db).companies[cnpj] ||= { ultNSU: '0', maxNSU: '0', nextAllowedAt: 0, notes: {} });
}

/** Cadastra (ou troca) o certificado de uma empresa. Responde só com metadados. */
export async function saveCertificate(db, cnpj, { pfxBase64, password, now = Date.now() } = {}) {
  if (!/^\d{14}$/.test(cnpj)) throw new DfeError('CNPJ inválido: informe os 14 dígitos.');
  if (!vaultConfigured()) throw new DfeError('Cofre indisponível: defina RIPPER_VAULT_KEY ou RIPPER_TOKEN no servidor.');
  if (typeof password !== 'string' || !password) throw new DfeError('Informe a senha do certificado.');
  if (typeof pfxBase64 !== 'string' || !/^[A-Za-z0-9+/=\r\n]+$/.test(pfxBase64)) throw new DfeError('Envie o arquivo .pfx ou .p12 do certificado.');
  const pfx = Buffer.from(pfxBase64, 'base64');
  if (!pfx.length || pfx.length > MAX_PFX_BYTES) throw new DfeError('Arquivo de certificado com tamanho inválido.');
  const info = await validateCertificate({ pfx, password, cnpj, now });
  putVaultObject(dfeVaultKey(cnpj), { label: `Certificado ${info.titular}`, connector: 'dfe-cert' }, { pfxBase64: pfx.toString('base64'), password });
  dfeState(db).certs[cnpj] = { cnpj, titular: info.titular, validFrom: info.validFrom, validTo: info.validTo, uploadedAt: now };
  return certificadoPublico(db.dfe.certs[cnpj], now);
}

export function removeCertificate(db, cnpj) {
  deleteVaultCredential(dfeVaultKey(cnpj));
  delete dfeState(db).certs[cnpj];
  return true;
}

function certificadoPublico(c, now = Date.now()) {
  return { cnpj: c.cnpj, titular: c.titular, validFrom: c.validFrom, validTo: c.validTo, uploadedAt: c.uploadedAt, ...certificateStatus(c, now) };
}

export function certificadosList(db, now = Date.now()) {
  return Object.values(dfeState(db).certs).map(c => certificadoPublico(c, now));
}

/** Certificados que pedem aviso na Caixa (vencido ou vence em menos de 30 dias). */
export function certificateAlerts(db, now = Date.now()) {
  return certificadosList(db, now).filter(c => c.status !== 'ok');
}

/** Pfx e senha, decifrados do cofre. Só para uso interno (sincronização). */
export function loadCertificate(cnpj) {
  const row = getVaultCredential(dfeVaultKey(cnpj), { internal: true });
  if (!row?.pfxBase64) throw new DfeError('Esta empresa não tem certificado cadastrado.');
  return { pfx: Buffer.from(row.pfxBase64, 'base64'), passphrase: row.password };
}

// ---------- protocolo ----------

/** Envelope SOAP 1.2 do nfeDistDFeInteresse (distDFeInt 1.01). ultNSU com 15 dígitos. */
export function dfeEnvelope({ cnpj, ultNSU = '0', tpAmb = 1, cUFAutor = 35 }) {
  const nsu = onlyDigits(ultNSU).padStart(15, '0');
  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">'
    + '<soap12:Body><nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg>'
    + `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>${+tpAmb}</tpAmb><cUFAutor>${cUFAutor}</cUFAutor><CNPJ>${cnpj}</CNPJ>`
    + `<distNSU><ultNSU>${nsu}</ultNSU></distNSU></distDFeInt>`
    + '</nfeDadosMsg></nfeDistDFeInteresse></soap12:Body></soap12:Envelope>';
}

/** POST SOAP com o certificado A1 como cliente TLS (mTLS). Erros não carregam o certificado. */
export function dfePost({ url, pfx, passphrase, xml, ca, timeoutMs = 60_000, action = DFE_ACTION }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST',
      pfx, passphrase, ca,
      headers: { 'content-type': `application/soap+xml; charset=utf-8; action="${action}"`, 'content-length': Buffer.byteLength(xml) },
      timeout: timeoutMs
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado na Receita.')));
    req.on('error', e => reject(new Error(`Falha de conexão com a Receita: ${e.code || e.message}`)));
    req.end(xml);
  });
}

const tagText = (xml, name) => {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}>([^<]*)</`).exec(xml);
  return m ? m[1].trim() : null;
};
const attrOf = (attrs, name) => new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1] ?? null;

/** Resposta retDistDFeInt: cStat, xMotivo, ultNSU, maxNSU e os docZip do lote. */
export function parseDistDFe(xml) {
  const docs = [...String(xml).matchAll(/<(?:[\w-]+:)?docZip\b([^>]*)>([^<]*)<\/(?:[\w-]+:)?docZip>/g)]
    .map(m => ({ NSU: attrOf(m[1], 'NSU'), schemaXsd: attrOf(m[1], 'schema'), b64: m[2].trim() }));
  return { cStat: tagText(xml, 'cStat'), xMotivo: tagText(xml, 'xMotivo'), ultNSU: tagText(xml, 'ultNSU'), maxNSU: tagText(xml, 'maxNSU'), docs };
}

export function decodeDocZip(b64) {
  return gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');
}

const localTag = (xml, name) => {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([^<]*)</(?:[\\w-]+:)?${name}>`).exec(xml);
  return m ? m[1].trim() : null;
};

/**
 * Extrai a nota de um docZip. Layouts: resNFe (resumo), nfeProc (NF-e completa com protocolo) e CT-e
 * (cteProc/procCTe completo, resCTe resumo). CT-e traz chCTe, nº, valor do frete e as chaves das NF-e transportadas.
 * `schema` diz o layout reconhecido; layout fora disso vira "desconhecido:<raiz>", visível no painel.
 */
export function extractNota(xml) {
  const root = /<(?:[\w-]+:)?([\w-]+)[\s>/]/.exec(xml.replace(/<\?xml[^>]*\?>/, ''))?.[1] || '?';
  const emit = /<(?:[\w-]+:)?emit\b[\s\S]*?<\/(?:[\w-]+:)?emit>/.exec(xml)?.[0] ?? xml;
  const chNFe = /Id="NFe(\d{44})"/.exec(xml)?.[1] || localTag(xml, 'chNFe');
  const chCTe = /Id="CTe(\d{44})"/.exec(xml)?.[1] || localTag(xml, 'chCTe');
  const isCte = root === 'cteProc' || root === 'procCTe' || root === 'resCTe';
  const known = root === 'resNFe' || root === 'nfeProc' || isCte;
  const dhEmi = localTag(xml, 'dhEmi') || localTag(xml, 'dEmi');
  const vNF = localTag(xml, 'vNF');
  const vTPrest = localTag(xml, 'vTPrest') || localTag(xml, 'vPrest');
  const chave = chNFe || chCTe;
  const nota = {
    chNFe: chNFe || null,
    xNome: localTag(emit, 'xNome'),
    cnpjEmitente: localTag(emit, 'CNPJ') || localTag(emit, 'CPF'),
    vNF: vNF != null ? Number(vNF) : null,
    dhEmi: dhEmi || null,
    schema: !known ? `desconhecido:${root}` : chave ? root : `sem-chave:${root}`
  };
  if (isCte) {
    nota.chCTe = chCTe || null;
    nota.nCT = localTag(xml, 'nCT');
    nota.vTPrest = vTPrest != null ? Number(vTPrest) : null;
    nota.chNFeTransportadas = [...xml.matchAll(/<(?:[\w-]+:)?infNFe\b[^>]*>\s*<(?:[\w-]+:)?chave>(\d{44})</g)].map(m => m[1]);
  }
  if (root === 'nfeProc') {
    // Itens e informações complementares: para conferir o pedido de compra citado (lib/elo-compras.mjs).
    nota.itens = [...xml.matchAll(/<(?:[\w-]+:)?det\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?det>/g)].map(m => {
      const prod = m[1];
      return { cProd: localTag(prod, 'cProd'), xProd: localTag(prod, 'xProd') };
    });
    nota.infCpl = localTag(xml, 'infCpl');
  }
  return nota;
}

// Uma sincronização por empresa de cada vez (no mesmo processo).
const running = new Set();

/**
 * Consulta a Distribuição DF-e a partir do último NSU guardado. Para no cStat 656 (espera 1 h, guardada em
 * nextAllowedAt) e no teto de MAX_PAGES. Notas deduplicadas por chNFe. `post`/`ca` são para teste.
 */
export async function dfeSincronizar({ cnpj, db, save = () => {}, tpAmb = 1, now = Date.now(), post = dfePost, ca, url }) {
  if (!/^\d{14}$/.test(cnpj)) throw new DfeError('CNPJ inválido: informe os 14 dígitos.');
  const st = companyState(db, cnpj);
  if (st.nextAllowedAt > now) {
    return { ok: false, bloqueado: true, motivo: `A Receita pediu espera por consumo indevido. Nova consulta a partir de ${new Date(st.nextAllowedAt).toLocaleTimeString('pt-BR')}.`, nextAllowedAt: st.nextAllowedAt };
  }
  if (running.has(cnpj)) return { ok: false, motivo: 'Já há uma consulta em andamento para esta empresa.' };
  running.add(cnpj);
  try {
    const { pfx, passphrase } = loadCertificate(cnpj);
    let paginas = 0, novas = 0;
    while (paginas < MAX_PAGES) {
      paginas++;
      const xml = dfeEnvelope({ cnpj, ultNSU: st.ultNSU, tpAmb });
      const res = await post({ url: url || dfeUrl(tpAmb), pfx, passphrase, xml, ca });
      const r = parseDistDFe(res.body);
      if (!r.cStat) throw new DfeError(`Resposta inesperada da Receita (HTTP ${res.status}).`);
      st.lastCStat = r.cStat;
      st.lastMotivo = r.xMotivo;
      st.lastRunAt = now;
      if (r.cStat === '656') {
        st.nextAllowedAt = now + DFE_HOUR;
        save();
        return { ok: false, bloqueado: true, cStat: '656', motivo: r.xMotivo, nextAllowedAt: st.nextAllowedAt };
      }
      if (r.cStat !== '138' && r.cStat !== '137') {
        save();
        return { ok: false, cStat: r.cStat, motivo: r.xMotivo };
      }
      for (const d of r.docs) {
        const xmlDoc = decodeDocZip(d.b64);
        const nota = { ...extractNota(xmlDoc), nsu: d.NSU, schemaXsd: d.schemaXsd, recebidaEm: now };
        const key = nota.chNFe || nota.chCTe || `nsu:${d.NSU}`;
        if (!st.notes[key]) { st.notes[key] = nota; novas++; }
      }
      if (r.ultNSU) st.ultNSU = r.ultNSU;
      if (r.maxNSU) st.maxNSU = r.maxNSU;
      save();
      if (r.cStat === '137' || !r.ultNSU || r.ultNSU === r.maxNSU) break;
      await new Promise(res => setTimeout(res, DFE_PAUSA_MS)); // pausa entre páginas: não rajar a Receita
    }
    // Intervalo mínimo entre sincronizações (a Receita pede ~1 h quando não há novidade): a próxima só depois disso.
    st.nextAllowedAt = now + DFE_HOUR;
    save();
    return { ok: true, novas, total: Object.keys(st.notes).length, ultNSU: st.ultNSU, maxNSU: st.maxNSU, paginas };
  } finally {
    running.delete(cnpj);
  }
}

/** Notas guardadas da empresa (somente leitura), mais recentes primeiro. */
export function dfeListarNotas(db, cnpj, { de, ate, emitente, limit = 50 } = {}) {
  const st = dfeState(db).companies[cnpj];
  let notas = Object.values(st?.notes || {});
  if (de) notas = notas.filter(n => (n.dhEmi || '').slice(0, 10) >= de);
  if (ate) notas = notas.filter(n => (n.dhEmi || '').slice(0, 10) <= ate);
  if (emitente) {
    const q = String(emitente).toLowerCase();
    notas = notas.filter(n => (n.xNome || '').toLowerCase().includes(q) || (n.cnpjEmitente || '') === onlyDigits(emitente));
  }
  notas.sort((a, b) => String(b.dhEmi || '').localeCompare(String(a.dhEmi || '')));
  return {
    total: notas.length,
    ultNSU: st?.ultNSU || '0',
    notas: notas.slice(0, Math.min(limit, 200)).map(n => ({ chNFe: n.chNFe, emitente: n.xNome, cnpjEmitente: n.cnpjEmitente, valor: n.vNF, emissao: n.dhEmi, schema: n.schema }))
  };
}

// ---------- ferramentas dos agentes (somente leitura) ----------

export const dfeCompanies = db => Object.keys(dfeState(db).certs);

const CNPJ = z.string().regex(/^\d{14}$/).describe('CNPJ da empresa (14 dígitos) com certificado cadastrado');
export const DFE_TOOL_CATALOG = {
  dfe_listar_notas_recebidas: {
    description: 'NF-e recebidas da empresa, já baixadas da Receita (Distribuição DF-e). Só leitura. Filtra por período e emitente. Se estiver vazio, rode dfe_sincronizar antes.',
    inputSchema: {
      empresa: CNPJ,
      de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Emissão a partir de (aaaa-mm-dd)'),
      ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Emissão até (aaaa-mm-dd)'),
      emitente: z.string().max(120).optional().describe('Parte do nome ou CNPJ do emitente'),
      limit: z.number().int().min(1).max(200).optional()
    }
  },
  dfe_sincronizar: {
    description: 'Busca na Receita as NF-e recebidas novas da empresa (somente leitura, desde o último NSU). Respeita a regra de 1 hora da Receita: se ela já pediu espera, devolve o horário em que pode consultar de novo.',
    inputSchema: { empresa: CNPJ, tpAmb: z.union([z.literal(1), z.literal(2)]).optional().describe('1 produção (padrão), 2 homologação') }
  }
};

/** Executor das ferramentas DF-e. Não tem nenhum caminho de escrita externa. */
export function createDfeRunner({ getDb, save = () => {}, post, ca }) {
  return {
    async run(name, a = {}) {
      const db = getDb();
      if (name === 'dfe_listar_notas_recebidas') {
        if (!dfeState(db).certs[a.empresa]) throw new DfeError(`A empresa ${a.empresa} não tem certificado cadastrado.`);
        return JSON.stringify(dfeListarNotas(db, a.empresa, a));
      }
      if (name === 'dfe_sincronizar') {
        if (!dfeState(db).certs[a.empresa]) throw new DfeError(`A empresa ${a.empresa} não tem certificado cadastrado.`);
        return JSON.stringify(await dfeSincronizar({ cnpj: a.empresa, db, save, tpAmb: a.tpAmb ?? 1, post, ca }));
      }
      throw new Error(`ferramenta DF-e desconhecida: ${name}`);
    }
  };
}
