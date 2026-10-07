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
- ✅ **P0** Mensagem recebida na hora: "Ripper viu" em menos de 1 s (hoje você repete a mensagem achando que não chegou).
- ✅ **P0** Tarefa longa sem sinal: depois de 20 s no mesmo passo, mostrar "ainda em: rodando o build · 40 s" e permitir parar.
- [ ] P1 Escrever durante o trabalho: deixar claro que a mensagem nova entra no próximo passo (fila visível), em vez de parecer ignorada.

## 2. Respostas em que dá para confiar
- [ ] **P0** Fechamento padrão em tarefas com ação: **Feito** (o que mudou) · **Como verifiquei** · **Falta / precisa de você**. Sem "passou" sem ter rodado.
- [ ] **P0** Responder só o que foi pedido, no tom da mensagem — já vale entre agentes; estender a todas as conversas (sem puxar assunto antigo).
- [ ] P1 Fonte quando pedida (link .gov.br etc.): regra "fonte pedida, fonte entregue" (única falha real nas 50 tarefas).
- [ ] P1 Erros em linguagem de gente em todo lugar (hoje ainda aparecem "401", nomes de ferramentas, ids).

## 3. Delegação
- ✅ @menção numa conversa 1:1 traz o agente; recado entre agentes responde só ao que foi dito; aviso de "tarefa concluída" não gera "Recebido".
- [ ] **P0** Cartão de delegação no seu fio: "Pedi ao Donald: ajustar a faixa · trabalhando / feito · ver resultado". Você acompanha sem abrir outra conversa.
- [ ] **P0** Bloqueio vira pedido para você: quando um agente para por falta de algo (VM caiu, senha, aprovação), cria um item "precisa de você" na Caixa com o que fazer — hoje fica escrito no meio do grupo.
- [ ] P1 Painel "quem está fazendo o quê": cada agente com a tarefa atual, há quanto tempo e para quem vai o resultado.
- [ ] P1 @menção tolerante a nome (ex.: "@Ripper" e "@Engenheiro de Software (Ripper)" chamam o mesmo agente).
- [ ] P1 Agente não responde a confirmações de colega ("ok", "recebido") — encerra a troca.

## 4. Medir
- [ ] P1 10 conversas de referência (pedido simples, delegação, bloqueio, correção no meio) rodadas como as 50 tarefas: tempo até o 1º sinal, resposta no ponto, delegação entregue.
