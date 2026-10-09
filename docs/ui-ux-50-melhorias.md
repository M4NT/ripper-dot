# 50 melhorias de UI/UX para o Ripper

Referência: projeto OpenBot (`openbot-main.zip`): desktop em Electron + SolidJS e app mobile em Expo/HeroUI, com o guia `apps/mobile/DESIGN.md` e o `docs/ui-foundation.md`.

**Uso:** o OpenBot é licenciado como PolyForm Noncommercial 1.0.0. Esta lista usa só as ideias de design. Nenhum código ou recurso visual dele deve ser copiado.

**Medições feitas nesta rodada (web/src):**
- 97 cores literais no `styles.css`, em vez de variáveis de tema.
- 359 tamanhos de fonte em `px` e 1 em `rem`.
- 214 raios de borda literais.
- 17 transições com 0,3 s ou mais (o OpenBot limita a menos de 300 ms).
- 101 regras `:hover` sem proteção de `(hover: hover)`.
- 0 regras de `prefers-reduced-transparency`, e 6 usos de `backdrop-filter`.
- 0 usos de esqueleto (Skeleton) de carregamento.
- Nenhuma lista de mensagens virtualizada encontrada na busca.

**Legenda:** [rápido] até meio dia · [médio] de um a três dias · [grande] mais de três dias · *verificar* = não confirmei no código se já existe.

---

## Navegação (1–6)

1. **Barra de abas no celular:** Início (Conversas), Agentes, Caixa e Mais. *Feito (PR #112 e lote 1 em #113).* [rápido] Ref.: `NativeTabs` do DESIGN.md.
2. **Busca dentro da barra de navegação do celular:** o campo aparece no topo ao tocar, em vez de um ícone que abre outra tela. [médio] Ref.: `Stack.SearchBar`. Onde: `app.jsx` (barra do celular). *Decidido: manter a busca rápida atual (sem mudança).*
3. **Título grande que encolhe ao rolar** nas telas principais do celular (Agentes, Conversas, Caixa). [médio] Ref.: título grande do iOS. Onde: `pages/Agents.jsx`, `pages/Chats.jsx`. *Lote 2: título grande no celular (32 px, conferido na foto). Falta o encolhimento ao rolar.*
4. **Menu de ações do topo como folha de baixo** no celular, em vez de janela no meio da tela. [médio] Ref.: `Stack.Toolbar` e menus nativos. Onde: `ui.jsx` (`Menu`). *Lote 7: feito. No celular, o menu abre como folha de baixo para cima, com fundo escurecido que fecha ao tocar fora (testado).*
5. **Seletor de empresa/time no topo da lateral**, com ícone e nome, para trocar de contexto sem sair da tela. [grande] Ref.: "OpenBot team ⌄" e §3.3 da especificação. Onde: `app.jsx` (`Sidebar`). *Descartado: não haverá seletor de empresas; a organização fica em projetos.*
6. **Faixa de contas à esquerda** com um ícone por empresa, quando houver mais de uma. [médio] Ref.: barra vertical do OpenBot. Depende do item 5. *Descartado junto com o 5.*

## Chat e campo de mensagem (7–18)

7. **Campo de mensagem enxuto:** "+", campo de texto, microfone e enviar. Computador, pasta e modelo vão para uma folha de opções. [médio] Ref.: campo de mensagem do OpenBot. Onde: `composer.jsx`, `composerPlusMenu.jsx`. *Lote 4: no celular a faixa de computador e pasta foi escondida (decisão sua). A escolha da pasta continua no computador. Falta o restante do campo enxuto (chips de modelo).*
8. **Círculo sem texto ao lado do seletor de modelo** no campo de mensagem. Confirmar o que ele faz e dar um nome, ou remover. [rápido] *Identificado: é o anel da janela de contexto (abre "Uso e limites"). Lote 2: mostra a porcentagem ao lado e um rótulo claro.*
9. **Fila de mensagens visível**, com cancelar, editar e "enviar agora". [médio] Ref.: `QueuedMessage` (cancelar, atualizar, steer). Onde: `createInputQueue` em `lib/input-queue.mjs`. *Lote 2: cada mensagem da fila aparece com texto e botão "Cancelar" próprio. Faltam editar e "enviar agora".*
10. **Copiar tabela como Markdown ou CSV** nas tabelas do chat, inclusive as de OpenUI. [rápido] Ref.: "Copiar como Markdown / Copiar como CSV". Onde: `Chat.jsx`, `openui/library.jsx`. *Lote 5: feito nas tabelas em Markdown do chat (copiar como Markdown e como CSV, com ";"). Falta nas tabelas do OpenUI.*
11. **Arquivos de origem como chips com ícone por tipo** (MD, CSV) no fim da resposta. [médio] Ref.: "Source files". Onde: `MessageAttachments.jsx`, `fileThumb.jsx`.
12. **"Enviada a [agente]" discreto** em mensagens repassadas entre agentes. [rápido] Ref.: "Mensagem enviada a Launch". Onde: `agentThread.jsx`. *Parcial: já existe o inverso ("Mensagem de [agente]", `ViaLabel`). Falta o rótulo na mensagem que sai; depende de saber, na mensagem, para quem ela foi enviada.*
13. **Medida de leitura** de cerca de 680 px para texto corrido. Cartões e tabelas usam a largura toda. [rápido] *Feito no lote 1 (parágrafos e listas, 42 rem; código e tabelas seguem a largura toda). Visual ainda não conferido.* Ref.: layout do OpenBot. Onde: `styles.css` (`.md`).
14. **Ações da resposta** (copiar, ouvir, refazer) aparecem ao passar o mouse no desktop e ficam sempre visíveis no toque. [rápido] Ref.: hover só com ponteiro fino (`ui-foundation.md`). Onde: `actionLine.jsx`. *Já existe no toque (`@media (hover: none)`); conferido no CSS.*
15. **Botão "ir para o fim" com contagem** de mensagens novas quando a pessoa rola para cima. [rápido] *Lote 4: feito e testado (aparece ao rolar para cima, conta as novas, leva ao fim).*
16. **Mensagens longas recolhíveis** ("Mostrar mais") acima de cerca de 20 linhas. [rápido] *Lote 4: feito e testado (recolhe acima de 460 px, "Mostrar mais" abre). Falta conferir o visual do esmaecimento.*
17. **Estado do turno em uma linha** ("Pesquisando na web · 12 s"), com botão de parar sempre visível. [médio] Ref.: `AgentActivity`. Onde: `actionLine.jsx`, `stepLabel` em `lib/`. *Lote 5: a linha de atividade já resumia o turno; agora mostra o tempo do passo em andamento (· 12 s). A parada já existia.*
18. **Erro do campo de mensagem como faixa acima do campo**, com "Tentar de novo". [rápido] Ref.: `ComposerErrorBanner`. Onde: `errorNote.jsx`. *Verificar se já é assim.* *Lote 6: feito. Arquivo que não sobe fica na faixa de anexos com o erro e "Tentar de novo"; o envio espera a resolução. Testado com falha simulada (a nova tentativa funcionou). O bloqueio do envio não foi confirmado por teste.*

## Listas, cartões e estados (19–26)

19. **Lista de agentes com prévia da última mensagem e hora**, em duas linhas por agente. [rápido] *verificar: `chatRow.jsx` já tem parte disso.* Ref.: lista de agentes do OpenBot. *Já existe: a linha de agente mostra a última mensagem e a hora.*
20. **Cargo do agente como etiqueta** ao lado do nome, por exemplo "Gerente de projeto". [rápido] Ref.: etiqueta "Chief of staff". Onde: `app.jsx` (linha do agente). *Parcial: a linha de agente mostra uma etiqueta de função, mas abaixo do nome, e não ao lado.*
21. **Esqueletos no carregamento** de listas e cartões, no lugar do spinner. [médio] Ref.: `Skeleton`. Medido hoje: 0 usos. *Lote 2: componente `Skeleton` criado e usado no histórico de aprovações e nos fluxos. Faltam as outras listas.*
22. **Cartão de documento de compra no chat** (nota fiscal ou pedido): cabeçalho, etiquetas de validação, botões de ação e estado "processando" no próprio cartão. [grande] Ref.: §3.2 da especificação e o `Card` do OpenUI. *Plano escrito: `docs/planos/cartao-documento-compra.md`. Aguarda as decisões do plano.*
23. **Confirmação com `AlertDialog`** para toda ação irreversível, mostrando o nome do alvo. [rápido] Ref.: `AlertDialog` do `ui-foundation.md`. Onde: `useConfirm` (8 arquivos). *Feito no lote 1: os 4 `confirm()` do navegador que sobravam (Clientes, Certificados, Omie, Webhooks) agora usam o diálogo do app.*
24. **Desfazer em toda ação reversível** (aviso com botão "Desfazer"). [médio] Ref.: padrão de aviso do OpenBot. Onde: 9 arquivos já têm algo parecido; padronizar. *Lote 5: "Desfazer" em arquivar e desarquivar em lote, e no deslizar. Apagar não tem volta (sem desfazer, de propósito).*
25. **Uso por agente na ficha** (tokens, custo e tempo do período). [médio] Ref.: `AgentUsagePanel`. Onde: `modelUsage.jsx`, `pages/AgentConfig.jsx`. *Descartado por decisão: não será feito por enquanto.*
26. **Calendário visual das rotinas**, com as próximas execuções. [grande] Ref.: `SchedulePanel`. Onde: `routines.jsx`. *Plano escrito: `docs/planos/calendario-rotinas.md`. Aguarda as decisões do plano.*

## Formulários e folhas (27–33)

27. **Folhas de criação com "×" à esquerda e "✓ Salvar" à direita**, no mesmo padrão do OpenBot. [médio] Ref.: `DESIGN.md`, "Save and create actions". Onde: `agentForm.jsx`, `pages/NewAgent.jsx`. *Lote 3: no celular, "×" à esquerda e "✓ Criar agente" à direita (conferido na foto). Ainda é página, não folha.*
28. **O "✓ Salvar" só aparece quando algo foi alterado.** [rápido] Ref.: `SheetSaveAction`. *Feito no lote 1 (ficha do agente).*
29. **Fechar com alterações não salvas pede confirmação.** [médio] *Verificar em Configurações e na ficha do agente.* Ref.: guardas de alterações não salvas. *Lote 5: aviso "Sair sem salvar?" ao trocar de tela pelos botões e links internos. Falta o botão "voltar" do navegador, que ainda passa sem aviso.*
30. **Erro de campo ao sair do campo**, embaixo dele, com rótulo e descrição ligados ao campo. [médio] Ref.: componente `Field`. Onde: 12 arquivos já usam o padrão; padronizar. *Lote 3: feito no nome do agente (erro ao sair do campo vazio, com `aria-invalid`). Falta padronizar nos outros formulários.*
31. **Botão desabilitado explica o motivo** ("Falta o nome do agente"). [rápido] Ref.: `DESIGN.md`, "disabled checkmark". *Parcial no lote 1: dica no botão "Criar agente" (tooltip). Falta texto visível para toque.*
32. **Enter envia formulários simples** (um campo). [rápido] Ref.: "preserve keyboard submission". *Já funciona no "Criar agente" (formulário nativo).*
33. **Estado de "salvando" sem duplicar o envio:** o botão fica desabilitado, com rótulo acessível de pendente. [rápido] Ref.: `DESIGN.md`, estado pendente. *Já existe: o botão fica desabilitado e com "Salvando…" durante o envio.*

## Visual: cor, tipografia, raio e escala (34–39)

34. **Trocar as 97 cores literais do CSS por variáveis de tema.** [médio] Ref.: `tokens.css` como fonte única. Medido hoje. *Medido de novo: 66 cores literais fora dos temas (27 diferentes). `scripts/cores-literais.mjs` impede que o número suba. Trocar as restantes por variáveis fica para depois.*
35. **Reduzir os 359 tamanhos de fonte em `px`** para uma escala de 6 a 7 passos. [médio] Ref.: `ui-foundation.md`. *Parcial: texto já em `rem` (item 38). A escala de tamanhos (6 a 7 passos) ainda não foi definida.*
36. **Reduzir os 214 raios literais para quatro valores** (controle, cartão, folha e pílula). [médio] Ref.: escala de raios do OpenBot. *Lote 7: escala de raios no tema (controle, cartão, folha e pílula), usada no cartão de configuração e na folha de menu. Os outros raios ainda não foram migrados.*
37. **Escala de controles definida:** 24, 28, 32, 36 e 44 px, com uso por função. [rápido] Ref.: `ui-foundation.md`, "compact control scale". *Lote 7: escala de controles no tema (28, 32, 36 e 44 px), usada no ícone, na pílula e no seletor de segmento. Lote 8: botões aplicados na escala (padrão 36 px, pequeno 28 px, grande 44 px), aprovado pelo usuário e conferido na medição.*
38. **Texto em `rem`, não em `px`**, para respeitar o tamanho de fonte que a pessoa escolheu no celular. [médio] Ref.: "Dynamic Type" no `DESIGN.md`. Medido hoje: 1 uso de `rem`. *Lote 7: 367 tamanhos convertidos para `rem` (16 px = 1 rem). Medido: 487 textos com o mesmo tamanho calculado antes e depois, no padrão. Falta 1 caso em JSX e as fontes em outros atributos.*
39. **Agrupamentos de configuração com cantos de 16 pt**, fundo agrupado e separadores internos, no claro e no escuro. [médio] Ref.: tabela de cores do `DESIGN.md`. *Lote 6: raio dos cartões de configuração de 18 px para 16 px.*

## Movimento, toque e acessibilidade (40–46)

40. **Transições de até 250 ms.** Hoje há 17 com 0,3 s ou mais. [rápido] Ref.: "animations stay below 300 ms". *Feito no lote 1: 21 ajustes.*
41. **Reduzir transparência:** fundo sólido quando o sistema pedir. Hoje há 6 usos de desfoque e nenhuma regra para isso. [rápido] Ref.: `DESIGN.md`, "reduced transparency". *Feito no lote 1 (barras do topo e da navegação).*
42. **Foco visível em todo controle** para uso com teclado. [rápido] *Lote 4: regra geral de contorno para `:focus-visible` em botões, links, campos e controles. Componentes que já definem o próprio foco continuam valendo.*
43. **Rótulo acessível em todo botão só com ícone.** Hoje há 104 `aria-label`; falta checar a cobertura. [médio] Ref.: `IconButton` com `label` obrigatório. *Lote 5: `scripts/rotulos.mjs` procura botões e links sem nome. Nas telas auditadas (vazias, 1280 e 375 px) não achou nenhum. Falta auditar com dados.*
44. **Contraste verificado por script** nos dois temas, com 4,5:1 para texto. [médio] Ref.: `DESIGN.md`, "Theme and visual consistency". *Lote 5: `scripts/contraste.mjs` lê as cores do CSS e confere 4,5:1 nos dois temas. Todos passam (menor: 4,76:1).*
45. **Deslizar na lista de conversas para arquivar**, com "Desfazer". Não usar deslize para aprovar nada. [médio] Ref.: decisão da especificação (ação irreversível exige confirmação). *Lote 3: lógica feita e testada (arquiva, "Desfazer" restaura, sem erro). Falta testar o gesto num celular de verdade: no navegador de teste o toque é cancelado antes de chegar ao fim.*
46. **Verificação automática de estilo no build**, que bloqueia cor, tamanho e raio literais novos. [médio] Ref.: `bun run check:ui` do OpenBot. *Lote 6: `scripts/cores-literais.mjs` falha se o CSS ganhar cores literais novas (testado: falha ao adicionar uma cor e passa ao restaurar).*

## Desempenho (47–50)

47. **Virtualizar a lista de mensagens** em conversas longas, depois de medir uma conversa com 500 mensagens. [grande] Ref.: `createChatVirtualizer`. *Medido (lote 6): uma conversa de 500 mensagens abre em 0,47 s, com 8.505 elementos no DOM, e subir ao topo leva menos de 0,3 s. Por enquanto a virtualização não compensa; reavaliar com cerca de 2.000 mensagens.*
48. **Miniaturas de imagem com tamanho fixo e carregamento preguiçoso**, sem salto de layout. [rápido] *Carregamento preguiçoso já existe nas miniaturas de mensagem; falta tamanho fixo.* Ref.: `MediaLightbox`, `fileThumb`. Onde: `fileThumb.jsx`, `MediaLightbox.jsx`. *Parcial: as miniaturas já têm tamanho fixo. Falta reservar espaço nas imagens grandes, que precisa de largura e altura conhecidas.*
49. **Reduzir o CSS global** (107 KB hoje), separando o que só algumas telas usam. [médio] Onde: `styles.css`.
50. **Medir INP e LCP no celular** e definir limites antes de cada rodada de mudança. [rápido] Ref.: `ANALYTICS.md` do OpenBot. *Lote 4: `scripts/medir-web.mjs`. Referência local: LCP de 0,9 s nas conversas, 0,9 s nos agentes, 0,9 s na caixa; toque de 48 ms. Emulado no Chromium, não é aparelho real.*

---

## Ordem sugerida

- **Primeiro (rápido, alto impacto):** 1, 14, 23, 28, 31, 32, 40, 41, 10.
- **Segundo:** 2, 3, 7, 8, 9, 21, 27, 30, 34, 35.
- **Terceiro (mudança grande):** 5, 6, 22, 26, 47.

## O que já está em `docs/ui-ux.md`

A auditoria anterior (19 itens) continua valendo: cabeçalhos, selos cortados, textos em inglês e bandejas que cobrem a tela. Esta lista não repete esses itens.
