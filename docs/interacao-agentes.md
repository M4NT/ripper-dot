# Interação com os agentes: o que falta para confiar a delegação

Objetivo: falar com um agente do Ripper ser como falar com o Claude — você vê o que ele está fazendo, ele responde o que foi pedido, diz o que verificou e o que falta, e entrega quando delega para um colega.
Base: conversas reais (grupo Engenharia Ripper, Porteiro ↔ Ripper), 50 tarefas medidas e histórico de tempos (07/10/2026).

Legenda: ✅ feito · [ ] falta. **P0** = sem isso não dá para confiar.

## 1. Ver o que está acontecendo
- ✅ Frase curta antes de usar ferramentas ("Vou rodar o build e já te digo").
- ✅ Rascunho entre ferramentas vira anotação nas atividades; a resposta é só o texto final, sem frases emendadas.
- ✅ Histórico de ações: uma linha por ação, nomes legíveis, repetidas viram ×N.
- ✅ Palavras aparecem com opacidade (sem cursor de barra).
- ✅ Turno sem texto não fica em branco; login expirado vira aviso claro.
- ✅ **P0** Mensagem recebida na hora: "Ripper viu" em menos de 1 s (hoje você repete a mensagem achando que não chegou). "Tentar de novo" reenvia com a mesma Idempotency-Key e o mesmo corpo: se o servidor já tinha recebido, não roda um segundo turno. Se a 1ª resposta ainda está rodando, a tela não mostra erro: avisa e passa a acompanhar ao vivo até terminar.
- ✅ **P0** Tarefa longa sem sinal: depois de 20 s no mesmo passo, mostrar "ainda em: rodando o build · 40 s" e permitir parar.
- ✅ P1 Escrever durante o trabalho: Enter com o agente trabalhando põe a mensagem na fila, visível acima do composer ("vai ler depois do passo atual", com Cancelar); sai sozinha quando o passo termina.

## 2. Respostas em que dá para confiar
- ✅ **P0** Fechamento padrão em tarefas com ação: **Feito** (o que mudou) · **Como verifiquei** · **Falta / precisa de você**. Sem "passou" sem ter rodado.
- ✅ **P0** Responder só o que foi pedido, no tom da mensagem — já vale entre agentes; estender a todas as conversas (sem puxar assunto antigo).
- ✅ P1 Fonte quando pedida: regra 13 do token-the-ripper ("fonte pedida, fonte entregue"; sem fonte, diz que não achou).
- ✅ P1 Erros em linguagem de gente: lib/human-errors.mjs cobre também créditos esgotados, ECONNREFUSED, OAuth e ids de ferramenta (mcp__/toolu_); o texto cru fica em "Ver detalhe".

## 3. Delegação
- ✅ @menção numa conversa 1:1 traz o agente; recado entre agentes responde só ao que foi dito; aviso de "tarefa concluída" não gera "Recebido".
- ✅ **P0** Cartão de delegação no seu fio (send_message, call_agent e @menção no grupo; resposta do colega fica dentro do cartão): "Pedi ao Donald: ajustar a faixa · trabalhando / feito · ver resultado". Você acompanha sem abrir outra conversa. call_agent emite `delegationStatus` ao começar e ao terminar: o cartão mostra "trabalhando"/"feito" na hora, sem esperar o fim do turno.
- ✅ **P0** Bloqueio vira pedido para você (skill manda usar ask_owner; se a resposta diz "preciso que você"/"BLOQUEADO" sem ask_owner, o servidor cria o item na Caixa): quando um agente para por falta de algo (VM caiu, senha, aprovação), cria um item "precisa de você" na Caixa com o que fazer — hoje fica escrito no meio do grupo. Quando você responde naquela conversa, o item some sozinho da Caixa.
- ✅ P1 Painel "quem está fazendo o quê": em Detalhes, cada membro do grupo mostra tarefa atual · há quanto tempo · para quem (1:1: linha "Agora:"), da mesma fonte da barra lateral (/api/agents/working, a cada 4 s).
- ✅ P1 @menção tolerante a nome: nome, apelido, nome sem parênteses, o que está entre parênteses ou uma palavra do nome, sem diferença de maiúsculas/acentos. Ambígua ("@Engenheiro" com dois) não chama ninguém e o agente pergunta qual.
- ✅ P1 Confirmação de colega ("ok", "recebido", "valeu", 👍) encerra a troca: no recado (inbox) não roda turno; no grupo não puxa o citado de volta.

## 4. Medir
- [ ] P1 10 conversas de referência (pedido simples, delegação, bloqueio, correção no meio) rodadas como as 50 tarefas: tempo até o 1º sinal, resposta no ponto, delegação entregue.
