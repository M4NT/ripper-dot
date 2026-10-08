// NFS-e recebidas (ADN Contribuintes, NFS-e Nacional): consulta SOMENTE LEITURA com o certificado A1 da empresa
// (mesmo cofre do DF-e, cert.<CNPJ>). O db guarda o último NSU, a espera e as notas em db.dfe.nfse[cnpj].
// ATENÇÃO: o formato do LoteDistribuicaoNSUResponse não foi confirmado contra o swagger; os nomes de campo
// aceitos estão em `pick` e qualquer lote fora desse formato vira erro visível (nunca lista vazia silenciosa).
import https from 'node:https';
import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { loadCertificate, dfeCompanies, DfeError, DFE_HOUR } from './dfe.mjs';

export const NFSE_TOOL_NAMES = ['nfse_listar_notas_recebidas', 'nfse_sincronizar'];
const PAUSA_MS = +(process.env.RIPPER_NFSE_PAUSA_MS || 3000);
const MAX_PAGES = 5; // teto de chamadas por sincronização
const CHAVE = /^\d{50}$/;
const ADN_PADRAO = 'https://adn.producaorestrita.nfse.gov.br/contribuintes';
// Wording de "consumo indevido / espera" (o 656 da NF-e não existe aqui; conferir o texto real na primeira consulta).
const AVISO_ESPERA = /consumo indevido|\b656\b|aguard[ea]|intervalo m[ií]nimo/i;
const NADA_LOCALIZADO = /nenhum (documento|dfe)|n[ãa]o localizad|sem documentos/i;
const running = new Set();

/** Base do ADN. RIPPER_ADN_URL existe para apontar a um servidor de teste ou de homologação. */
export const nfseBase = () => (process.env.RIPPER_ADN_URL || ADN_PADRAO).replace(/\/+$/, '');

export function nfseState(db, cnpj) {
  db.dfe ||= {};
  db.dfe.nfse ||= {};
  return (db.dfe.nfse[cnpj] ||= { ultNSU: '0', maxNSU: '0', nextAllowedAt: 0, notes: {} });
}

/** GET com o certificado A1 como cliente TLS (mTLS). Erros de conexão não carregam o certificado. */
export function adnGet({ url, pfx, passphrase, ca, timeoutMs = 60_000 }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'GET',
      pfx, passphrase, ca, headers: { accept: 'application/json' }, timeout: timeoutMs
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado no ADN.')));
    req.on('error', e => reject(new Error(`Falha de conexão com o ADN: ${e.code || e.message}`)));
    req.end();
  });
}

const resumo = body => String(body).replace(/\s+/g, ' ').slice(0, 200);
const pick = (o, names) => { for (const n of names) if (o?.[n] !== undefined && o[n] !== null) return o[n]; return undefined; };

/** Decide o que fazer com a resposta: lote, espera (656-like), sem permissão, nada localizado ou erro. */
export function classificar(res) {
  const body = String(res.body || '');
  if (res.status !== 200 && AVISO_ESPERA.test(body)) return { tipo: 'espera', motivo: resumo(body) };
  if (res.status === 403) return { tipo: 'sem-permissao' };
  if (res.status === 404) return NADA_LOCALIZADO.test(body) ? { tipo: 'vazio' } : { tipo: 'erro', motivo: `ADN respondeu 404: ${resumo(body)}` };
  if (res.status !== 200) return { tipo: 'erro', motivo: `ADN respondeu HTTP ${res.status}: ${resumo(body)}` };
  let json;
  try { json = JSON.parse(body); } catch { return { tipo: 'erro', motivo: 'Resposta do ADN fora do formato JSON esperado.' }; }
  const resto = JSON.stringify(Object.fromEntries(Object.entries(json).filter(([k]) => !/lote/i.test(k))));
  if (AVISO_ESPERA.test(resto)) return { tipo: 'espera', motivo: resumo(resto) };
  const itens = pick(json, ['LoteDFe', 'loteDFe', 'Lote', 'lote']);
  if (!Array.isArray(itens)) return { tipo: 'erro', motivo: `Lote do ADN em formato não reconhecido (campos: ${Object.keys(json).join(', ')}).` };
  return {
    tipo: 'lote',
    itens,
    ultNSU: pick(json, ['UltimoNSU', 'ultimoNSU', 'ultNSU']) ?? null,
    maxNSU: pick(json, ['MaxNSU', 'maxNSU']) ?? null
  };
}

/** Conteúdo do documento: base64 de XML, com ou sem gzip. */
export function decodeArquivo(b64) {
  const buf = Buffer.from(String(b64), 'base64');
  return (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8');
}

const localTag = (xml, name) => {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([^<]*)</(?:[\\w-]+:)?${name}>`).exec(xml);
  return m ? m[1].trim() : null;
};
const rootOf = xml => /<(?:[\w-]+:)?([\w-]+)[\s>/]/.exec(xml.replace(/<\?xml[^>]*\?>/, ''))?.[1] || '?';

/** Campos da NFS-e (prestador = emitente). Campo ausente fica null, nunca inventado. */
export function extractNfse(xml) {
  const emit = /<(?:[\w-]+:)?emit\b[\s\S]*?<\/(?:[\w-]+:)?emit>/.exec(xml)?.[0] ?? '';
  const valor = localTag(xml, 'vLiq') ?? localTag(xml, 'vServ');
  return {
    schema: rootOf(xml),
    chave: /Id="NFS(\d{50})"/.exec(xml)?.[1] || null,
    prestadorCnpj: localTag(emit, 'CNPJ') || localTag(emit, 'CPF'),
    prestadorNome: localTag(emit, 'xNome'),
    valor: valor != null ? Number(valor) : null,
    emissao: localTag(xml, 'dhEmi') || localTag(xml, 'dhProc'),
    competencia: localTag(xml, 'dCompet'),
    municipio: localTag(xml, 'xLocPrestacao') || localTag(xml, 'xLocEmi')
  };
}

/**
 * Sincronização do lote de NFS-e recebidas. Para em: lote vazio, NSU chegou ao máximo, 656-like (espera de 1 h),
 * 403 (sem permissão) ou teto de MAX_PAGES. Pausa `pausaMs` entre páginas. Dedup por chave de acesso (50 dígitos).
 */
export async function nfseSincronizar({ cnpj, db, save = () => {}, now = Date.now(), get = adnGet, ca, url, pausaMs = PAUSA_MS }) {
  if (!/^\d{14}$/.test(cnpj)) throw new DfeError('CNPJ inválido: informe os 14 dígitos.');
  const { pfx, passphrase } = loadCertificate(cnpj);
  const st = nfseState(db, cnpj);
  if (st.nextAllowedAt > now) {
    return { ok: false, bloqueado: true, motivo: `Intervalo mínimo entre consultas. Nova consulta a partir de ${new Date(st.nextAllowedAt).toLocaleTimeString('pt-BR')}.`, nextAllowedAt: st.nextAllowedAt };
  }
  if (running.has(cnpj)) return { ok: false, motivo: 'Já há uma consulta em andamento para esta empresa.' };
  running.add(cnpj);
  try {
    let paginas = 0, novas = 0;
    const ignorados = new Set();
    let resultado = null;
    while (paginas < MAX_PAGES) {
      if (paginas > 0) await new Promise(r => setTimeout(r, pausaMs));
      paginas++;
      const target = `${url || nfseBase()}/DFe/${st.ultNSU}?cnpjConsulta=${cnpj}&lote=true`;
      const res = await get({ url: target, pfx, passphrase, ca });
      const r = classificar(res);
      st.lastRunAt = now;
      if (r.tipo === 'espera') { st.lastMotivo = r.motivo; resultado = { ok: false, bloqueado: true, motivo: r.motivo, nextAllowedAt: now + DFE_HOUR }; break; }
      if (r.tipo === 'sem-permissao') { resultado = { ok: false, motivo: 'sem permissão no ambiente restrito' }; break; }
      if (r.tipo === 'vazio') { st.lastMotivo = 'Nenhum documento localizado.'; break; }
      if (r.tipo === 'erro') { st.lastMotivo = r.motivo; resultado = { ok: false, motivo: r.motivo }; break; }

      let maxItem = null;
      for (const item of r.itens) {
        const nsu = String(pick(item, ['NSU', 'nsu']) ?? '');
        if (nsu && (maxItem === null || Number(nsu) > Number(maxItem))) maxItem = nsu;
        const b64 = pick(item, ['ArquivoXml', 'arquivoXml', 'ArquivoXML']);
        if (!b64) { ignorados.add(`sem-conteudo:${pick(item, ['TipoDocumento']) ?? '?'}`); continue; }
        let xml;
        try { xml = decodeArquivo(b64); } catch { ignorados.add('erro-decodificacao'); continue; }
        const root = rootOf(xml);
        if (root !== 'NFSe' && root !== 'CompNFSe') { ignorados.add(`desconhecido:${root}`); continue; }
        const nota = extractNfse(xml);
        const chaveItem = pick(item, ['ChaveAcesso', 'chaveAcesso']);
        const chave = [chaveItem, nota.chave].find(c => CHAVE.test(String(c ?? '')));
        const key = chave || `nsu:${nsu}`;
        if (!st.notes[key]) { st.notes[key] = { ...nota, chave: chave || null, nsu, recebidaEm: now }; novas++; }
      }
      const anterior = st.ultNSU;
      st.ultNSU = String(r.ultNSU ?? maxItem ?? anterior);
      if (r.maxNSU != null) st.maxNSU = String(r.maxNSU);
      save();
      if (!r.itens.length || st.ultNSU === anterior || (r.maxNSU != null && st.ultNSU === String(r.maxNSU))) break;
    }
    resultado ??= { ok: true, novas, total: Object.keys(st.notes).length, ignorados: [...ignorados], ultNSU: st.ultNSU, maxNSU: st.maxNSU, paginas };
    return resultado;
  } finally {
    running.delete(cnpj);
    // Intervalo mínimo de 1 h entre consultas, inclusive as que terminaram em erro ou sem permissão.
    st.nextAllowedAt = now + DFE_HOUR;
    save();
  }
}

/** Notas NFS-e recebidas da empresa (somente leitura), mais recentes primeiro. */
export function nfseListarNotas(db, cnpj, { de, ate, prestador, limit = 50 } = {}) {
  const st = db.dfe?.nfse?.[cnpj];
  let notas = Object.values(st?.notes || {});
  if (de) notas = notas.filter(n => (n.emissao || '').slice(0, 10) >= de);
  if (ate) notas = notas.filter(n => (n.emissao || '').slice(0, 10) <= ate);
  if (prestador) {
    const q = String(prestador).toLowerCase();
    const digits = String(prestador).replace(/\D/g, '');
    notas = notas.filter(n => (n.prestadorNome || '').toLowerCase().includes(q) || (digits && n.prestadorCnpj === digits));
  }
  notas.sort((a, b) => String(b.emissao || '').localeCompare(String(a.emissao || '')));
  return {
    total: notas.length,
    ultNSU: st?.ultNSU || '0',
    notas: notas.slice(0, Math.min(limit, 200)).map(n => ({
      chave: n.chave, prestador: n.prestadorNome, cnpjPrestador: n.prestadorCnpj, valor: n.valor,
      emissao: n.emissao, competencia: n.competencia, municipio: n.municipio, schema: n.schema
    }))
  };
}

/** Eventos de uma NFS-e pela chave de acesso. Ajuda opcional; fora do laço de sincronização. */
export async function nfseEventos({ cnpj, chave, get = adnGet, ca, url }) {
  if (!CHAVE.test(String(chave))) throw new DfeError('Chave de acesso inválida: são 50 dígitos.');
  const { pfx, passphrase } = loadCertificate(cnpj);
  const res = await get({ url: `${url || nfseBase()}/NFSe/${chave}/Eventos`, pfx, passphrase, ca });
  if (res.status !== 200) throw new DfeError(`ADN respondeu HTTP ${res.status}: ${resumo(res.body)}`);
  return JSON.parse(res.body);
}

// ---------- ferramentas dos agentes (somente leitura) ----------

const CNPJ = z.string().regex(/^\d{14}$/).describe('CNPJ da empresa (14 dígitos) com certificado cadastrado');
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const NFSE_TOOL_CATALOG = {
  nfse_listar_notas_recebidas: {
    description: 'NFS-e (serviço) em que a empresa é tomadora, já baixadas do ADN Nacional. Só leitura. Filtra por período e prestador. Se estiver vazio, rode nfse_sincronizar antes.',
    inputSchema: {
      empresa: CNPJ,
      de: DATA.optional().describe('Emissão a partir de (aaaa-mm-dd)'),
      ate: DATA.optional().describe('Emissão até (aaaa-mm-dd)'),
      prestador: z.string().max(120).optional().describe('Parte do nome ou CNPJ do prestador'),
      limit: z.number().int().min(1).max(200).optional()
    }
  },
  nfse_sincronizar: {
    description: 'Busca no ADN Nacional as NFS-e recebidas novas da empresa (somente leitura, desde o último NSU). Intervalo mínimo de 1 hora entre consultas.',
    inputSchema: { empresa: CNPJ }
  }
};

/** Executor das ferramentas NFS-e. Não tem nenhum caminho de escrita externa. */
export function createNfseRunner({ getDb, save = () => {}, get, ca, url }) {
  const comCertificado = (db, cnpj) => {
    if (!dfeCompanies(db).includes(cnpj)) throw new DfeError(`A empresa ${cnpj} não tem certificado cadastrado.`);
  };
  return {
    async run(name, a = {}) {
      const db = getDb();
      if (name === 'nfse_listar_notas_recebidas') {
        comCertificado(db, a.empresa);
        return JSON.stringify(nfseListarNotas(db, a.empresa, a));
      }
      if (name === 'nfse_sincronizar') {
        comCertificado(db, a.empresa);
        return JSON.stringify(await nfseSincronizar({ cnpj: a.empresa, db, save, get, ca, url }));
      }
      throw new Error(`ferramenta NFS-e desconhecida: ${name}`);
    }
  };
}
