# Plano: calendário de rotinas (item 26)

Status: aprovado em parte. Lista de 7 dias confirmada. Pausa e grade do desktop continuam em aberto. Nada foi implementado.

## O que é

Uma tela que mostra o que vai rodar e quando: as próximas execuções das rotinas, por dia e por horário. Hoje a lista de rotinas diz o horário de cada uma, mas não mostra a ordem nem a agenda da semana.

## Como as rotinas funcionam hoje (base do plano)

Fatos do código, para o cálculo não divergir do que o servidor faz:

- **Intervalo:** `everyMinutes` (mínimo 5). Roda quando passou esse tempo desde `lastRun` (`routineDue` em `lib/agent-flow.mjs`).
- **Horário diário:** `dailyAt` ("HH:MM"), com `weekday` (0 a 6) ou `weekdays` (segunda a sexta). Roda quando o horário bate com o minuto atual e passou mais de 60 s desde a última execução.
- **Gatilho por evento:** `trigger` (webhook, e-mail ou WhatsApp). Não tem horário; roda quando o evento chega. Não entra no calendário por horário.
- **Agendador:** confere as rotinas a cada 30 s (`server.mjs`, `routineTimer`).
- **Pausa:** não existe campo de pausa em rotina. O calendário não mostra botão de pausar.

## O que a pessoa vê

- **Celular (principal):** lista dos próximos 7 dias. Cada dia traz as execuções em ordem de horário, com nome da rotina, agente e um selo de último resultado.
- **Intervalos:** rotina a cada X minutos não gera uma marca por execução (seriam centenas). Aparece como um chip "a cada 15 min" no topo do dia.
- **Eventos:** seção à parte, "dispara quando chega evento", para webhook, e-mail e WhatsApp.
- **Desktop:** grade da semana (7 colunas) com as marcas de horário. O mesmo dado da lista do celular.
- **Toque:** abre a rotina para editar.

## Como calcular (servidor)

Uma função pura, sem depender do relógio do navegador:

`proximasExecucoes(rotina, agora, dias) -> [{ quando, rotinaId }]`

- Intervalo: próxima = `lastRun + intervalo` (ou agora, se nunca rodou), e repete até o fim do período (só para decidir se mostra o chip, não lista tudo).
- Diária: próximo horário "HH:MM" a partir de agora, nos dias permitidos.
- Fuso: horário de Brasília, sempre.

Endpoint: `GET /api/routines/agenda?dias=7`, que devolve o resultado e o selo de último resultado. A tela só consome isso.

## Fases

1. **Função de cálculo** com testes. Teste principal: para cada tipo de rotina, a próxima execução calculada é a mesma que `routineDue` aceitaria naquele minuto.
2. **Endpoint** `GET /api/routines/agenda`.
3. **Lista de 7 dias no celular**, com chip de intervalo e seção de eventos.
4. **Grade semanal no desktop.**
5. **Testes de interface:** em 375 px e 1280 px, nos dois temas.

## Critérios de aceite

- Para cada rotina, a próxima execução mostrada bate com `routineDue` no mesmo minuto (teste automatizado).
- Rotina a cada 5 minutos não gera mais de um chip, e a lista não trava com várias rotinas.
- Execuções passadas não aparecem como próximas.
- Rotina com gatilho aparece só na seção de eventos.
- Sem rolagem lateral no celular.

## Riscos

- O agendador confere a cada 30 s, então um horário exato pode disparar com até 30 s de atraso. A tela deve mostrar o horário, não uma promessa de segundo exato.
- Rotina com fluxo (`flowId`) pode ter mais de uma etapa. Mostrar só a rotina, não cada etapa, na primeira versão.

## Decisões

1. **Respondida:** 7 dias na lista.
2. **Em aberto:** pausar e retomar rotinas nesta tela. Exige campo novo na rotina e mudança no agendador.
3. **Em aberto:** no desktop, grade semanal ou só lista, como no celular.

## Estimativa (grosseira)

Fase 1: 1 dia. Fase 2: meio dia. Fase 3: 1 dia. Fase 4: 1 dia. Fase 5: meio dia. Total perto de 4 dias úteis.
