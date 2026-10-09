import { useEffect, useState } from 'react';
import { Icon } from './ui.jsx';
import { api } from './lib.js';
import './styles/telas/documentoCard.css';

const reais = v => (v == null ? 'sem valor' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const cnpj = d => String(d || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
// Data curta: o Omie manda dd/mm/aaaa; data sem hora (aaaa-mm-dd) não pode passar por fuso (perderia um dia).
const data = v => {
  if (!v) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return v;
  const so = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (so) return `${so[3]}/${so[2]}/${so[1]}`;
  return new Date(v).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};
const quando = iso => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

// Estado da decisão e texto de cada um (o servidor é quem manda o estado; aqui só se mostra)
const TEXTO = {
  aguardando: 'Aguardando a sua confirmação na Caixa',
  aprovado: 'Aprovado',
  rejeitado: 'Rejeitado',
  expirado: 'O pedido na Caixa expirou. Você pode aprovar de novo.'
};

/**
 * Cartão de NF-e de compra (item 22). Os botões nunca lançam nada no ERP:
 * "Aprovar" só cria um pedido na Caixa; "Rejeitar" só registra a decisão, sem aviso a ninguém.
 */
export default function DocumentoCard({ rec }) {
  const [estado, setEstado] = useState(null);
  const [detalhes, setDetalhes] = useState(false);
  const [busy, setBusy] = useState('');
  const [erro, setErro] = useState('');
  const url = `/api/documentos/${rec.empresa}/${rec.chNFe}`;
  const aguardando = estado?.estado === 'aguardando';

  // Enquanto há pedido na Caixa, acompanha a decisão sem recarregar a conversa.
  useEffect(() => {
    let on = true, t;
    const tick = () => api(url).then(x => { if (!on) return; setEstado(x); if (x.estado === 'aguardando') t = setTimeout(tick, 2500); })
      .catch(() => { if (on) setEstado(e => e ?? { estado: 'nenhum' }); }); // sem resposta, os botões seguem valendo
    tick();
    return () => { on = false; clearTimeout(t); };
  }, [url, aguardando]);

  async function acao(nome) {
    setBusy(nome); setErro('');
    try {
      const body = nome === 'aprovar' ? { etiquetas: rec.etiquetas.map(e => e.texto), agentId: rec.agentId, chatId: rec.chatId } : undefined;
      setEstado(await api(`${url}/${nome}`, { method: 'POST', body }));
    } catch (e) { setErro(e.message); }
    setBusy('');
  }

  const est = estado?.estado || 'nenhum';
  const carregando = estado === null; // botões só valem depois de saber o estado atual
  const d = rec.detalhes || {};
  const fornecedor = rec.fornecedor?.nome || 'Fornecedor sem nome';

  return (
    <section className={`doc-card doc-${est}`} aria-label={`Nota fiscal de compra nº ${rec.numero}`}>
      <header className="doc-head">
        <span className="doc-ico"><Icon name="grid" size={15} /></span>
        <b>Nota fiscal de compra</b>
        <span className="tag">NF-e nº {rec.numero}</span>
      </header>

      <div className="doc-main">
        <div className="doc-forn">
          <b className="doc-nome" title={fornecedor}>{fornecedor}</b>
          {rec.fornecedor?.cnpj && <small className="muted">CNPJ {cnpj(rec.fornecedor.cnpj)}</small>}
        </div>
        <div className="doc-valor">
          <b>{reais(rec.valor)}</b>
          {rec.emissao && <small className="muted">emitida em {data(rec.emissao)}</small>}
        </div>
      </div>

      <ul className="doc-etiquetas" aria-label="Situação do documento">
        {rec.etiquetas.map((e, i) => <li key={i} className={`doc-etq ${e.nivel}`}>{e.texto}</li>)}
      </ul>

      {rec.avisos?.length > 0 && (
        <ul className="doc-avisos" aria-label="Avisos">
          {rec.avisos.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      )}

      {detalhes && (
        <dl className="doc-detalhes">
          <dt>CT-e (frete)</dt>
          <dd>{d.cte ? `nº ${d.cte.nCT} · ${reais(d.cte.valor)}` : 'sem CT-e por enquanto'}</dd>
          <dt>Conta a pagar</dt>
          <dd>{d.titulo ? `título ${d.titulo.codigo ?? '—'} · vence ${data(d.titulo.vencimento) || '—'}` : 'não encontrada'}</dd>
          {d.tituloFrete && (<><dt>Conta do frete</dt><dd>título {d.tituloFrete.codigo ?? '—'} · {reais(d.tituloFrete.valor)}</dd></>)}
          <dt>Departamento</dt>
          <dd>{d.departamentos?.length ? d.departamentos.map(x => `${x.departamento ?? '—'}${x.percentual != null ? ` (${x.percentual}%)` : ''}`).join(', ') : 'não informado'}</dd>
          <dt>Projeto</dt>
          <dd>{d.projeto || 'não informado'}</dd>
          <dt>Pedido de compra</dt>
          <dd>{d.pedido ? `nº ${d.pedido.numero}` : d.pedidoCitado ? `nº ${d.pedidoCitado.numero} não confere (${d.pedidoCitado.motivos.join('; ')})` : 'nenhum'}</dd>
          {d.nfse?.length > 0 && (<><dt>NFS-e citada</dt><dd>{d.nfse.map(s => `nº ${s.numero}`).join(', ')}</dd></>)}
        </dl>
      )}

      <p className="doc-estado" aria-live="polite">
        {TEXTO[est] || ''}
        {est === 'aprovado' && estado.decididoEm && <small className="muted"> · {quando(estado.decididoEm)}</small>}
      </p>
      {erro && <p className="form-error" role="alert">{erro}</p>}

      <div className="doc-acoes">
        <button type="button" className="btn" aria-expanded={detalhes} onClick={() => setDetalhes(v => !v)}>
          {detalhes ? 'Ocultar detalhes' : 'Ver detalhes'}
        </button>
        {(est === 'nenhum' || est === 'rejeitado' || est === 'expirado') && (
          <button type="button" className="btn btn-primary" disabled={!!busy || carregando} onClick={() => acao('aprovar')}>
            {busy === 'aprovar' ? 'Enviando…' : 'Aprovar'}
          </button>
        )}
        {(est === 'nenhum' || est === 'aguardando') && (
          <button type="button" className="btn" disabled={!!busy || carregando} onClick={() => acao('rejeitar')} title={est === 'aguardando' ? 'Cancela o pedido na Caixa' : undefined}>
            {busy === 'rejeitar' ? 'Rejeitando…' : 'Rejeitar'}
          </button>
        )}
      </div>
    </section>
  );
}
