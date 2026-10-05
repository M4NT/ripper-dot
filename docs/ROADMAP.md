# Ripper — Roadmap para ser o nº 1

Meta: agentes que trabalham como funcionários em **todas** as áreas, com o máximo de automação, tudo visível, de qualquer aparelho.
Referências a superar: ChatGPT (Agent, Tasks, Pulse, Projects), Grok (Tasks, Companions), Manus, Genspark, Lindy, Claude (Projects, Research).

Legenda: **P0** bloqueia uso/confiança · **P1** diferencial forte · **P2** polimento · ✅ feito

---

## 0. Já entregue (base)
- ✅ Agentes com computador próprio (Docker), navegador visível (noVNC), memória, rotinas, delegação, scripts aprendidos — auditoria 14/14 (`docs/capacidades.md`).
- ✅ Caixa (aprovações + avisos), WhatsApp (QR e Cloud API) com autonomia por contato, leitura de grupos, estilo aprendido.
- ✅ Entrega de arquivos com Abrir / Baixar / Mostrar na pasta.
- ✅ Redesign fases 1–4 (contraste, toque, agente no centro, canais).
- ✅ Movimento: entrada em cascata de cards, toque com resposta, `<details>` animado, telas sobem ao abrir.
- ✅ Instalável como app (PWA) no celular/tablet/desktop.
- ✅ Regra "web antes da VM" no prompt; orquestrador de times no modelo econômico.

## 1. Velocidade e economia (P0)
- ✅ Tempos por etapa gravados em cada resposta (preparo, roteamento, 1ª palavra, total) e mostrados na mensagem.
- ✅ Sem telemetria/checagem de atualização do CLI por turno (1ª palavra ~5s → ~1–2s no teste puro).
- ✅ Conectores do claude.ai sob demanda (custavam 3–5s por mensagem): memória 5.4→2.9s, delegação 13.8→5.9s.
- ✅ Processo do SDK pré-aquecido (`prewarm`) por agente; memórias e contexto do turno no fim (`appendSystemPrompt`). 1ª palavra 2.6s → 1.3–2.0s (`scripts/bench-prewarm.mjs`).
- [ ] Prompt de sistema enxuto: blocos só quando a ferramenta é usada. ✅ Cache de prompt: prefixo fixo primeiro, memórias saíram do meio.
- ✅ Roteador Julia com rota Haiku para conversa curta (Julia + heurística). Opus: a cascata de custo já escolhe; teto por modelo em Configurações.
- ✅ Multitarefa real: ferramenta `parallel_tasks` (2–5 subtarefas ao mesmo tempo, web + computador) com barra de progresso por subtarefa no chat.
- ✅ Custo do dia no card do agente (respostas, tokens e US$ estimados, tempo médio). Falta: R$ (câmbio) e tokens reais do SDK.

## 2. Entrada e saída multimodal (P0/P1)
- ✅ Ditado por voz em todos os navegadores (gravação + transcrição no servidor); texto ditado em *itálico* na bolha.
- ✅ Resposta falada: botão "Ouvir" em cada resposta e modo "mãos livres" (lê toda resposta) no composer — voz do navegador.
- ✅ WhatsApp: analisar imagem e áudio recebidos (transcrever áudio, descrever imagem) e responder com base nisso.
- [ ] Prévia inline de arquivos entregues (PDF, imagem, planilha em tabela).
- [ ] Geração de imagem e de slides como artefato.

## 3. Automação (P1 — onde viramos nº 1)
- [ ] **Agente Guardião do GitHub**: observa repositórios, abre issues/PRs, delega correções a outros agentes, revisa antes de pedir merge.
- [ ] Gatilhos por evento (e-mail chegou, planilha mudou, webhook, mensagem no WhatsApp com palavra-chave) além de horário.
- [ ] Fluxos visuais: encadear agentes num canvas (A pesquisa → B escreve → C publica), com aprovação em qualquer passo.
- [ ] Resumo diário proativo ("Pulse"): o que aconteceu, o que precisa de você, o que os agentes fizeram — na Caixa e no WhatsApp.
- [ ] E-mail como canal (ler, rascunhar, responder com aprovação), igual ao WhatsApp.
- [ ] Telegram, Instagram DM, Slack, Discord como canais.
- [ ] Marketplace de agentes e skills prontos com instalação de 1 clique (base existe em Marketplace/SkillsHub).

## 4. Visibilidade do trabalho (P1)
- [ ] Linha do tempo do agente: cada ação com tela/print, tempo, custo — reproduzível.
- [ ] Ver a tela da VM ao vivo dentro do chat (miniatura que expande) enquanto ele age.
- [ ] Grupos: linhas de delegação visíveis ("Ana pediu a Bruno…"), quem está falando, fila.
- [ ] Painel lateral unificado: Detalhes / Arquivos / Tarefas / Tela.
- [ ] Nota de desempenho por agente (taxa de sucesso, aprovações recusadas, tempo).

## 5. Interface (P1/P2) — revisão tela a tela
| Tela | Pendências |
|---|---|
| Início | Mostrar "o que seus agentes fizeram hoje" no lugar do herói quando já há agentes. |
| Caixa | ✅ Filtros não estouram no celular. Ações em lote; atalhos de teclado (A aprovar, R recusar); notificação push. |
| Agentes | Busca/filtro; status ao vivo no card (trabalhando/ocioso); duplicar agente. |
| Novo agente | Criação em 1 frase ("um agente que responde clientes no WhatsApp") → configura tudo (fase 6). |
| Config. do agente | Testar ferramenta ali mesmo; histórico de mudanças. |
| Chat | Editar mensagem e reenviar; ramificar; fixar; buscar dentro da conversa. |
| Conversas | Pastas/etiquetas; arquivar em lote. |
| Projetos | Quadro de tarefas (kanban) atribuídas a agentes. |
| Biblioteca | Busca em texto completo de artefatos e arquivos. |
| Conectores / Integrações / Marketplace | Unificar em um catálogo só (fase 5). |
| Configurações | ✅ Linhas não espremem com o menu aberto; abas no celular corrigidas. Busca de configuração; dizer o efeito de cada chave; "restaurar padrão" por seção. |
| Admin | Gráficos de uso por período; exportar CSV. |

## 6. Qualquer aparelho (P1)
- ✅ PWA instalável.
- [ ] Notificações push (Web Push) para aprovações e avisos urgentes.
- [ ] Layout de tablet (duas colunas: lista + conversa).
- [ ] Cabeçalho móvel e alternância Simples/Enterprise acessíveis no celular (fase 5).
- [ ] Acesso remoto seguro (túnel com login) para usar fora da rede de casa.
- [ ] Relógio: via notificações push espelhadas (aprovar/recusar direto no relógio); app nativo só se houver demanda.
- [ ] Atalhos de voz (Siri/Google Assistant) que abrem a conversa com o agente.

## 7. Confiança e segurança (P0)
- [ ] Login com senha/passkey quando exposto fora do localhost.
- [ ] Registro de auditoria de toda ação externa (mensagem enviada, compra, post).
- [ ] Limite de gasto por agente com pausa automática.
- [ ] Backup automático agendado (hoje é manual).

## 8. Qualidade
- [ ] Smoke de UI estável em máquina carregada (CI já cobre).
- [ ] Auditoria de capacidades rodando toda noite e alertando na Caixa se algo quebrar.
- [ ] Pesquisa de concorrentes atualizada a cada trimestre (este arquivo).
