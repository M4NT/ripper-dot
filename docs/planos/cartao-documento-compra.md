# Plano: cartão de documento de compra no chat (item 22)

Status: aprovado em parte. Decisões 1 e 2 respondidas (ver fim do documento). Nada foi implementado.

## O que é

Quando um agente traz uma nota fiscal (ou um pedido de compra) no chat, ele mostra um cartão com o resumo do documento, em vez de só texto. A pessoa vê de relance o fornecedor, o valor e se o documento está completo. Se precisar agir, usa os botões do cartão.

## Como fica o cartão

- **Cabeçalho:** fornecedor, número do documento e valor total.
- **Etiquetas de situação:** uma por problema encontrado, usando os códigos que o elo de compras já tem (`lib/elo-compras.mjs`, `GAP`):
  - "sem CT-e", "sem conta", "sem conta do frete", "sem departamento", "sem projeto", "referência inconsistente", "pedido não encontrado".
  - Sem problemas: etiqueta verde "completo".
- **Avisos:** os textos de `warnings` do elo, por exemplo "mais de um título bate".
- **Botões:** "Ver detalhes", "Aprovar" e "Rejeitar". Só essas três.
- **Estado depois do clique:** "Aguardando aprovação na Caixa", depois "Aprovado" ou "Rejeitado", atualizado sozinho.

## Regra de segurança (não negociável)

Nenhum botão do cartão mexe no ERP ou em dado externo direto. O botão "Aprovar" só cria um pedido de aprovação na Caixa, que é o fluxo que já existe (`lib/approvals.mjs`, `web/src/approvals.jsx`). Quem aprova é a pessoa, na Caixa. O cartão mostra o resultado depois.

Isso vale também para a ciência da operação da NF-e (`lib/nfe-ciencia.mjs`): se o cartão tiver ação de ciência, ela passa pela mesma aprovação.

## Como o cartão é gerado

Opção escolhida: **componente React próprio**, alimentado por uma ferramenta do agente (ex.: `mostrar_documento`), que devolve dados estruturados. Não usar botões do OpenUI para isso, porque os botões do OpenUI só disparam mensagens de texto, sem o controle de aprovação e sem rastro.

Dados vêm de:
- notas recebidas: `db.dfe.companies[cnpj].notes` (NF-e distribuídas pela Receita);
- elo: `buildChain` (lib/elo-compras.mjs), que junta nota, CT-e, título e pedido;
- estado da aprovação: `lib/approvals.mjs`.

## Fases

1. **Componente visual** com dados fixos num teste. Sem ação. Confere layout em 375 px e 1280 px, nos dois temas, com nome de fornecedor muito longo.
2. **Ferramenta do agente** e dados reais de uma nota (sem botões).
3. **Botões**, ligados à aprovação na Caixa. Testar: clique cria o pedido, não executa nada; "Rejeitar" não cria nada no ERP e não envia aviso a ninguém.
4. **Estado ao vivo:** o cartão reflete a aprovação (sem recarregar a conversa).

## Critérios de aceite

- Nenhum clique executa ação externa sem passar pela Caixa.
- Cada problema do elo aparece como etiqueta; documento completo mostra só "completo".
- Re-renderizar a conversa (streaming, rolagem) não duplica o cartão.
- Fornecedor com nome longo corta com reticências, sem estourar a largura no celular.
- Testes unitários para o mapeamento de problema para etiqueta, e teste de interface para o clique.

## Riscos

- NF-e sem ciência dentro do prazo de 10 dias (regra da NT 2020.001) precisa de etiqueta própria, senão a pessoa perde o prazo sem ver.
- Documento sem CT-e ainda pode chegar depois: a etiqueta precisa dizer "por enquanto", não "faltou".
- Dados de CNPJ aparecem no cartão: confirmar se pode mostrar completo ou só parcial.

## Decisões

1. **Respondida:** as três ações (Ver detalhes, Aprovar, Rejeitar) bastam.
2. **Respondida:** "Rejeitar" não avisa ninguém. Quem controla é o usuário.
3. **Padrão adotado, a confirmar:** só nota fiscal na primeira versão. Pedido de compra entra depois.
4. **Padrão adotado, a confirmar:** CNPJ completo no cartão, por ser dado da própria empresa do usuário.

## Estimativa (grosseira)

Fase 1: 1 dia. Fase 2: 2 dias. Fase 3: 2 dias. Fase 4: 1 dia. Total perto de 6 dias úteis, sem contar a revisão das decisões acima.
