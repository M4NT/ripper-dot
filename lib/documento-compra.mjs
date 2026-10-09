// Cartão de documento de compra (NF-e recebida no chat): fornecedor, valor, etiquetas de situação e três botões.
// Nenhum botão mexe no ERP. "Aprovar" só cria um pedido na Caixa, e quem decide é a pessoa lá.
// "Rejeitar" só registra a decisão: não cria nada na Caixa e não avisa ninguém.
import { z } from 'zod';
import { DfeError, dfeCompanies } from './dfe.mjs';
import { GAP, chNumero, montarCadeias } from './elo-compras.mjs';
import { OMIE_SLUG_RE } from './omie.mjs';

export const DOCUMENTO_TOOL_NAMES = ['mostrar_documento'];
// Prazo da Ciência da Operação: 10 dias a partir da emissão (NT 2020.001 §4; mesma regra de lib/nfe-ciencia.mjs).
export const PRAZO_CIENCIA_MS = 10 * 86400_000;
const LIMITE_CAIXA = 300; // mesmo teto de db.approvals em server.mjs

const EMP = z.string().regex(/^\d{14}$/).describe('CNPJ da empresa (14 dígitos) com certificado cadastrado');
export const DOCUMENTO_TOOL_CATALOG = {
  mostrar_documento: {
    description: 'Mostra no chat o cartão de uma NF-e de compra recebida: fornecedor, valor e situação (CT-e, conta, departamento, projeto, pedido e ciência). Use o chNFe que compras_fechar_elo ou dfe_listar_notas_recebidas devolveram. O cartão só tem três botões (Ver detalhes, Aprovar e Rejeitar): Aprovar cria um pedido na Caixa, e nada é lançado no ERP.',
    inputSchema: {
      empresa: EMP,
      omie_empresa: z.string().regex(OMIE_SLUG_RE).describe('Slug da empresa no Omie, ex.: ecmach'),
      chNFe: z.string().regex(/^\d{44}$/).describe('Chave de acesso da NF-e (44 dígitos)')
    }
  }
};

const dataCurta = ms => new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
const reais = v => (v == null ? 'sem valor' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const rotuloGap = g => (g === GAP.semCte ? 'sem CT-e (por enquanto)' : g); // o CT-e ainda pode chegar: não é "faltou"

/**
 * Etiquetas de situação: um problema do elo vira uma etiqueta; a ciência pendente também.
 * Sem problemas: a etiqueta verde "completo".
 */
export function etiquetasDoDocumento({ gaps = [], nota = {}, agora = Date.now() } = {}) {
  const out = gaps.map(g => ({ texto: rotuloGap(g), nivel: 'alerta' }));
  if (!nota.ciencia && nota.dhEmi) {
    const prazo = Date.parse(nota.dhEmi) + PRAZO_CIENCIA_MS;
    out.push(agora <= prazo
      ? { texto: `ciência pendente até ${dataCurta(prazo)}`, nivel: 'alerta' }
      : { texto: 'ciência fora do prazo', nivel: 'alerta' });
  }
  return out.length ? out : [{ texto: 'completo', nivel: 'ok' }];
}

/** Dados do cartão (o estado da decisão vem à parte, de estadoDocumento). */
export function cardDoDocumento({ nota, chain, empresa, omie, agora = Date.now() }) {
  return {
    chNFe: chain.chNFe,
    empresa,
    omie,
    numero: chain.nNF,
    valor: chain.valor,
    emissao: chain.emissao,
    fornecedor: { nome: nota.xNome || null, cnpj: chain.emitenteCnpj },
    etiquetas: etiquetasDoDocumento({ gaps: chain.gaps, nota, agora }),
    avisos: chain.warnings,
    detalhes: {
      cte: chain.cte,
      titulo: chain.titulo,
      tituloFrete: chain.tituloFrete,
      departamentos: chain.departamentos,
      projeto: chain.projeto,
      pedido: chain.pedido,
      pedidoCitado: chain.pedidoCitado,
      nfse: chain.nfse
    }
  };
}

/**
 * Executor da ferramenta mostrar_documento. Só lê (notas salvas e Omie). onCard recebe o cartão para o chat.
 */
export function createDocumentoRunner({ getDb, call, onCard = () => {} }) {
  return {
    async run(name, a = {}) {
      if (!DOCUMENTO_TOOL_NAMES.includes(name)) throw new Error(`ferramenta de documento desconhecida: ${name}`);
      const db = getDb();
      if (!dfeCompanies(db).includes(a.empresa)) throw new DfeError(`A empresa ${a.empresa} não tem certificado cadastrado.`);
      const nota = Object.values(db.dfe?.companies?.[a.empresa]?.notes || {}).find(n => n.chNFe === a.chNFe);
      if (!nota) throw new DfeError('Essa NF-e não está salva. Rode dfe_sincronizar e tente de novo.');
      const { chains } = await montarCadeias({ db, empresa: a.empresa, omie_empresa: a.omie_empresa, nNF: chNumero(a.chNFe), call });
      const chain = chains.find(c => c.chNFe === a.chNFe);
      if (!chain) throw new DfeError('Não consegui montar o elo desta NF-e.');
      const card = cardDoDocumento({ nota, chain, empresa: a.empresa, omie: a.omie_empresa });
      onCard(card);
      const situacao = card.etiquetas.map(t => t.texto).join(', ');
      return `Mostrei ao usuário o cartão da NF-e nº ${card.numero} de ${card.fornecedor.nome || card.fornecedor.cnpj}. Situação: ${situacao}. O usuário decide pelos botões do cartão. Não diga que aprovou, rejeitou ou lançou nada.`;
    }
  };
}

// ---------- decisão (estado guardado em db.documentos; o pedido da Caixa em db.approvals) ----------

const chaveDoc = (empresa, chNFe) => `${empresa}:${chNFe}`;

/**
 * Estado atual do cartão: nenhum | aguardando (pedido na Caixa) | aprovado | rejeitado | expirado.
 * Aprovado e rejeitado vêm da Caixa quando há pedido; "Rejeitar" direto vira rejeitado sem pedido.
 */
export function estadoDocumento(db, empresa, chNFe) {
  const doc = db.documentos?.[chaveDoc(empresa, chNFe)];
  if (!doc) return { estado: 'nenhum' };
  if (doc.approvalId) {
    const rec = db.approvals?.find(x => x.id === doc.approvalId);
    if (rec) {
      const estado = { pending: 'aguardando', approved: 'aprovado', denied: 'rejeitado', expired: 'expirado', cancelled: 'expirado' }[rec.status] || 'expirado';
      return { estado, approvalId: rec.id, decididoEm: rec.decidedAt || null };
    }
  }
  if (doc.rejeitadoEm) return { estado: 'rejeitado', decididoEm: doc.rejeitadoEm };
  return { estado: 'nenhum' };
}

/** "Aprovar" no cartão: cria o pedido na Caixa (sem agente esperando). Se já há pedido aberto ou aprovado, não duplica. */
export function pedirAprovacaoDocumento(db, { empresa, chNFe, card, agentId = null, chatId = null, novoId, now = Date.now() }) {
  const atual = estadoDocumento(db, empresa, chNFe);
  if (atual.estado === 'aguardando' || atual.estado === 'aprovado') return atual;
  const situacao = card.etiquetas.map(t => t.texto).join(', ');
  const rec = {
    id: novoId(),
    kind: 'documento',
    agentId,
    chatId,
    command: `NF-e nº ${card.numero} de ${card.fornecedor.nome || card.fornecedor.cnpj} · ${reais(card.valor)} · ${situacao}`,
    reason: 'Aprovar aqui registra a sua decisão. Nada é lançado no Omie e nenhum aviso sai daqui.',
    status: 'pending',
    createdAt: now,
    docRef: { empresa, chNFe }
  };
  db.approvals.push(rec);
  if (db.approvals.length > LIMITE_CAIXA) db.approvals.splice(0, db.approvals.length - LIMITE_CAIXA);
  db.documentos ||= {};
  db.documentos[chaveDoc(empresa, chNFe)] = { chNFe, empresa, approvalId: rec.id, rejeitadoEm: null, criadoEm: now };
  return estadoDocumento(db, empresa, chNFe);
}

/**
 * "Rejeitar" no cartão: só registra. Se havia pedido aberto na Caixa, ele é cancelado. Nada vai ao ERP nem a ninguém.
 * Devolve o pedido cancelado (se houve) para o servidor anotar na auditoria.
 */
export function rejeitarDocumento(db, { empresa, chNFe, now = Date.now() }) {
  const atual = estadoDocumento(db, empresa, chNFe);
  if (atual.estado === 'aprovado') throw new DfeError('Este documento já foi aprovado na Caixa.');
  let cancelado = null;
  if (atual.estado === 'aguardando') {
    cancelado = db.approvals.find(x => x.id === atual.approvalId) || null;
    if (cancelado) { cancelado.status = 'cancelled'; cancelado.decidedAt = now; }
  }
  db.documentos ||= {};
  db.documentos[chaveDoc(empresa, chNFe)] = { chNFe, empresa, approvalId: null, rejeitadoEm: now };
  return { estado: estadoDocumento(db, empresa, chNFe), cancelado };
}
