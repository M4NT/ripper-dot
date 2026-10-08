---
name: "recebimento-nfe-cte-omie"
description: "Processo de verificação e recebimento de NF-e/CT-e de compra no Omie para a ECMACH, cruzando com o Pedido de Compra. Use esta skill sempre que o Lucas pedir para \"verificar\" um pedido de compra, uma NF-e, um CT-e, pedir para \"receber\" uma nota, perguntar se pode \"faturar\", checar se o CFOP/departamento/projeto estão corretos, ou mandar uma imagem de card do Omie (Pedido/NF-e/CT-e) pedindo conferência. Cobre também o que funciona e o que não funciona via API do Omie nesse módulo, e o fallback via navegador (Claude in Chrome, no Cowork) para o que a API não permite — consulte antes de tentar alterar CFOP, associar produto, ou concluir um recebimento."
---

# Recebimento de NF-e/CT-e de Compra (Omie) — ECMACH

Skill para verificar e processar o recebimento de notas de compra da ECMACH no Omie,
cruzando Pedido de Compra × NF-e × CT-e, aplicando as correções possíveis via API
(departamento, projeto, CFOP) e, quando a API não permite (associação de produto), via
navegador antes de concluir o recebimento.

## Visão geral do fluxo

```
Pedido de Compra (aprovado)
  → NF-e faturada pelo fornecedor (não recebida)
  → [associação de item a produto existente + vínculo ao pedido]
        — API rejeita; usar navegador (Claude in Chrome / Cowork) — ver Passo 3.5
  → [ajustes de departamento/projeto/CFOP] — via API, se ainda não recebido
  → Concluir Recebimento (API: ConcluirRecebimento, ou via navegador — ver Passo 5)
  → Conta a pagar gerada automaticamente
```

Card do Omie mostra 3 possíveis documentos por operação: **Pedido**, **NF-e** e, se houver
frete, **CT-e** (transportadora). Sempre trate os três.

Duas vias de acesso ao Omie nesta skill:
- **Multipli MCP** (`multipli_executar` / `omie.chamada_api`) — para consultas e para os
  ajustes que a API aceita (departamento, projeto, CFOP de item, concluir recebimento).
- **Navegador** — único caminho que funciona para associar item de NF-e a produto existente
  (o que também resolve o vínculo com o Pedido de Compra). Ver Passo 3.5.
  - Preferência: **Claude in Chrome** (`mcp__claude-in-chrome__*`) quando disponível no Cowork.
  - Fallback: **navegador embutido** (`mcp__remote-devices__Claude_Browser__*`) quando Claude
    in Chrome não estiver conectado — fluxo idêntico, só muda o prefixo das ferramentas.

## Passo 1 — Localizar o Pedido de Compra

Use o conector **Multipli** (a chave direta `omie-ecmach` não tem permissão pro módulo de
Compras — retorna vazio):

```
Multipli MCP:multipli_executar
capacidade_id: omie.compras.listar_pedidos_compra
parametros: {"dDataInicial": "...", "dDataFinal": "...", "empresa": "ecmach"}
```

Localize pelo `cNumero` (número visível no card, ex.: "1142"). Extraia:
- `nCodPed` (ID interno do pedido)
- `nCodProj` (projeto) e `cCodDepto` em `departamentos_consulta` (departamento)
- Itens em `produtos_consulta`: `cProduto` (PRD), `nCodProd`, `nQtde`, `nValUnit`, `nValTot`
- Confirme o valor total bate com o valor mostrado no card antes de prosseguir.

Nota: o resultado de `listar_pedidos_compra` costuma exceder o limite de tokens em uma
única resposta — o texto completo é salvo em arquivo e a ferramenta devolve o caminho.
Use `Grep`/`Read` com offset no arquivo para achar o `cNumero` procurado em vez de ler tudo
de uma vez. A paginação (`pagina`) funciona; o filtro por data (`dDataInicial`/`dDataFinal`)
**não funciona** — ele sempre devolve a página mais recente independente do filtro. Para
achar um pedido específico, vá incrementando `pagina` (20 registros por página, ordenado
do mais recente pro mais antigo) até encontrar o `cNumero`.

## Passo 2 — Localizar a NF-e / CT-e pela chave de acesso

`ConsultarRecebimento` exige `cChaveNfe` (44 dígitos) ou `nIdReceb`. Não existe busca
por número de nota sem a chave. Obtenha-a pelo kanban do Omie:

### 2a — Obter a chave pelo kanban (método preferido)

1. Abra o kanban de Compras (mesmo fluxo do Passo 3.5, passos 1–7): navegue até
   `https://portal.omie.com.br/meus-aplicativos` → "Acessar" ECMACH → card vermelho
   "Compras, Estoque e Produção" → "Cadastrar Compras a Receber".
2. Na caixa de busca do kanban, digite o **número da NF-e** (ex.: `000007222`) e Enter.
   O board filtra e exibe o card correspondente.
3. **Duplo clique no corpo do card** (no texto do fornecedor/valor, não nos ícones) para
   abrir a tela "Recebimento NF-e Nº ..."
4. Role a tela do formulário até o final — a **chave de acesso de 44 dígitos** aparece
   no rodapé da página, abaixo de todos os campos.
5. Copie a chave e use em `ConsultarRecebimento`.

### 2b — Pedir ao Lucas (fallback)

Se o navegador não estiver disponível ou o kanban não exibir o card, peça a chave
diretamente ao Lucas.

### 2c — Consultar pela chave

```
Multipli MCP:multipli_executar
capacidade_id: omie.chamada_api
parametros: {
  "call": "ConsultarRecebimento",
  "empresa": "ecmach",
  "endpoint": "produtos/recebimentonfe/",
  "param": {"cChaveNfe": "...44 dígitos..."}
}
```

Funciona igual para NF-e (`cModeloNFe: "55"`) e CT-e (`cModeloNFe: "57"`, sem itens,
com dados em `transporte`). Guarde o `nIdReceb` retornado — é usado em todos os passos
seguintes (API e navegador).

## Passo 3 — Pente-fino (o que sempre checar)

1. **Valor total** bate com o pedido e com o card mostrado pelo Lucas.
2. **Associação de produto** (`itensCabec.cAssociarExistente`): se vier `"N"` com
   `nIdProduto: 0`, o item NÃO está vinculado — vai criar produto novo em vez de usar o
   PRD já cadastrado. Também confira se o `nIdProduto` associado (quando `"S"`) é
   realmente o mesmo produto do pedido — já houve caso de item associado a um produto
   existente **errado** (nIdProduto diferente do `nCodProd` do item do pedido), mesmo
   com descrição parecida. **Corrige via navegador** (ver Passo 3.5).
3. **Vínculo com o Pedido de Compra** (`itensCabec.nIdPedido` / `nIdItPedido`): se vier
   ausente/zero, a NF-e não está referenciando o pedido, mesmo que os valores batam.
   Resolve-se automaticamente ao associar o item ao produto certo *através da lista de
   pedidos pendentes* no Passo 3.5 (não ao associar por busca livre de produto).
4. **Departamento** (`departamentos`, no nível raiz da resposta): se `null`, falta
   preencher. Editável via API (ver Passo 4).
5. **Projeto** (`infoAdicionais.nIdProjeto`): se ausente, falta preencher. Editável via
   API (ver Passo 4). Projeto e Departamento **têm códigos diferentes mas devem ter a
   mesma descrição** (ex.: ambos "ECM-0071_26") — confirme consultando
   `geral_projetos_consultar_projeto` e `geral_departamentos_consultar_departamento`.
6. **CFOP de entrada** (`itensAjustes.cCFOPEntrada` por item, ou `cteCfopEntrada` no
   CT-e): ver regra de CFOP abaixo.
7. **Vencimento** (`parcelas.parcelasLista[].dVencimento`) bate com o do pedido.

## Regra de CFOP

> ⚠️ **A ECMACH nunca realiza revenda.** Todas as compras são para **industrialização**
> (insumo/matéria-prima para fabricação de produto próprio) ou **uso e consumo interno**
> da empresa. Nunca use CFOPs de comercialização/revenda (1.102, 1.403).

CFOP de entrada depende da **finalidade** da compra. Use a tabela abaixo e, quando
hover dúvida, aplique a lógica de inferência da seção seguinte:

| Finalidade | Sem ICMS-ST | Com ICMS-ST |
|---|---|---|
| Industrialização — insumo/matéria-prima que fisicamente integra o produto fabricado | **1.101** | **1.401** |
| Uso e consumo — material consumido pela empresa que NÃO entra no produto final | **1.556** | **1.557** |

Com ou sem ICMS-ST depende da NF-e do fornecedor: se houver destaque de ICMS-ST na nota,
use o código ST; caso contrário, o sem ST.

Para CT-e (frete), o padrão observado é **5.352 (saída) → 1.352 (entrada)** quando o
transporte é "Prestação de Serviço de Transporte a Estabelecimento Industrial" — mas
confira sempre o campo "CFOP no CT-e" antes de assumir, pode haver outro código do
grupo 535x.

## Como inferir a finalidade pelo tipo de produto

A ECMACH fabrica equipamentos industriais sob encomenda. Use esta lógica para determinar
o CFOP **sem precisar perguntar ao Lucas** quando o produto for óbvio:

### → CFOP 1.101 / 1.401 — Industrialização (entra no produto)

Materiais que fisicamente compõem ou são aplicados no equipamento entregue ao cliente:

- Barras, chapas, tubos, tarugos de **aço, inox, alumínio** e outros metais
- **Tintas, vernizes, primer, catalisadores** aplicados sobre o equipamento
- **Parafusos, porcas, arruelas, rebites** e fixadores usados na montagem
- Componentes eletromecânicos instalados no equipamento (motores, válvulas, etc.)
- Insumos de soldagem (eletrodos, arame, gás) consumidos na fabricação
- Materiais de acabamento aplicados ao produto final

### → CFOP 1.556 / 1.557 — Uso e consumo (NÃO entra no produto)

Materiais consumidos internamente pela empresa, que não fazem parte do produto entregue:

- **Materiais de limpeza e higiene**: papel higiênico, papel toalha, sabão, detergente,
  desinfetante, pano de limpeza, vassoura, rodo, saco de lixo
- **Materiais de escritório**: canetas, papel A4, cartuchos de impressora, grampos,
  pastas, envelopes
- **EPI e segurança do trabalho**: luvas, óculos, capacetes, botinas, protetores
  auriculares, máscaras — usados pelos funcionários, não ficam no produto
- **Uniformes e vestuário** de uso dos funcionários
- **Alimentação e copa**: café, açúcar, copos descartáveis, guardanapos
- **Manutenção de máquinas e instalações**: graxas, óleos lubrificantes para máquinas
  da fábrica, lâmpadas, peças de reposição de equipamentos próprios da empresa
- **Material de embalagem** para transporte do produto (caixas, plástico bolha, fitas)
  quando o custo de embalagem não é repassado como parte do produto

> **Regra prática:** se o item vai embora junto com o equipamento entregue ao cliente →
> industrialização (1.101). Se fica na empresa ou é descartado no processo → uso e
> consumo (1.556).

## Passo 3.5 — Associar item a produto existente via navegador

Só funciona via navegador (Claude in Chrome preferencial; fallback: navegador embutido).
Carregar ferramentas via `ToolSearch` se estiverem deferidas.

**Roteiro (repita a partir do passo 9 para cada item que precisa de correção):**

1. Confirmar que um navegador está disponível:
   - Claude in Chrome: `list_connected_browsers` deve retornar ao menos um Chrome.
   - Navegador embutido: tentar `tabs_context` — se responder, está disponível.
2. Abrir/obter uma aba (`tabs_context_mcp {createIfEmpty: true}` ou `tabs_context`).
3. Navegar para `https://portal.omie.com.br/meus-aplicativos`. Tirar screenshot pra confirmar.
   - Se a primeira ação de `computer` na aba nova der "Permission denied for this action
     on this domain", **não é falha real**: navegue de novo (conta como autorização inicial
     do domínio) e repita o screenshot — na 2ª tentativa funciona.
4. Clicar em "Acessar" no card da empresa "ECMACH EQUIPAMENTOS INDUSTRIAIS LTDA". Isso
   abre uma **nova aba** — pegue o `tabId` dela no retorno do clique.
5. Na home da ECMach, clicar no card vermelho **"Compras, Estoque e Produção"**.
6. Clicar em **"Cadastrar Compras a Receber"** — abre o **kanban de Compras**.
7. Clicar na caixa de busca do kanban, digitar o **número da NF-e** e apertar **Enter**.
   - **Não aperte Escape** — isso reseta o filtro.
8. **Duplo clique no corpo do card** (no texto do fornecedor/valor, não nos ícones) para
   abrir a tela "Recebimento NF-e Nº ...". O menu de três pontinhos e o avatar **não abrem**
   o formulário de recebimento — evite-os.
9. Na tela de recebimento, clicar na linha do item a corrigir na grade "Itens da NF-e"
   para selecioná-la (clique real no viewport — ver nota JS abaixo), depois clicar em
   **"Associar a um produto existente"** (link acima da grade).
10. No modal, clicar em **"Exibir todos os produtos não recebidos"** (canto superior
    direito). Isso exibe uma tabela com todos os itens de pedidos de compra pendentes.
11. Definir o filtro da coluna **"Origem"** com o número do pedido de compra:
    - O campo pode estar fora da área visível do modal — use `scrollIntoView()` via JS
      para trazê-lo ao viewport antes de interagir.
    - Limpe qualquer valor anterior no campo antes de digitar.
    - Para definir o valor programaticamente (grid Infragistics), use o setter nativo:
      ```js
      const inp = document.querySelector('input[data-col="Origem"]'); // adapte o seletor
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
        .set.call(inp, '1185');
      inp.dispatchEvent(new Event('input', {bubbles: true}));
      inp.dispatchEvent(new Event('change', {bubbles: true}));
      inp.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
      ```
    - O filtro persiste entre itens do mesmo pedido — não precisa refazer, mas sempre
      confirme antes de assumir que está correto.
12. Clicar na linha certa (confira produto/quantidade/valor unitário contra o item do
    pedido). **Importante:** a grade Infragistics (ui-iggrid) **não responde a eventos JS
    sintéticos** — cliques via `.click()`, `mousedown`, `dispatchEvent` não selecionam
    a linha. É obrigatório um clique real no viewport nas coordenadas corretas da linha.
13. Clicar em **"Confirmar"** — use o botão **inferior direito** do modal (o de confirmação
    da linha selecionada). Há dois botões "Confirmar" no modal:
    - O do **topo** (y≈155) confirma a busca livre por produto — não é esse.
    - O do **rodapé direito** (y≈635 antes de rolar o modal, y≈496 após) confirma a linha
      selecionada na tabela de pedidos — é esse.
    - Se o botão não estiver visível, role o container do modal até o final:
      ```js
      const d = [...document.querySelectorAll('[class*="dialogContent"]')]
        .find(el => el.scrollHeight > el.clientHeight);
      if (d) d.scrollTop = d.scrollHeight - d.clientHeight;
      ```
14. Repetir os passos 9–13 para cada item da NF-e que precisar de correção.
15. Depois de todos os itens corrigidos, clicar em **"Salvar"** no painel lateral direito.
16. **Ao salvar**, o Omie exibe um dialog:
    - **"Concluir agora mesmo"** — use se todos os ajustes já estão corretos.
    - **"Entendi"** — use se ainda precisa fazer ajustes via API (Passo 4) antes de concluir.
17. Confirmar via API (`ConsultarRecebimento`) que `itensCabec.cAssociarExistente` virou
    `"S"` com o `nIdProduto`/`nIdPedido`/`nIdItPedido` certos em todos os itens antes de
    seguir para o Passo 4.

**Nota sobre IDs de modal:** O Omie gera IDs dinâmicos para containers de dialog
(ex.: `dialogContent-1077`, `dialogContent-50651`) que mudam entre sessões. Sempre
busque dinamicamente com `document.querySelectorAll('[class*="dialogContent"]')` em vez
de hardcodar o ID.

Essa associação via tela já resolve **produto certo + vínculo com o pedido** ao mesmo
tempo (diferente de associar por busca livre de produto no topo do modal, que só resolve
o produto, sem vincular ao pedido).

## Passo 4 — Ajustes via API (antes de concluir)

**Departamento:**
```json
{
  "call": "AlterarRecebimento", "endpoint": "produtos/recebimentonfe/",
  "param": {
    "ide": {"nIdReceb": <id>},
    "departamentos": [{"cCodDepartamento": "<cod>", "pDepartamento": 100, "vDepartamento": <valor>}]
  }
}
```

**Projeto:**
```json
{
  "call": "AlterarRecebimento", "endpoint": "produtos/recebimentonfe/",
  "param": {
    "ide": {"nIdReceb": <id>},
    "infoAdicionais": {"nIdProjeto": <codigo_projeto>}
  }
}
```

**CFOP de item de NF-e (produto):**
```json
{
  "call": "AlterarRecebimento", "endpoint": "produtos/recebimentonfe/",
  "param": {
    "ide": {"nIdReceb": <id>},
    "itensRecebimentoEditar": [
      {"itensAjustes": {"cCFOPEntrada": "1.101"}, "itensIde": {"cAcao": "EDITAR", "nSequencia": 1}}
    ]
  }
}
```
Pode incluir mais de um objeto na mesma lista (`nSequencia` 1, 2, 3...) para ajustar
vários itens em uma única chamada.

⚠️ **Sempre reconsulte antes de concluir que uma escrita falhou.** A leitura
(`ConsultarRecebimento`) às vezes tem delay e mostra o valor antigo logo após a escrita —
espere alguns segundos (ou faça outra chamada no meio) e consulte de novo antes de
declarar que não funcionou.

## Passo 5 — Concluir o recebimento

Quando todos os itens do checklist estão ok, **conclua diretamente** — não é necessário
pedir confirmação ao Lucas antes de concluir.

**Via API** (método preferido quando os ajustes foram feitos por API):
```json
{"call": "ConcluirRecebimento", "endpoint": "produtos/recebimentonfe/", "param": {"nIdReceb": <id>}}
```
Gera a conta a pagar automaticamente (`parcelas.parcelasLista[].nIdTitulo`). Confirme
com uma última `ConsultarRecebimento`: `infoCadastro.cRecebido` deve virar `"S"` e a
parcela deve trazer `nIdTitulo` preenchido.

**Via navegador** (alternativas equivalentes):
- Abrir a NF-e no kanban e clicar em **"Concluir"** no painel lateral direito; o Omie
  exibe o dialog de confirmação — clicar **"Concluir agora mesmo"** para finalizar.
- **Arrastar o card do Pedido de Compra** diretamente para a coluna **"Recebido"** no
  kanban. O Omie exibe um toast de sucesso e o card passa para o status Recebido.
  É a forma mais rápida quando já está tudo certo.

## Limitações confirmadas da API (não tentar via API / usar navegador ou avisar o Lucas)

- ⚠️ **Associar item de NF-e a produto existente** — a API rejeita com erro de estrutura
  em qualquer lugar que se tente (`itensCabec`, direto no item, `itensAjustes`). **Use o
  navegador** (Passo 3.5) — funciona e já resolve o vínculo com o pedido de compra também.
- ❌ **CFOP de entrada de CT-e** (`cteCfopEntrada`) — aceita a chamada, retorna sucesso,
  mas nunca persiste via API. Ainda não testado via navegador para CT-e; se precisar,
  avisar o Lucas que provavelmente só na tela.
- ❌ **Projeto do CT-e** — não existe campo gravável equivalente ao de NF-e; só aparece
  depois de preenchido manualmente na tela.
- ⚠️ **Qualquer edição após `cRecebido: "S"` (concluído)** — normalmente bloqueada
  (`"O Recebimento já foi concluído!"`). **Exceção:** se o Lucas já reabriu/cancelou o
  recebimento manualmente na tela antes de pedir a alteração, a API aceita normalmente —
  sempre pergunte se o documento foi reaberto manualmente caso o comportamento pareça
  inconsistente com essa regra.
- ⚠️ **Rate limit agressivo em `ConsultarRecebimento`** — chamadas repetidas rápidas ao
  mesmo documento retornam "Consumo redundante detectado, aguarde N segundos". Intercale
  com outras chamadas (ex.: consultar departamento/projeto) ou aguarde antes de reconsultar.
- ⚠️ **Filtro de data em `omie.compras.listar_pedidos_compra`** — `dDataInicial`/
  `dDataFinal` são ignorados pela API; a busca real precisa ser feita paginando
  (`pagina`) e conferindo o `cNumero` de cada página.

## O que funciona bem

- ✅ `ConsultarRecebimento` por chave — funciona pra NF-e e CT-e.
- ✅ Obter chave de acesso pelo kanban — buscar NF-e → abrir card → rolar ao rodapé.
- ✅ Departamento via `AlterarRecebimento` — funciona, mas em NF-e com itens só gruda de
  verdade depois que a associação de produto (via navegador) já foi feita.
- ✅ Projeto via `infoAdicionais.nIdProjeto` — funciona em NF-e (documento não concluído).
- ✅ CFOP de item de produto via `itensAjustes.cCFOPEntrada` — funciona (com o delay
  de leitura mencionado acima).
- ✅ `ConcluirRecebimento` — funciona e gera a conta a pagar.
- ✅ **Associação de produto + vínculo ao pedido via navegador**
  — funciona de ponta a ponta seguindo o roteiro do Passo 3.5, incluindo casos em que o
  item já estava associado a um produto existente **errado**.
- ✅ **Arrastar card para "Recebido" no kanban** — funciona como alternativa rápida ao
  `ConcluirRecebimento` via API ou ao "Concluir" dentro do formulário da NF-e.
- ✅ **Navegador embutido** (`mcp__remote-devices__Claude_Browser__*`) como fallback
  quando Claude in Chrome não estiver conectado — fluxo idêntico, só muda o prefixo.

## Checklist final antes de dizer "tudo certo"

- [ ] Valor bate entre Pedido, NF-e e (se houver) CT-e
- [ ] Produto associado ao produto certo do pedido (não "criar novo" e não outro produto
      existente por engano)
- [ ] Item vinculado ao Pedido de Compra (`nIdPedido`/`nIdItPedido` preenchidos)
- [ ] Departamento preenchido
- [ ] Projeto preenchido, com **mesma descrição** do departamento
- [ ] CFOP correto: 1.101/1.401 (industrialização) ou 1.556/1.557 (uso e consumo) — nunca revenda
- [ ] Vencimento bate com o pedido
- [ ] Recebimento concluído (`cRecebido: "S"`) e título de conta a pagar gerado