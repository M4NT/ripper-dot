import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pedidosCompraParam, resumoPedidosCompra } from '../lib/omie.mjs';

test('PesquisarPedCompra usa os nomes da documentação e mostra todas as situações', () => {
  const p = pedidosCompraParam({});
  assert.equal(p.nRegsPorPagina, 10);
  assert.match(p.dDataInicial, /^\d{2}\/\d{2}\/\d{4}$/);
  assert.equal(p.lExibirPedidosFaturados, 'T');
  assert.equal(p.lExibirPedidosRecebidos, 'T');
});

test('resumo dos pedidos traz etapa, fornecedor e valor sem as observações longas', () => {
  const r = resumoPedidosCompra({ nPagina: 1, nTotalPaginas: 2, nTotalRegistros: 2, pedidos_pesquisa: [{
    cabecalho_consulta: { cNumero: '1217', cEtapa: '10', nCodFor: 1, dDtPrevisao: '08/10/2026', dIncData: '07/10/2026', cObs: 'x'.repeat(5000), nCodPed: 9 },
    produtos_consulta: [{ nValTot: 14 }, { nValTot: 35 }], parcelas_consulta: [{ dVencto: '07/11/2026', nValor: 49 }] }] });
  assert.equal(r.pedidos[0].etapa, '10');
  assert.equal(r.pedidos[0].valor_total, 49);
  assert.ok(JSON.stringify(r).length < 600, 'resumo curto');
});
