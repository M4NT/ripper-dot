---
name: "listar-pedidos-venda-kanban-omie"
description: Lista por API os pedidos de venda em aberto da ECMACH no Omie, por coluna do kanban de Vendas, com o projeto e o departamento vinculados, anota as pendências no projeto e cria uma tarefa no Google Tasks (lista da Ecmach) para cada pendência. Use quando o Lucas pedir a lista/carteira de pedidos em aberto.
---

# Listar pedidos em aberto do kanban de Vendas (Omie) — ECMACH

Reproduz por API o que aparece na tela **Vendas e NF-e → Vendas** do Omie: os pedidos
de venda ainda não faturados, separados pelas três primeiras colunas do kanban, **cada um
com o código do projeto e do departamento vinculados**, e confere se estão preenchidos.

O Lucas às vezes chama isso de "pedidos de compra" (é o pedido de compra *do cliente*).
No Omie são **Pedidos de Venda de Produto**. Não confundir com o módulo de Compras.

Somente leitura no Omie: esta skill não altera nada lá. Corrigir projeto/departamento
só se o Lucas pedir.

## Colunas do kanban × etapa da API

| Coluna na tela | `etapa` |
|---|---|
| Pedido Confirmado | `10` |
| Pedido em produção | `20` |
| Prod/Equip na expedição | `80` |

⚠️ A coluna de expedição é a etapa **80** (etapa personalizada), **não a 50**. A etapa 50
só tem pedidos antigos encerrados/cancelados. As etapas 30 e 40 não têm registros (a API
responde "Não existem registros para a página [1]" — é vazio, não erro).

Se o Lucas mandar um print com coluna nova ou contagem que não bate, descubra a etapa de
um pedido da coluna com `ConsultarPedido` + `{"numero_pedido": <n>}` e leia `cabecalho.etapa`.

## Passo 1 — Buscar cada etapa

Uma chamada por etapa (10, 20 e 80), via Multipli MCP. `omie.chamada_api` exige
`confirmar: true` mesmo sendo leitura:

```
Multipli MCP:multipli_executar
capacidade_id: omie.chamada_api
confirmar: true
parametros: {"empresa": "ecmach", "endpoint": "produtos/pedido/", "call": "ListarPedidos",
             "param": {"pagina": 1, "registros_por_pagina": 100,
                       "apenas_importado_api": "N", "etapa": "10"}}
```

- O filtro `etapa` **funciona** em `ListarPedidos` (aceita inclusive "80").
- Se `total_de_paginas` > 1, pagine.
- **Não use `apenas_resumo: "S"`**: o resumo vem sem `total_pedido`, sem `lista_parcelas`
  e sem `departamentos`.
- `ListarEtapasPedido` (`produtos/pedidoetapas/`) não serve: só aceita etapas 10–70 e
  devolve o histórico inteiro de movimentações.
- O retorno é grande (traz todos os impostos por item). Se for salvo em arquivo, extraia
  com `python3` só os campos do Passo 3.

## Passo 2 — Filtrar só o que está em aberto

A API devolve também pedidos antigos que a tela esconde. Mantenha apenas os que tiverem:

- `cabecalho.encerrado` diferente de `"S"` (encerrados = "Pedido Faturado Parcialmente"), **e**
- `infoCadastro.cancelado` diferente de `"S"`, **e**
- `infoCadastro.faturado` diferente de `"S"`.

Referência (08/10/2026): etapa 10 devolveu 11 registros → 5 em aberto; etapa 20, 5 → 3;
etapa 80, 8 → 1. Bateu exatamente com o contador de cada coluna na tela.

## Passo 3 — Campos de cada pedido

| Na lista | Campo da API |
|---|---|
| Nº do pedido | `cabecalho.numero_pedido` |
| Cliente | `cabecalho.codigo_cliente` → nome (ver abaixo) |
| Valor | `total_pedido.valor_total_pedido` |
| Data do card ("p/ dd/mm") | `lista_parcelas.parcela[0].data_vencimento` (vencimento da 1ª parcela) |
| Previsão de faturamento | `cabecalho.data_previsao` |
| PC do cliente | `informacoes_adicionais.numero_pedido_cliente` |
| **Projeto** | `informacoes_adicionais.codProj` → nome (Passo 4) |
| **Departamento** | `departamentos[].cCodDepto` → descrição (Passo 4) |
| Itens | `det[].produto.descricao` (opcional) |
| Código interno | `cabecalho.codigo_pedido` (útil para consultas seguintes) |

**Status do card:** `data_previsao` anterior a hoje → "Faturamento atrasado"; senão
"Aguardando faturamento". Use a ferramenta de data/hora para saber o dia de hoje.

**Nome do cliente:** a listagem só traz o código. Clientes recorrentes:

| `codigo_cliente` | Cliente |
|---|---|
| 10942473690 | BIRLA CARBON |
| 7385244178 | BIRLA CARBON BRASIL LTDA. |
| 7332630515 | SAINT-GOBAIN CANALIZACAO LTDA |
| 10865490965 | ICAL INDUSTRIA DE CALCINACAO LTDA (em recuperação judicial) |

Código fora da tabela → `omie.cadastros.consultar_cliente` com
`{"empresa": "ecmach", "codigo_cliente_omie": <n>}` (esta não pede `confirmar`).

## Passo 4 — Projeto e departamento

**Regra da casa:** todo pedido tem projeto **e** departamento vinculados, e os dois têm o
**mesmo código** (padrão `ECM-NNNN_AA`, ex.: `ECM-0054_26`). O pedido guarda só os IDs
numéricos; é preciso traduzir para o nome.

**Projeto** — uma chamada por pedido (a lista completa tem 360+ projetos em 4 páginas,
não compensa):

```
capacidade_id: omie.chamada_api   (confirmar: true)
parametros: {"empresa": "ecmach", "endpoint": "geral/projetos/",
             "call": "ConsultarProjeto", "param": {"codigo": <codProj>}}
```
O código ECM vem em `nome`. `codProj` = 0 ou ausente → pedido **sem projeto**.

**Departamento** — liste tudo e cruze pelo `codigo`:

```
parametros: {"empresa": "ecmach", "endpoint": "geral/departamentos/",
             "call": "ListarDepartamentos", "param": {"pagina": 1, "registros_por_pagina": 100}}
```
- Máximo de **100 por página** (pedir 500 devolve 100). São ~120 registros: busque a
  página 2 também — os departamentos recentes estão no fim.
- Às vezes responde `SOAP-ERROR: Unexpected response from server`; repita a chamada.
- O código ECM vem em `descricao`. Pedido sem o nó `departamentos` → **sem departamento**.
- Use essa mesma lista para saber se o departamento com o código do projeto já existe.

**Conferência — marque como pendência quando:**
- o pedido não tem projeto;
- o pedido não tem departamento (diga se o departamento com o código do projeto existe
  no cadastro ou se precisa ser criado);
- nome do projeto ≠ descrição do departamento (compare ignorando maiúsculas/minúsculas);
- projeto ou departamento está inativo.

## Passo 5 — Entregar

Responda em português, no chat, com uma tabela por coluna do kanban (na ordem da tela),
ordenada por nº do pedido, com: Pedido, Cliente, Valor (R$ no formato brasileiro),
**Projeto**, **Departamento**, Previsão, Vencimento, PC do cliente e Status. Feche com o
subtotal de cada coluna, o total geral e a quantidade de pedidos, e destaque os atrasados
e os que têm pendência de projeto/departamento.

Se o Lucas mandou print da tela, confira a contagem e os valores contra o print e avise se
algo divergir. Só gere planilha/arquivo se ele pedir.

## Passo 6 — Anotar as pendências no projeto do Claude

As pendências ficam no documento `claude/pendencias-pedidos-venda-omie.md` do projeto
Ecmach (ferramenta Projects). A cada execução:

1. Leia o documento atual (`project_read`).
2. Reescreva-o (`project_write` no mesmo caminho) com: a tabela de **pendências abertas**
   da conferência de hoje, a tabela dos pedidos corretos, e uma linha nova no
   **Histórico** com a data e o resumo. Pendência que sumiu (corrigida ou pedido
   faturado) sai da tabela de abertas e vira uma linha no histórico.
3. Se nada mudou desde a última conferência, não regrave o documento.

## Passo 7 — Criar tarefa no Google Tasks para cada pendência

Toda pendência encontrada vira uma tarefa no **Google Tasks**, pelo Multipli MCP, na lista
de tarefas da Ecmach (pendência da ECMACH sempre vai nela, nunca na lista padrão). As
tarefas com vencimento aparecem também no Google Agenda.

- **Conta:** a do usuário logado no Multipli (`debora`); não passe `usuario_tarefas`.
- **Lista:** o título está escrito **"Ecamch "** (letras trocadas; pode ser corrigido para
  "Ecmach"). Id em 08/10/2026: `bXQ4QWR3LVM3QUtzRzNRNg`.

1. **Achar a lista** — `google.tasks.listar_listas` (leitura, não pede `confirmar`).
   Procure o título "Ecamch" ou "Ecmach" (ignore maiúsculas e espaços) e use o `id`.
   Se não existir, **não crie em outra lista**: avise o Lucas e pare este passo.
2. **Evitar duplicata** — `google.tasks.listar_tarefas` com `{"lista_id": "<id>"}`. Se já
   houver tarefa **aberta** (`status: needsAction`) cujo título começa com `Pedido <nº> –`,
   não crie de novo.
3. **Criar** — `google.tasks.criar_tarefa` com `confirmar: true`, uma tarefa por pedido,
   parâmetros `lista_id`, `titulo` e `notas` (testados em 08/10/2026):
   - **Título:** `Pedido <nº> – <cliente> – <pendência resumida>`
     (ex.: `Pedido 344 – Birla Carbon Brasil – sem departamento (ECM-0053_26)`)
   - **Notas:** valor do pedido, coluna do kanban, projeto e departamento atuais, o que
     precisa ser feito (ex.: "criar o departamento ECM-0053_26 no Omie e vincular ao
     pedido") e a data da conferência.
   - **Vencimento:** a data da conferência, para a tarefa aparecer no Google Agenda. O
     campo volta como `vencimento` na listagem; o nome do parâmetro na criação **não foi
     testado** — se for recusado, crie sem ele e avise.
4. Na resposta, diga quais tarefas foram criadas e quais já existiam.
5. Pendência que sumiu numa conferência seguinte: avise o Lucas que a tarefa correspondente
   pode ser concluída; só conclua (`google.tasks.concluir_tarefa`) se ele pedir.

Se o Google Tasks devolver `GOOGLE_REFRESH_AUSENTE` ou `GOOGLE_DELEGACAO_NEGADA` (aconteceu
na manhã de 08/10/2026, antes de a conta ser autorizada), não insista nem tente contas de
outras pessoas: entregue as pendências no chat, mantenha o documento do projeto atualizado e
avise que as tarefas não foram criadas e por quê.

## Execução automática diária

Existe uma tarefa agendada ("Pendências pedidos de venda Ecmach") que roda esta skill todo
dia perto das 6h (horário de São Paulo), sem ninguém acompanhando: nesse caso não faça
perguntas, não altere nada no Omie e termine com um resumo curto do que encontrou e criou.

Para conferir um pedido específico antes de faturar, a skill é
`conferencia-pedido-venda-omie`.
