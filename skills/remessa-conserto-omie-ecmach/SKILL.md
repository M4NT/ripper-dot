---
name: "remessa-conserto-omie-ecmach"
description: "Emite no Omie da ECMACH uma NF-e de Remessa de Produto para conserto/reparo (CFOP 5.915/6.915) a partir de uma NF-e recebida. Use quando o Lucas pedir para mandar uma peça para conserto ou reparo."
---

# Remessa de produto para conserto/reparo (ECMACH, Omie)

Esta skill emite uma NF-e de saída do tipo **Remessa de Produto** no Omie da ECMACH (Equipamentos Industriais LTDA). A mercadoria que entrou por uma NF-e recebida vai para um terceiro que faz o conserto ou reparo.

Exemplo validado: a NF-e 128972 da CMOC Brasil (item PRD00318, CONJUNTO FACA MONT E00336-01-D001 ANG, 1 peça, R$ 11.464,04) foi remetida para ALESSANDRO WALLYSON AFONSO (CNPJ 29.563.410/0001-22, Sertãozinho-SP) na Remessa nº 355 (NF-e 663). A nota foi **autorizada** depois que o cBenef SP070090 foi preenchido.

## Dados de entrada (confirme com o Lucas antes de emitir)

1. **NF-e de origem**: número e fornecedor (por exemplo, "NF 128972 da CMOC").
2. **Destinatário do conserto**: CNPJ ou nome.
3. **Itens e quantidades** a remeter. O padrão é todos os itens da nota com a mesma quantidade.
4. Qualquer observação que deva ir em Informações para a Nota Fiscal. O padrão é não colocar nenhuma.

## Parâmetros fiscais padrão (validados: a NF-e foi autorizada)

| Campo | Valor |
|---|---|
| CFOP | **5.915** se o destinatário estiver em SP (a ECMACH fica em Monte Alto-SP); **6.915** se estiver em outro estado |
| ICMS | CST **41 - Não tributada**, Origem **0 - Nacional** |
| **Código do Benefício Fiscal (cBenef)** | **SP070090**, preenchido na aba **Informações Adicionais** do item |
| IPI | Saída não tributada (CST 53) |
| PIS | CST **06 - Operação tributável (alíquota zero)** |
| COFINS | CST **06 - Operação tributável (alíquota zero)** |
| CEST | **Em branco**, porque não há substituição tributária |
| Frete | 9 - Sem Ocorrência de Transporte |
| Cenário Fiscal | Padrão |
| Local de estoque | Almoxarifado |

O **SP070090** tem como base legal o art. 7º, IX, do RICMS/SP, que trata da não incidência na saída de máquinas, equipamentos, ferramentas ou objetos, e de suas partes e peças, com destino a outro estabelecimento para lubrificação, limpeza, revisão, conserto, restauração ou recondicionamento.

Sem o cBenef, a SEFAZ-SP rejeita a nota com esta mensagem:

> Rejeição: CST com benefício fiscal e não informado o código de benefício fiscal [nItem:1]

Essa rejeição aconteceu na primeira tentativa e foi resolvida com o SP070090. O código genérico "SEM CBENEF" foi desativado em 01/07/2026 e não pode ser usado.

**Não confunda cBenef com CEST.** O CEST (Código Especificador da Substituição Tributária) é outro campo. Ele só se aplica a mercadorias sujeitas a substituição tributária e deve ficar em branco nesta remessa.

Se o motivo da saída não for conserto ou reparo (por exemplo, industrialização, que usa 5.901 ou 5.949), pare e confirme o CFOP e o cBenef com o Lucas.

## Caminho preferencial: API do Omie via Multipli MCP

Use `multipli_buscar` e `multipli_executar` na empresa **ECMACH**. O slug está em /areas/omie-multipli.md.

1. **Buscar a NF-e recebida** (módulo de Recebimento de NF-e / Compras). Para cada item, extraia:
   - o código do produto associado (por exemplo, PRD00318);
   - a descrição;
   - a quantidade;
   - o valor unitário **exato**, com todas as casas decimais (por exemplo, 11.464,040000);
   - o NCM que consta na nota.
2. **Buscar o cliente** pelo CNPJ. Se ele não existir, pergunte ao Lucas antes de cadastrar.
3. **Incluir a Remessa de Produto** (endpoint de remessa de produtos do Omie) com os parâmetros da tabela acima, incluindo o **cBenef SP070090 em cada item**. A previsão é para hoje. Observações e Informações para a Nota Fiscal ficam vazias, salvo se o Lucas pedir algo.
4. **Conferir antes de concluir.** Gere a pré-nota ou DANFE de conferência e verifique cada ponto:
   - A natureza da operação diz "Remessa de Mercadoria ou Bem para Conserto ou Reparo".
   - O CFOP é 5915 ou 6915 e a CST é 041.
   - O cBenef SP070090 está preenchido em todos os itens.
   - Os valores de ICMS, IPI, PIS e COFINS estão **zerados**.
   - O valor total é igual ao da NF recebida.
   - O destinatário, o CNPJ e o endereço estão corretos.
   - **O NCM confere com o da NF recebida.** No exemplo, a nota da CMOC trazia 8474.90.00 e o cadastro do PRD00318 trazia 7308.90.10. Se houver divergência, avise o Lucas antes de emitir.
   Mostre ao Lucas um resumo dessa conferência e **só conclua com a aprovação explícita dele**, porque a emissão gera um documento fiscal.
5. **Concluir a remessa (emitir a NF-e).**
6. **Verificar o retorno da SEFAZ.** Consulte o status da NF-e ou o Painel de NF-e, filtro "Emitidas hoje".
   - Se foi **autorizada**, informe o número da NF-e e a chave e ofereça o DANFE.
   - Se foi **rejeitada**, leia a mensagem na aba "Comunicação com a SEFAZ", corrija o problema e use **Reenviar NF-e**.

## Fallback: navegador (Claude in Chrome ou navegador embutido)

Use este caminho só quando a API não permitir um passo (por exemplo, um campo tributário do item que a API não aceite). O fluxo é em app.omie.com.br, empresa ECMACH:

- **NF recebida**: abra Compras, Estoque e Produção, depois Compras, e busque o fornecedor. Abra o card em Recebido, entre em Itens da NF-e e leia o código, a quantidade e o preço unitário.
- **Nova remessa**: vá em Vendas e NF-e, Remessa de Produto e **Incluir**. Informe o CNPJ do cliente e clique em **Salvar** para gerar o número da remessa. Depois use **Novo Item**.
- **Item**: preencha o produto, o CFOP, a quantidade e o valor unitário. Em seguida preencha as abas ICMS, IPI, PIS e COFINS conforme a tabela. Na aba **Informações Adicionais**, preencha **Código do Benefício Fiscal = SP070090**. A lupa de CEST não deve ser usada para isso. Salve e feche.
- **Conferir**: use **Conferir** e depois "Veja como vai ficar o DANFE (pré-nota)". Todos os blocos devem aparecer em verde. Depois use **Concluir Agora**, sempre com a aprovação do Lucas.
- **Retorno**: veja o Painel de NF-e, em "Emitidas hoje", e a aba Comunicação com a SEFAZ da remessa.
- **Rejeição**: corrija o item, salve o item e a remessa e use **Reenviar NF-e**.

## Regras gerais

- Nunca conclua, emita ou reenvie a NF-e sem o OK explícito do Lucas.
- O valor unitário deve ser **idêntico** ao da NF recebida, sem arredondamento.
- Uma remessa de conserto não gera conta a receber nem tributos. Se aparecer imposto calculado, algo está errado no cenário ou no item.
- Ao terminar, informe o número da remessa, o número e a chave da NF-e e o status na SEFAZ.