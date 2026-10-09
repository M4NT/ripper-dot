# 50 melhorias de UI/UX na interação com os agentes

Escopo: como a pessoa conversa com o agente e acompanha o que ele faz. Cobre o composer, a conversa, as atividades do agente, as respostas, as aprovações e as perguntas, os erros e o histórico. Não cobre telas de configuração.

Como ler:
- **[rápido]** cabe numa rodada pequena, com um ou dois arquivos.
- **[médio]** mexe em mais de uma parte da conversa ou pede regra nova.
- **[grande]** precisa de dado novo do servidor ou de uma tela nova.
- "Hoje" descreve só o que confirmei no código. Quando não confirmei, o item diz "Ideia".

Onde está o quê: `web/src/pages/Chat.jsx` (conversa e mensagens), `web/src/actionLine.jsx` (atividades do agente e cartões), `web/src/composer.jsx` (campo de envio), `web/src/approvals.jsx` (aprovações), `web/src/errorNote.jsx` (erros), `web/src/lib.js` (rótulos das ferramentas), `lib/human-errors.mjs` (texto dos erros), `server.mjs` (eventos da resposta).

---

**Situação:** implementada no lote 15 (feat/ui-agentes-50). Só o item 24 ficou de fora, por decisão do Yan.

## Enviar (campo de mensagem) — 1 a 8

1. **Mostrar a dica de atalho uma vez.** Enter envia e Shift+Enter quebra a linha. Hoje o atalho existe (`composer.jsx`), mas ninguém é avisado dele. [rápido] *Feito: a dica some depois do primeiro envio ou com "Entendi".*
2. **Explicar quando a mensagem vai para a fila.** Hoje, se o agente ainda responde, a mensagem entra numa fila com "Editar" e "Interromper e enviar". Ideia: dizer no próprio campo "Vai para a fila: o agente ainda responde". [rápido] *Feito: enquanto o agente responde, o campo avisa que a mensagem vai para a fila.*
3. **Mostrar o progresso do envio de arquivo.** Hoje o anexo aparece e mostra erro com "Tentar de novo". Ideia: barra de progresso e tamanho do arquivo enquanto sobe. [médio] *Feito: o envio mostra a porcentagem enquanto sobe.*
4. **Colar imagem da área de transferência** já vira anexo com prévia, sem passo extra. Ideia: confirmar que funciona em todos os navegadores do celular e avisar quando não funcionar. [médio] *Já existia: colar imagem já vira anexo com prévia (verificado no código).*
5. **Rascunho preservado ao trocar de conversa.** Ideia: o texto digitado fica guardado por conversa, para não se perder ao sair. [médio] *Já existia: o rascunho fica guardado por conversa.*
6. **Menu de menção (@) com o papel de cada agente.** Hoje o menu existe; ideia: mostrar em uma linha o que cada agente faz. [médio] *Feito: a descrição de cada agente aparece numa linha só, cortada com reticências.*
7. **Ditado mostra o texto antes de enviar.** Hoje aparece "Transcrevendo…" no campo. Ideia: mostrar o texto transcrito e deixar a pessoa corrigir antes de enviar. [médio] *Já existia: o ditado põe o texto no campo, sem enviar; a pessoa confere antes.*
8. **Contador de caracteres só quando passa do limite.** Ideia: aviso discreto e claro, não contador o tempo todo. [rápido] *Feito: contador aparece a partir de 2.000 caracteres; não há limite de envio.*

## Enquanto o agente trabalha — 9 a 18

9. **Nome da etapa em português simples.** Hoje `stepLabel` (`web/src/lib.js`) converte o nome técnico da ferramenta. Ideia: revisar os rótulos das ferramentas que ainda aparecem com nome técnico, em especial as de conectores. [médio] *Feito: 59 ferramentas sem nome em português ganharam rótulo; um teste garante que todas têm.*
10. **Detalhe técnico escondido por padrão.** Hoje o detalhe (comando, caminho ou consulta) aparece na linha da etapa. Ideia: mostrar só o nome da etapa e abrir o detalhe em "Ver detalhe". [médio] *Feito: o detalhe fica em "Ver detalhe", fechado por padrão.*
11. **Tempo também nas etapas já concluídas.** Hoje o tempo aparece só na etapa em andamento (componente `Tempo`). Ideia: mostrar o tempo total e o de cada etapa ao fim. [rápido] *Feito: cada etapa concluída mostra o tempo que levou.*
12. **Dizer por que está demorando.** Hoje, depois de 20 s sem mudança, aparece "ainda em: <etapa> · 40 s". Ideia: trocar por um motivo provável, como "esperando o site responder". [médio] *Feito: o aviso de demora diz o motivo provável.*
13. **Botão Parar visível desde o começo** enquanto a resposta roda. Hoje ele só aparece quando a etapa passa de 20 s sem mudança (`StallNote`). [rápido] *Feito: o botão Parar aparece na linha de atividades enquanto a resposta roda.*
14. **Depois de parar, oferecer continuar.** Hoje, ao parar, o que já foi feito fica na conversa, mas não há "continuar". Ideia: botão "Continuar de onde parou". [médio] *Feito: "Continuar de onde parou" envia um pedido para seguir a resposta.*
15. **Pergunta do agente também aparece na conversa.** Hoje a pergunta vai para a Caixa; a conversa não mostra que ele espera uma resposta. Ideia: mostrar "Esperando você na Caixa" no lugar da resposta, com link. [médio] *Feito: enquanto a pergunta espera, a linha mostra "Esperando você responder acima". A pergunta já aparecia na conversa.*
16. **Subtarefas em paralelo com rótulos iguais aos das etapas.** Hoje a lista de subtarefas tem barra própria. Ideia: mesmo texto e mesmo tempo das outras etapas. [médio] *Feito: subtarefas em andamento mostram o tempo.*
17. **Aviso de tela ao vivo ao usar o computador.** Hoje o painel abre sozinho na primeira ação de computador. Ideia: avisar na conversa que a tela está disponível, sem abrir sozinho. [médio] *Feito: a conversa avisa "Tela ao vivo disponível" com o botão Abrir tela; o painel não abre sozinho.*
18. **Estado do agente com ícone e cor fixos.** Hoje "Pensando", "Escrevendo" e a etapa usam o mesmo texto. Ideia: um ícone por estado, igual ao do círculo que anima (`ThinkingOrb`). [rápido] *Feito: cada fase da espera tem um ícone.*

## Respostas — 19 a 30

19. **Índice nas respostas longas.** Ideia: quando a resposta tem muitos títulos, mostrar um índice clicável no topo. [médio] *Feito: resposta com 4 títulos ou mais ganha um índice clicável.*
20. **Tabela larga abre em tela cheia no celular.** Hoje já há copiar em Markdown e CSV. Ideia: botão para ver a tabela inteira em tela cheia, com rolagem. [médio] *Feito: tabela tem "Tela cheia" (no celular, para ver a tabela toda).*
21. **Bloco de código com rolagem e copiar sempre visível no celular.** Hoje há botão "Copiar". Ideia: conferir a largura no celular e não cortar o código. [rápido] *Feito: código rola na horizontal dentro do bloco, também no celular.*
22. **Links da resposta com aviso de site externo.** Ideia: ícone de link externo e abrir em nova aba. [rápido] *Feito: links externos mostram o ícone de link externo.*
23. **Fontes no fim da resposta quando houver pesquisa na web.** Hoje não há lista de fontes na conversa. Ideia: lista com título e endereço das páginas usadas. [grande] *Feito (parcial): lista as páginas abertas pela pesquisa e pelo navegador. Os resultados de busca ainda não entram.*
24. **Avaliar a resposta com 👍 ou 👎.** Hoje não existe. Ideia: os dois botões no rodapé da mensagem, para a equipe medir a qualidade. [médio] *Não será feito: decisão do Yan.*
25. **Refazer com escolha.** Hoje há só "Refazer". Ideia: "Refazer mais curto", "Refazer com outro modelo". [médio] *Feito: "Outro modelo" e "Mais curta" nas respostas.*
26. **Números em pt-BR em toda resposta.** Ideia: separador de milhar e vírgula decimal também quando o agente escreve o número sem formatação. [rápido] *Feito: números com milhar e decimal são escritos no formato brasileiro.*
27. **Mensagem longa da pessoa recolhida.** Hoje existe um componente de recolher. Ideia: usar em toda mensagem longa, com "Mostrar tudo". [rápido] *Feito: mensagens longas da pessoa são recolhíveis.*
28. **Aviso quando a resposta foi cortada.** Ideia: se o modelo parar no limite de texto, dizer isso e oferecer continuar. Depende de o servidor sinalizar o corte. [médio] *Feito (parcial): aviso e "Continuar" quando o Claude para no limite. Os outros provedores ainda não avisam.*
29. **Quem respondeu, em conversa de grupo.** Ideia: nome e avatar do agente em cada resposta, mesmo quando é o mesmo agente em sequência. [rápido] *Já existia: em grupo, cada resposta mostra o nome do agente.*
30. **De onde vem o dado.** Ideia: quando a resposta usa um sistema (Omie, notas fiscais), mostrar "lido do Omie às 14:02". [médio] *Feito: etapas do Omie e das notas recebidas mostram "lido às HH:MM".*

## Aprovações e perguntas — 31 a 38

31. **Aprovação em frase simples.** Hoje o comando aparece em bloco de código (`approval-cmd`). Ideia: frase em português com o efeito, e o comando em "Ver detalhe". [médio] *Feito: frase curta; o comando fica em "Ver detalhe".*
32. **Botões com verbo do resultado.** Hoje são "Aprovar" e "Recusar". Ideia: "Enviar e-mail" e "Não enviar", conforme a ação. [rápido] *Feito: "Enviar e-mail", "Enviar WhatsApp", "Permitir comando" e outros.*
33. **Aprovação pendente marcada na conversa.** Hoje a pendência só aparece na Caixa. Ideia: marca no título da conversa e na lista de conversas. [médio] *Feito: o título da conversa mostra quantos pedidos esperam a pessoa.*
34. **Resultado no mesmo cartão depois de decidir.** Hoje o cartão mostra o status. Ideia: mostrar o que aconteceu (enviado, não enviado) e a hora. [rápido] *Feito: o resultado mostra "Você aprovou · HH:MM" ou "Você não aprovou · HH:MM".*
35. **O que "Aprovar sempre aqui" faz.** Hoje é um botão sem explicação do alcance. Ideia: texto curto embaixo dizendo que vale só para este comando nesta conversa. [rápido] *Feito: "Aprovar sempre aqui" tem a explicação de que vale só para este comando, nesta conversa.*
36. **Prazo de aprovação visível.** Hoje o pedido expira em 10 minutos (`ApprovalGate`), sem aviso na tela. Ideia: "expira em 8 min". [médio] *Feito: o pedido mostra "Expira às HH:MM".*
37. **Aprovar vários parecidos de uma vez.** Hoje a Caixa tem seleção por caixinha. Ideia: "Aprovar os 5 e-mails iguais", com a lista antes. [médio] *Feito: "Selecionar os de mesmo tipo" e confirmação com a lista antes de decidir em lote.*
38. **Resumo do destinatário antes de enviar.** Ideia: em e-mail e WhatsApp, mostrar para quem vai e o assunto no cartão de aprovação. [médio] *Feito: e-mail mostra destinatário e assunto na frase.*

## Erros e recuperação — 39 a 44

39. **Erro no meio da resposta diz o que já ficou feito.** Hoje o erro explica o problema (`ErrorNote`). Ideia: incluir o que já foi feito e o que não foi. [médio] *Feito: o erro diz quantas ações já tinham terminado.*
40. **Queda de conexão não apaga o texto recebido.** Ideia: manter o que chegou e oferecer "Tentar de novo" a partir dali. [médio] *Já existia: o texto recebido fica na conversa e "Tentar de novo" continua dali.*
41. **Mensagem que falhou continua marcada depois de recarregar.** Ideia: conferir e garantir que a marca de falha fica salva. [médio] *Já existia: o servidor salva a mensagem com o erro, então ela continua marcada depois de recarregar.*
42. **Aviso de limite de uso antes de estourar.** Hoje existe um aviso de orçamento de tokens na conversa. Ideia: avisar antes do limite, com o próximo passo. [médio] *Feito: aviso de orçamento aparece no topo da conversa.*
43. **Troca de modelo com aviso claro.** Hoje o servidor tenta de novo quando o provedor limita (`providerRetry`). Ideia: banner "usando outro modelo porque o principal está lento". [médio] *Feito: a troca ou a espera do provedor aparece como aviso no topo, não como passo escondido.*
44. **Todo erro com horário e etapa.** Ideia: "14:02 · na etapa de pesquisa". Ajuda a pessoa a dizer o que aconteceu ao suporte. [rápido] *Feito: o erro mostra a hora e a etapa.*

## Conversa e histórico — 45 a 50

45. **Busca na conversa com setas.** Hoje há busca com Ctrl+F (`chat-search`). Ideia: setas para ir ao resultado seguinte e contador "2 de 7". [rápido] *Feito: setas para cima e para baixo, além de Enter, na busca da conversa.*
46. **Renomear a conversa no próprio título.** Ideia: clicar no título para editar, sem ir a outra tela. [rápido] *Feito: o título da conversa abre o diálogo de renomear.*
47. **Resumo da conversa quando ela fica longa.** Ideia: depois de N mensagens, um resumo recolhido no topo com o que já foi decidido. [grande] *Feito (parcial): resumo automático com os pedidos da conversa, sem IA.*
48. **Fixar uma resposta.** Ideia: marcar a resposta importante e ver a lista delas no topo da conversa. [médio] *Feito: "Fixar" em cada resposta e lista "Fixadas" no topo.*
49. **Marca de "novo desde a última visita".** Hoje o botão "Ir para o fim" conta as mensagens novas (`jump-end`). Ideia: linha divisória na conversa onde começa o que chegou depois. [rápido] *Feito: linha "Novo desde a sua última visita" neste aparelho.*
50. **Leitor de tela anuncia etapa e resposta.** Hoje há região de anúncio na conversa. Ideia: anunciar só o início e o fim de cada etapa, para não lotar a leitura. [médio] *Feito: o leitor de tela anuncia a etapa que começou.*

---

## Ordem sugerida

- **Primeiro, os rápidos de maior efeito:** 2, 11, 13, 18, 32, 34, 35, 44, 45, 49.
- **Depois, o que muda a leitura das atividades:** 9, 10, 12, 16, 31.
- **Por último, o que precisa de dado novo do servidor:** 23, 28, 30, 36, 47.
