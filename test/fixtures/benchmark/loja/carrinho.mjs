// Carrinho da loja: soma itens e aplica cupom percentual.
export function total(itens, descontoPercentual = 0) {
  const bruto = itens.reduce((n, i) => n + i.preco * i.qtd, 0);
  const desconto = bruto * descontoPercentual / 10;
  return Math.round((bruto - desconto) * 100) / 100;
}
