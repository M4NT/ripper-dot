---
name: "conferencia-pedido-venda-omie"
description: "Confere um pedido de VENDA do Omie (ECMACH) antes de faturar, confrontando com o arquivo do pedido de compra que o Lucas manda (PDF/ZIP do portal do cliente: Nimbi, Ariba, SAP etc.). Use quando ele pedir para \"conferir/verificar o pedido de venda X\", \"o que falta para faturar\", \"esse pedido está apto a ser faturado?\", \"verifica essa pré-nota\", perguntar se o NCM/CFOP/ICMS está correto, anexar o PDF do pedido + o PC do cliente, ou mandar print da tela \"Conferindo o Pedido\" do Omie com erro. Também cobre como aplicar as correções por API e como escalar as dúvidas fiscais para a contabilidade. NÃO usar para recebimento de NF-e/CT-e de compra — para isso use recebimento-nfe-cte-omie."
---

# Conferência de Pedido de Venda antes de Faturar (Omie) — ECMACH

Cruza **Pedido de Venda do Omie × Pedido de Compra do cliente** e diz o que falta para o
pedido estar apto a faturar. Depois, com decisão do Lucas, aplica as correções por API.

Direção: **saída / NF-e de venda**. Para entrada (receber NF-e/CT-e de fornecedor) a skill
certa é `recebimento-nfe-cte-omie`.

## Regra número um: não confiar no verificador automático

`omie.vendas.verificar_pedido` **já retornou `pronto_para_faturar: true` num pedido com o
ICMS completamente vazio.** Ele só valida cBenef, cliente e financeiro — não olha ICMS,
NCM, estoque, peso, volumes nem xPed. Use no máximo como checagem de cBenef. A verdade está
em `ConsultarPedido` (API), na tela "Conferir" do Omie e na pré-nota (Passo 6).

## Regra número dois: procure precedente antes de opinar

**Antes de decidir qualquer questão fiscal, rode `project_search` nas conferências
anteriores.** As respostas costumam já existir e mudam a conclusão:
- foi assim que se descobriu que a **NF-e 640 (pedido 290, SP→AL, contribuinte) já foi
  emitida e autorizada com ICMS de 7%** — o que transformou "minha tese" em "prática da
  casa com nota autorizada";
- e que **7308.90.10 é o NCM padrão de várias famílias do catálogo** (roletes, grades de
  piso em inox 316L), o que ampliou o alcance do problema de NCM de 8 itens para o cadastro.

Precedente com nota autorizada é o argumento mais forte que você tem numa consulta ao
contador. Procure sempre.

## Passo 1 — Pedir e ler os arquivos

A conferência **não acontece sem o pedido de compra do cliente**. Se o Lucas não anexou,
peça. Os arquivos úteis:

1. **PDF/ZIP do Pedido de Compra do cliente** — é o documento que manda. Costuma vir do
   portal (Nimbi, Ariba, Coupa) e o ZIP às vezes tem dois arquivos: o PDF oficial do PC e
   um print da tela ("Order Edit"). **Leia o PDF oficial** — é o que traz as informações
   tributárias e as condições gerais por item.
2. **PDF do Pedido de Venda do Omie** — dispensável, a API traz tudo.
3. **Pré-nota / espelho do DANFE** — peça sempre antes de faturar. Ver Passo 6.

```bash
unzip -o <arquivo.zip> -d <scratchpad>/pc
pdftotext -layout "<pc>.pdf" pc.txt   # -layout preserva as colunas; sem isso embaralha
```

O `pdftotext` do PC costuma passar do limite de tokens — ele é salvo em arquivo e você
recebe o caminho. Leia com `Read` em vez de despejar tudo.

**Extraia do PC, item por item** (não só do cabeçalho — muitos portais repetem dados
fiscais por linha e eles podem divergir entre itens):
- Nº do PC no portal e o **Código ERP / SAP** (é esse que vai no xPed, não o código do portal)
- Código do item no cliente, descrição, **descrição longa** (é ela que revela o que o
  produto realmente é — essencial para julgar o NCM), quantidade, preço unitário e total
- **CFOP, alíquota de ICMS, IPI, PIS, COFINS, IBS/CBS, NCM, origem** informados pelo cliente
- Incoterm (CIF/FOB), data de entrega, forma de pagamento (ex.: "F060 – 60 dias")
- Natureza da operação (Consumo / Revenda / Industrialização)
- **Condições gerais de fornecimento** — é aqui que moram as exigências que travam pagamento:
  e-mail para o XML, obrigação de xPed/nItemPed, janela de emissão de nota, exigência de
  dados da transportadora pela logística do cliente, proibição de desconto de duplicatas.

## Passo 2 — Localizar o pedido de venda no Omie

⚠️ **O filtro por `numero_pedido` em `listar_pedidos_venda` não funciona** — ele devolve a
página 1 independente do filtro. Pagine até achar (20 por página, ordem crescente de nº):

```
Multipli MCP:multipli_executar
capacidade_id: omie.vendas.listar_pedidos_venda
parametros: {"empresa": "ecmach", "pagina": <n>, "registros_por_pagina": 20}
```

O retorno estoura o limite de tokens e vai para arquivo. Extraia só o que precisa:

```bash
python3 -c "
import json
d=json.load(open('<arquivo>'))['resultado']
print(d['pagina'], d['total_de_paginas'], d['total_de_registros'])
for p in d['pedido_venda_produto']:
    c=p['cabecalho']; print(c['numero_pedido'], c['codigo_pedido'], c['etapa'])
"
```

Estime a página por regra de três (nº do pedido ÷ total de registros × total de páginas).
Guarde o `codigo_pedido` e **salve o pedido inteiro em arquivo — é o seu backup** antes de
qualquer escrita.

## Passo 3 — Ler o pedido completo

```
capacidade_id: omie.chamada_api
parametros: {"empresa": "ecmach", "endpoint": "produtos/pedido/",
             "call": "ConsultarPedido", "param": {"codigo_pedido": <n>}}
```

E também:
- cadastro do cliente — `omie.cadastros.consultar_cliente` com `codigo_cliente_omie`
- **cadastro de pelo menos um produto** — `omie.chamada_api` / `geral/produtos/` /
  `ConsultarProduto` com `{"codigo_produto": <n>}`. É onde moram NCM, `tipoItem`, CEST,
  peso, dimensões e os campos de IBS/CBS. O pedido não mostra isso.

⚠️ `ListarProdutos` **não aceita** `filtrar_por_descricao` (a tag não existe na estrutura).
Para achar produtos por descrição, pagine ou pegue os códigos pelo próprio pedido.

## Passo 4 — Pente-fino

### NCM — conferir o código, não só se ele bate com o PC

**O NCM é responsabilidade de quem emite.** Copiar o código do PC não protege a ECMACH: se
o cliente errou e a gente repetiu, o risco é nosso. Então **sempre julgue o NCM contra o
que o produto é**, usando a descrição longa do PC, e não contra o que o cliente escreveu.

Método: abra a hierarquia do NCM (Seção → Capítulo → posição → subposição → item) e leia o
texto da **posição**. Se o texto da posição não descreve o produto, o código está errado,
não importa quantos pedidos já saíram assim.

**Caso já analisado — roletes de transportador de correia (pedido 319, Fabrical):**

| | Cadastrado | Indicado |
|---|---|---|
| NCM | 7308.90.10 | **8431.39.00** |
| Hierarquia | Seção XV · Cap. 73 (obras de ferro/aço) · pos. **73.08 Construções e suas partes** (pontes, torres, pórticos, pilares, colunas, armações, telhados, portas e janelas) · "chapas, barras, perfis, tubos e semelhantes, próprios para construções" | Seção XVI · Cap. 84 · pos. **84.31** (partes exclusiva/principalmente destinadas às máquinas das pos. 84.25 a 84.30) · subpos. **8431.3** (de máquinas da pos. **84.28** — transportadores de ação contínua) |
| IPI | 0% | 0% |

"Rolete de carga" e "rolete de retorno" é a nomenclatura dos roletes do lado de carga e do
lado de retorno de um transportador de correia; a descrição longa do PC ("cilindro com eixo
e encaixe nas pontas") confirma peça de máquina, não aço estrutural.

**IPI e PIS/COFINS não mudam** entre os dois códigos (0% em ambos; nenhum é monofásico), ou
seja, a correção não altera o valor da nota. O risco é outro, e é o que se argumenta:
- **ICMS-ST / CEST** — a posição 73.08 transita nas listas de materiais de construção e
  congêneres; peça de máquina do Cap. 84, não. Em venda interna em SP ou para não
  contribuinte, o código errado pode atrair exigência indevida de ST.
- **SPED / Bloco K** — CFOP 6.101 declara produção do estabelecimento e o NCM aponta aço
  para construção civil. Incoerente.
- **Reforma tributária** — a classificação tributária de IBS/CBS é amarrada ao NCM.
- **Convênio ICMS 52/91** — se o código correto for de máquinas/implementos industriais,
  perguntar ao contador se o item passa a ter redução de base (e, em SP, qual cBenef usar).
  Não afirme que entra; é pergunta.

**Nunca troque NCM por conta própria.** Monte o argumento e escale (Passo 8). Corrigido, o
NCM se altera no **cadastro do produto**, não no pedido — vale para todos os pedidos
futuros, e provavelmente para outras famílias com o mesmo código.

### Fiscal do item (é onde quase sempre está o problema)
- **`imposto.icms` vazio (`{}`)** → o pedido não fatura. Na tela aparece
  *"Alguns campos obrigatórios para emitir a NF-e não foram preenchidos"*, geralmente com
  CST e base já preenchidos mas **"Modalidade da BC do ICMS" em branco e alíquota 0,0000**.
  Faltam `modalidade_icms` e `aliq_icms`.
- **Causa raiz frequente:** `contribuinte` vazio no cadastro do cliente → o cenário fiscal
  não calcula ICMS. Conferir antes de sair preenchendo item por item.
- **Alíquota interestadual** — ver tabela abaixo.
- `cod_sit_trib_ipi` — padrão da casa é **53** (não-tributada), confirmado pela NF-e 640.
  Se achar 51, padronizar para 53.
- PIS 0,65% / COFINS 3% (CST 01) — regime da ECMACH. **Muitos PCs vêm com PIS 3 / COFINS
  0,65 invertidos**: é erro do ERP do cliente, não mexer no nosso.
- IBS/CBS na transição: CBS 0,9% / IBS UF 0,1%, CST 000, class. trib. 000001.
- CFOP igual ao do PC.

### ICMS interestadual (Resolução do Senado 22/1989)

| Origem → Destino (destinatário contribuinte) | Alíquota |
|---|---|
| SP → Norte, Nordeste, Centro-Oeste, ES | **7%** |
| SP → Sul e Sudeste (menos ES) | **12%** |
| Mercadoria importada com Conteúdo de Importação > 40% | **4%** |

⚠️ **Muitos PCs informam 12% por default do ERP do cliente mesmo quando o correto é 7%.**
Como o preço da ECMACH é com imposto **por dentro**, a diferença sai direto da margem —
em SP→CE num pedido de R$ 57 mil, deu R$ 2.849,50. Isso é **decisão do Lucas + contador**,
não sua: mostre os dois números e pergunte. E avise que, divergindo do PC, o ERP do cliente
pode travar o recebimento da NF — precisa alinhar com o comprador antes de emitir.

**Precedente:** NF-e 640 (pedido 290, SP→AL, contribuinte) autorizada com 7%. Cite.

DIFAL/complemento em venda para contribuinte que compra para consumo é obrigação do
**destinatário** — não entra na nossa NF.

### Vínculo com o PC do cliente — xPed e nItemPed

São dois campos por item dentro do XML da NF-e:
- **`inf_adic.numero_pedido_compra` = xPed** → o nº do pedido de compra. Use o **código
  ERP/SAP** do PC, não o código do portal.
- **`inf_adic.item_pedido_compra` = nItemPed** → **o nº da linha daquele item dentro do
  pedido no ERP do cliente** (no SAP, tipicamente 10, 20, 30…).

Por que importa: o cliente faz a baixa do pedido **linha por linha**. O xPed diz de qual
pedido a nota é; o nItemPed diz qual linha cada item quita. Sem ele a nota cai em
conferência manual e os PCs costumam dizer que isso atrasa o pagamento e que eles não pagam
multa nem juros pelo atraso. **Não é bloqueio da SEFAZ** — os dois campos são opcionais no
layout da NF-e. É exigência do cliente, para receber no prazo.

⚠️ **O nº da linha normalmente não sai no PDF do PC.** No Nimbi existe o campo "Linha ERP"
por item, mas ele vem **vazio na impressão** — pode estar preenchido na tela. Então:
**peça os números ao comprador ou mande o Lucas olhar a grade de itens no portal.
Nunca invente** — linha errada é pior que linha em branco.

Recorrente: o mesmo problema apareceu no pedido 290 (Origem Energia, item 3.2 do PO).

### Cadastro do produto
- **`tipoItem`** — vem **99 (Outras)** por padrão em todo o catálogo. Para produto fabricado
  e vendido em CFOP 6.101 o correto é **04 (Produto Acabado)**, com reflexo no SPED/Bloco K.
  Sinalizar e escalar junto com o NCM.
- **Campos de IBS/CBS vazios** (`cst_ibs_cbs`, `class_trib`, alíquotas) — o pedido está
  pegando do cenário fiscal, não do produto. Funciona, mas é frágil. Sinalizar.
- **Peso e dimensões zerados** — se preencher no cadastro, todo pedido futuro já nasce com
  peso. Vale sugerir quando o Lucas tiver as medidas.
- CEST vazio — conferir se o NCM exige.

### Comercial e financeiro
- Itens, quantidades, preços e total idênticos ao PC (some os itens e compare).
- Condição de pagamento = forma de pagamento do PC (F060 → A60).
- **`data_previsao` vencida** é armadilha: o vencimento da parcela foi calculado a partir
  dela e pode estar vencendo hoje ou no passado. Atualizar para a data real de faturamento
  **recalcula as parcelas automaticamente**.
- `frete.modalidade` conforme o Incoterm — ver `claude/omie-referencia-tipo-de-frete.md`
  (CIF → 0, FOB → 1; **9 só quando não há transporte**).
- Projeto e departamento vinculados, **com a mesma descrição**.
- Data de entrega do PC: se estiver vencida, o cliente precisa prorrogar no portal, senão
  o GRN/pagamento dele trava.

### Bloqueios operacionais
- **Estoque**: `omie.estoque.consultar_posicao` por `codigo_produto`. Saldo 0 com
  `nao_movimentar_estoque: "N"` → faturar gera estoque negativo. Apontar produção antes.
- **Peso bruto/líquido e volumes zerados + transportadora 0**: NF com transporte precisa
  disso, e muitos PCs condicionam a emissão ao envio desses dados à logística do cliente.
- **Etapa** do pedido (20/50/60) — precisa chegar à etapa de faturamento.
- Cadastro do cliente: `contribuinte`, `inscricao_estadual` sem lixo (hífen solto,
  máscara quebrada → rejeição na SEFAZ), e `utilizar_emails` no e-mail que o PC exige
  para o XML.
- Cliente em recuperação judicial / sem limite de crédito → sinalizar, é decisão comercial.

## Passo 5 — Aplicar as correções (só depois de decidir com o Lucas)

**Use sempre `omie.chamada_api`.** As capacidades tipadas não gravam esses campos:

| Capacidade | Por que não serve |
|---|---|
| `omie.vendas.alterar_pedido` | o backend repassa `param` como tag → *"Tag [PARAM] não faz parte da estrutura do tipo complexo [pedido_venda_produto]"* |
| `omie.vendas.alterar_pedido_item` | whitelist de campos; recusa `imposto` e `numero_pedido_compra` (*"Campo de item não suportado"*). Só cBenef e dados adicionais |
| `omie.cadastros.alterar_cliente` | schema sem `contribuinte` nem `inscricao_estadual` |

**Cadastro do cliente** (`AlterarCliente` faz merge parcial):
```json
{"endpoint": "geral/clientes/", "call": "AlterarCliente",
 "param": {"codigo_cliente_omie": <n>, "contribuinte": "S", "inscricao_estadual": "06.436029.6"}}
```
`contribuinte` aceita **"S"/"N"** — mandar "1" dá erro.

**Cabeçalho do pedido** — mande o nó `informacoes_adicionais` **completo** (repetindo
`codProj`, `codVend`, `codigo_categoria`, `codigo_conta_corrente`, `numero_pedido_cliente`
etc.), senão corre risco de zerar o que ficou de fora:
```json
{"endpoint": "produtos/pedido/", "call": "AlterarPedidoVenda",
 "param": {"cabecalho": {"codigo_pedido": <n>, "data_previsao": "DD/MM/AAAA"},
           "observacoes": {"obs_venda": "Projeto ECM-XXXX_YY - PC <portal> - Pedido <ERP>."},
           "informacoes_adicionais": {"...todos os campos atuais...",
                                      "utilizar_emails": "nfe.<cliente>@..."}}}
```

**Itens** — envie **todos os itens de uma vez**, cada um com `ide.codigo_item` + os nós a
mudar + o nó `produto` repetido. Faz **merge** (preserva descrição, tabela de preço,
PIS/COFINS, departamento, frete). Mandar um item só é risco de perder os outros:
```json
{"endpoint": "produtos/pedido/", "call": "AlterarPedidoVenda",
 "param": {"cabecalho": {"codigo_pedido": <n>},
  "det": [{"ide": {"codigo_item": <n>},
           "produto": {"codigo_produto": <n>, "cfop": "6.101", "ncm": "7308.90.10",
                       "quantidade": 100, "unidade": "PC", "valor_unitario": 87,
                       "valor_mercadoria": 8700, "valor_total": 8700},
           "imposto": {
             "icms": {"cod_sit_trib_icms": "00", "modalidade_icms": "3", "origem_icms": "0",
                      "perc_red_base_icms": 0, "aliq_icms": 7,
                      "base_icms": 8700, "valor_icms": 609},
             "ipi": {"cod_sit_trib_ipi": "53", "aliq_ipi": 0, "base_ipi": 0,
                     "valor_ipi": 0, "enquadramento_ipi": "999"}},
           "inf_adic": {"codigo_categoria_item": "1.01.01",
                        "codigo_local_estoque": <n>,
                        "numero_pedido_compra": "<ERP>",
                        "item_pedido_compra": 10}}]}}
```

Tags do nó `imposto.icms`: `cod_sit_trib_icms`, `modalidade_icms` (3 = valor da operação),
`origem_icms`, `aliq_icms`, `base_icms`, `valor_icms`, `perc_red_base_icms`.
Na dúvida sobre nomes de tag, leia um pedido que **já** tenha aquele imposto preenchido —
a resposta do `ConsultarPedido` mostra os nomes exatos.

**Não reenvie `pis_padrao`/`cofins_padrao` sem necessidade** — arredondamento em float gera
diferença de centavo. Se precisar, use `Decimal` com `ROUND_HALF_UP`.

Gere o payload por script (`python3` + `json.dumps`) a partir do backup do pedido, e
**confira a soma dos impostos antes de mandar**.

## Passo 6 — Verificar, e pedir a pré-nota

Reler com `ConsultarPedido` depois de escrever e confirmar:
- os N itens continuam lá, com descrição e preço intactos
- `total_pedido.valor_total_pedido` inalterado e `valor_icms` = soma esperada
- `lista_parcelas.parcela[].data_vencimento` recalculado
- `informacoes_adicionais` não perdeu projeto/vendedor/conta corrente
- `departamentos` e `frete.modalidade` preservados

**Depois peça ao Lucas a pré-nota (espelho do DANFE).** É a melhor confirmação final:
mostra de uma vez o que efetivamente vai para o XML. Confira nela:
- IE do destinatário **formatada** (é onde se vê se a limpeza do cadastro pegou)
- **O/CST** (origem + CST concatenados, ex.: `000`), CFOP, NCM e alíquota por item
- base e valor de ICMS, IPI, PIS, COFINS, total dos produtos e total da nota
- "Frete por conta" conforme o Incoterm
- quadro **Transportador / Volumes Transportados** — em branco denuncia peso/volumes
- **Informações complementares** — e-mail do destinatário e `Pedido: <xPed>`; se só aparecer
  o pedido e nenhum nº de item, o nItemPed continua faltando
- Nº 999.999.999, série 999, chave 9999… e "SEM VALOR FISCAL / FALTA PROTOCOLO DE APROVAÇÃO
  DA SEFAZ" são **placeholders normais** de pré-nota, não erro
- **IBS/CBS não aparecem** no layout v. 4.0.1 mesmo estando calculados no pedido — não
  conclua que estão faltando; isso só se verifica no XML autorizado

## Passo 7 — Registrar no projeto

Grave a conferência em `claude/conferencia-pedido-venda-<nº>-<cliente>.md` com: referências
(codigo_pedido, PC, projeto), o que estava certo, o que foi corrigido (com valores antes →
depois), o que ficou pendente e por quê, e qualquer aprendizado de API novo. Se descobrir
regra nova, atualize também `claude/omie-regras-pedido-venda-ecmach.md`.

Esses documentos são o acervo de precedentes da Regra número dois — escreva pensando em
quem vai pesquisar depois.

## Passo 8 — Escalar as dúvidas fiscais para a contabilidade

NCM, alíquota divergente do PC, CST, benefício fiscal, tipo de item e IBS/CBS **não são sua
decisão nem a do Lucas sozinho**. Junte tudo numa consulta só, formal, em perguntas
numeradas, para o contador responder ponto por ponto.

Contabilidade: **atendimento@jwcontabilidade.com.br**. Enviar da caixa do Lucas na empresa
do negócio (ECMACH → `lucas@ecmach.com.br`), não da caixa da Multipli.

Estrutura que funcionou (pedido 319):
1. Quadro da operação — pedido, cliente, CNPJ, UF e condição de contribuinte, PC do cliente,
   objeto, valor, CFOP, natureza declarada, frete
2. Questão principal, com a hierarquia do NCM escrita e a descrição técnica do PC citada
3. Alíquota de ICMS, com os dois valores lado a lado e o precedente de nota autorizada
4. As questões decorrentes (Convênio 52/91 e cBenef)
5. Os pontos de higiene (CST de IPI, tipo do item, IBS/CBS no cadastro, PIS/COFINS)
6. Alcance — se a correção atinge só este pedido ou o cadastro/outras famílias
7. Situação atual: o que está retido aguardando a resposta

Sempre diga o que **não** muda ("IPI é 0% nos dois códigos, a correção não altera o valor da
nota") — encurta a resposta e mostra que a análise foi feita.

⚠️ **`email.enviar` do Multipli MCP está quebrado** (10/09/2026): rejeita com
`PARAMETROS_INVALIDOS: (raiz) must NOT have additional properties` até com payload mínimo
só dos campos obrigatórios, e `ver_erros_recentes` não registra nada nos containers — a
recusa é na validação de schema do gateway, provavelmente por injeção automática de
`empresa` num schema com `additionalProperties: false`. As capacidades de leitura
(`email.listar_enviados`, `email.listar_caixas`) aceitam `caixa` normalmente. Enquanto não
for corrigido, **entregue o texto em arquivo (.md e .txt) para o Lucas enviar**, e avise do
bug em vez de tentar de novo.

## Não use o navegador para isso

Já foi tentado: no navegador embutido o filtro do grid de clientes do Omie não aplica por
automação e o viewport oscila. A API resolve tudo. Se em algum caso realmente precisar da
tela, a única coisa que a tela faz melhor é o botão **"Conferir"** e o **"Atualizar os
impostos dos itens"** do cenário fiscal.

## Checklist antes de dizer "apto a faturar"

- [ ] Itens, quantidades, preços e total batem com o PC
- [ ] CFOP conforme o PC
- [ ] **NCM julgado contra o que o produto é** (não só contra o PC) — divergência escalada
- [ ] ICMS: CST + **modalidade da BC** + alíquota certa (7% x 12% decidido com o Lucas)
- [ ] CST de IPI padronizado (53)
- [ ] PIS/COFINS conforme o regime da ECMACH (ignorar inversão do PC)
- [ ] `contribuinte` = "S" e IE limpa no cadastro do cliente
- [ ] xPed preenchido nos itens; **nItemPed obtido com o cliente** (não inventado)
- [ ] `tipoItem` do produto coerente com o CFOP (04 para produção própria)
- [ ] Condição de pagamento = a do PC; `data_previsao` atual e vencimento recalculado
- [ ] `frete.modalidade` = Incoterm do PC
- [ ] Projeto e departamento vinculados, mesma descrição
- [ ] E-mail do XML conforme o PC (envio automático fica "N" se o PC exigir só o XML anexo)
- [ ] Estoque suficiente / produção apontada
- [ ] Peso, volumes e transportadora informados
- [ ] Data de entrega do PC válida (prorrogada no portal se vencida)
- [ ] Etapa do pedido na fase de faturamento
- [ ] Pré-nota conferida
- [ ] Dúvidas fiscais respondidas pela contabilidade
- [ ] **Perguntado ao Lucas antes de faturar** — `faturar_pedido` emite NF-e e gera a conta
      a receber automaticamente (não criar título depois: duplica)