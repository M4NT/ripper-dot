// NF-e: Ciência da Operação (evento 210210, manifestação do destinatário). Uma escrita na Receita:
// só sai com a sua aprovação na Caixa (askApproval), um evento por nota, com o certificado A1 da empresa (mTLS).
// Fontes (conferidas em 2026-10-08): NT 2020.001 v1.60 (substitui NT 2012.002 e 2013.001); schema e210210_v1.00.xsd e
// leiauteConfRecebto_v1.00.xsd (Esquemas XML, Manifestação Destinatário v1.02); MOC 7.0 §4.2.4 e §4.4.1; URLs do AN no
// Portal da NF-e (webServices). Não confirmado: ação SOAP e o formato do corpo (o WSDL só sai do próprio serviço da Receita).
import { z } from 'zod';
import { loadCertificate, dfeCompanies, dfePost, DfeError } from './dfe.mjs';
import { loadSigningCredential, assinarInfEvento } from './nfe-assinatura.mjs';

export const NFE_CIENCIA_TOOL_NAMES = ['nfe_manifestar_ciencia'];
export const NFE_CIENCIA_WRITE_TOOLS = new Set(NFE_CIENCIA_TOOL_NAMES);
export const CIENCIA_TP_EVENTO = 210210;
export const CIENCIA_MAX_LOTE = 20;
const JANELA_MS = 30 * 86400_000;
const TOLERANCIA_FUTURO_MS = 86400_000;
const PAUSA_MS = +(process.env.RIPPER_NFE_PAUSA_MS || 3000);
const SUCESSO = new Set(['135', '136', '573']); // 135 registrado e vinculado, 136 registrado sem vínculo, 573 já registrado
const EVENTO_ACTION = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento'; // NÃO confirmada no documento oficial (ver cabeçalho)
const CHAVE = /^\d{44}$/;

/** URL do NFeRecepcaoEvento4 do Ambiente Nacional (AN). Confirmadas no Portal da NF-e: produção (tpAmb 1) e homologação (2). RIPPER_NFE_EVENTO_URL só para teste. */
export function nfeEventoUrl(tpAmb = 1) {
  if (process.env.RIPPER_NFE_EVENTO_URL) return process.env.RIPPER_NFE_EVENTO_URL;
  return +tpAmb === 2
    ? 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx'
    : 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx';
}

// Horário de Brasília (sem horário de verão desde 2019).
const dhEvento = now => new Date(now - 3 * 3600_000).toISOString().slice(0, 19) + '-03:00';

/** Envelope SOAP 1.2 com um único evento 210210 (sequência 1). `assinar(infEvento)` devolve o <Signature>; o envio sempre passa um. */
export function eventoCienciaEnvelope({ chave, cnpj, tpAmb = 1, now = Date.now(), idLote = String(now).slice(-15), assinar }) {
  const inf = `<infEvento Id="ID${CIENCIA_TP_EVENTO}${chave}01"><cOrgao>91</cOrgao><tpAmb>${+tpAmb}</tpAmb><CNPJ>${cnpj}</CNPJ>`
    + `<chNFe>${chave}</chNFe><dhEvento>${dhEvento(now)}</dhEvento><tpEvento>${CIENCIA_TP_EVENTO}</tpEvento><nSeqEvento>1</nSeqEvento>`
    + '<verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento></infEvento>';
  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">'
    + '<soap12:Body><nfeRecepcaoEvento xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><nfeDadosMsg>'
    + `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>${idLote}</idLote><evento versao="1.00">${inf}${assinar ? assinar(inf) : ''}</evento></envEvento>`
    + '</nfeDadosMsg></nfeRecepcaoEvento></soap12:Body></soap12:Envelope>';
}

const tagText = (xml, name) => {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}>([^<]*)</`).exec(xml);
  return m ? m[1].trim() : null;
};

/** Resposta do evento: cStat/xMotivo do infEvento (o cStat do lote, 128, não basta). */
export function parseRetEvento(xml) {
  const inf = /<(?:[\w-]+:)?infEvento\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?infEvento>/.exec(xml)?.[1];
  const src = inf ?? xml;
  return { cStat: tagText(src, 'cStat'), xMotivo: tagText(src, 'xMotivo'), nProt: tagText(src, 'nProt') };
}

const reais = v => (v == null ? 'valor não informado' : `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dataBr = iso => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'sem data');

/** Texto da aprovação: lista em português e o que a ciência significa. */
export function textoAprovacao(cnpj, lista) {
  const linhas = lista.map((x, i) => `${i + 1}. NF-e ${x.chave} · ${x.emitente} · ${reais(x.valor)} · emitida em ${dataBr(x.data)}`);
  return {
    command: `Ciência da Operação (210210) · empresa ${cnpj} · ${lista.length} nota(s)\n${linhas.join('\n')}`,
    reason: 'Ciência da Operação (210210), registra que você reconhece a nota; não confirma a compra. Um evento por nota vai à Receita, assinado com o certificado da empresa. Para na primeira recusa.'
  };
}

export const NFE_CIENCIA_TOOL_CATALOG = {
  nfe_manifestar_ciencia: {
    description: `NF-e recebidas: registra a Ciência da Operação (evento 210210) de até ${CIENCIA_MAX_LOTE} notas da empresa, emitidas nos últimos 30 dias. A ciência só reconhece a nota; não confirma a compra. Escrita: a sua aprovação na Caixa é pedida antes de sair.`,
    inputSchema: {
      empresa: z.string().regex(/^\d{14}$/).describe('CNPJ da empresa (14 dígitos) com certificado cadastrado'),
      chaves: z.array(z.string().regex(CHAVE, 'chave de 44 dígitos')).min(1).max(CIENCIA_MAX_LOTE).describe('Chaves de acesso (44 dígitos) das NF-e recebidas'),
      tpAmb: z.union([z.literal(1), z.literal(2)]).optional().describe('1 produção (padrão), 2 homologação')
    }
  }
};

/**
 * Executor da ciência. deps: getDb(); approve(command, reason) → Promise<boolean> (Caixa);
 * record({kind, target, ok, error, approved}) → registro de ação externa (sem certificado nem senha);
 * post/ca/url/sleep/now só para teste.
 */
export function createNfeCienciaRunner({ getDb, save = () => {}, approve, record = () => {}, post = dfePost, ca, url, sleep = ms => new Promise(r => setTimeout(r, ms)), pausaMs = PAUSA_MS, now = () => Date.now() }) {
  return {
    async run(name, a = {}) {
      if (!NFE_CIENCIA_TOOL_NAMES.includes(name)) throw new Error(`ferramenta de ciência desconhecida: ${name}`);
      const db = getDb();
      const cnpj = a.empresa;
      if (!dfeCompanies(db).includes(cnpj)) throw new DfeError(`A empresa ${cnpj} não tem certificado cadastrado.`);
      const chaves = [...new Set((a.chaves || []).map(String))];
      if (!chaves.length) return 'Informe ao menos uma chave de NF-e.';
      if (chaves.length > CIENCIA_MAX_LOTE) return `Lote com ${chaves.length} chaves: o máximo é ${CIENCIA_MAX_LOTE} por vez. Nada foi enviado.`;
      const invalidas = chaves.filter(c => !CHAVE.test(c));
      if (invalidas.length) return `Chave inválida (são 44 dígitos): ${invalidas.join(', ')}. Nada foi enviado.`;

      // Só notas já baixadas da empresa, emitidas nos últimos 30 dias. Uma recusada → nada é enviado.
      const notas = db.dfe?.companies?.[cnpj]?.notes || {};
      const t = now();
      const lista = [], recusadas = [];
      for (const chave of chaves) {
        const n = notas[chave];
        if (!n || n.chNFe !== chave) { recusadas.push(`${chave}: não está entre as NF-e recebidas desta empresa (rode dfe_sincronizar)`); continue; }
        const emi = Date.parse(n.dhEmi);
        if (!Number.isFinite(emi) || emi < t - JANELA_MS || emi > t + TOLERANCIA_FUTURO_MS) { recusadas.push(`${chave}: emitida há mais de 30 dias ou sem data`); continue; }
        lista.push({ chave, emitente: n.xNome || '(sem nome)', valor: n.vNF, data: n.dhEmi });
      }
      if (recusadas.length) return `Nada foi enviado. Estas chaves não podem receber a ciência:\n- ${recusadas.join('\n- ')}`;

      // Aprovação antes de qualquer envio.
      const { command, reason } = textoAprovacao(cnpj, lista);
      const ok = await approve(command, reason);
      if (!ok) {
        record({ kind: 'nfe.ciencia', target: `${cnpj} · ${lista.length} nota(s)`, approved: 'user', ok: false, error: 'não aprovado pelo dono' });
        return 'O usuário NÃO aprovou. Nenhuma ciência foi enviada.';
      }

      const tpAmb = a.tpAmb ?? 1;
      const { pfx, passphrase } = loadCertificate(cnpj);
      const cred = loadSigningCredential(pfx, passphrase); // senha errada recusa antes de qualquer envio
      const assinar = inf => assinarInfEvento(inf, cred);
      const resultados = [];
      let parouEm = null;
      for (let i = 0; i < lista.length; i++) {
        if (i > 0) await sleep(pausaMs);
        const { chave } = lista[i];
        const xml = eventoCienciaEnvelope({ chave, cnpj, tpAmb, now: now(), assinar });
        let r;
        try {
          const res = await post({ url: url || nfeEventoUrl(tpAmb), pfx, passphrase, xml, ca, action: EVENTO_ACTION });
          const p = parseRetEvento(res.body);
          if (!p.cStat) throw new DfeError(`Resposta inesperada da Receita (HTTP ${res.status}).`);
          r = { chave, cStat: p.cStat, xMotivo: p.xMotivo, ok: SUCESSO.has(p.cStat) };
        } catch (e) {
          r = { chave, ok: false, erro: e.message };
        }
        record({ kind: 'nfe.ciencia', target: `${cnpj} · ${chave}`, approved: 'user', ok: r.ok, error: r.ok ? undefined : (r.erro || `${r.cStat} ${r.xMotivo || ''}`.trim()) });
        resultados.push(r);
        if (!r.ok) { parouEm = chave; break; }
        const nota = notas[chave];
        nota.ciencia = true;
        nota.cienciaEm = now();
        save();
      }
      const naoEnviadas = parouEm ? lista.slice(lista.findIndex(x => x.chave === parouEm) + 1).map(x => x.chave) : [];
      return JSON.stringify({ ok: !parouEm, enviadas: resultados.length, resultados, parouEm, naoEnviadas });
    }
  };
}
