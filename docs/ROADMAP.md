# Ripper — Roadmap para ser o nº 1

Meta: agentes que trabalham como funcionários em **todas** as áreas, com o máximo de automação, tudo visível, de qualquer aparelho.
Referências a superar: ChatGPT (Agent, Tasks, Pulse, Projects), Grok (Tasks, Companions), Manus, Genspark, Lindy, Claude (Projects, Research).

Legenda: **P0** bloqueia uso/confiança · **P1** diferencial forte · **P2** polimento · ✅ feito

Princípio de custo: **a assinatura (Claude Code / ChatGPT) é o modelo principal**. Qualquer coisa que gaste crédito (OpenRouter, Claude por API key) só roda com consentimento explícito e dentro de limite diário.

Última atualização: 05/10/2026.

---

## Próximos passos (em ordem)
1. **E-mail como canal** (§3) — ler, rascunhar e responder com aprovação; destrava o gatilho "e-mail chegou".
5. Provedores diretos: OpenAI, Gemini, Ollama (§1b).

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
- ✅ Processo do SDK pré-aquecido (`prewarm`) por agente — 1ª palavra 2.6s → 1.3–2.0s (`scripts/bench-prewarm.mjs`). Até 3 processos parados (~250 MB cada); a 1ª mensagem de cada agente ainda é fria.
- ✅ Cache de prompt: prefixo fixo primeiro; memórias e contexto do turno vão no fim.
- [ ] Prompt de sistema enxuto: medir o tamanho real por agente e cortar blocos raramente usados (a maioria já é condicional à ferramenta).
- ✅ Roteador: rota Haiku para conversa curta (Julia + heurística). Opus: a cascata de custo decide; teto por modelo em Configurações.
- ✅ Multitarefa real: ferramenta `parallel_tasks` (2–5 subtarefas ao mesmo tempo, web + computador) com barra de progresso por subtarefa no chat.
- ✅ Custo do dia no card do agente (respostas, tokens e US$ estimados, tempo médio). Respostas pagas mostram o custo real.
- [ ] Custo em R$ (câmbio do dia).

## 1b. Provedores de IA (P0)
- ✅ Tela "Provedores de IA": grade com todos os provedores (logo, status, nº de modelos, "assinatura" ou "pago por uso") e detalhe de cada um (o que faz no Ripper, o que ainda não faz, conexão e modelos).
- ✅ OpenRouter com as ferramentas do Ripper (computador, navegador, memória, delegação; web pelo plugin do OpenRouter); escolha de modelos pelo catálogo; teste de chave. Falha → cai no Claude pela assinatura.
- [ ] OpenAI direto (chave), Gemini (AI Studio — cobre os modelos do Antigravity), Ollama (local, grátis). Reaproveitam `lib/openrouter.mjs` (API compatível com OpenAI).
- [ ] Cursor (`cursor-agent`, como o Codex).
- [ ] Plugins MCP do usuário nos provedores novos (hoje só Claude/Codex).
- [ ] Ripper Auto escolher modelos do OpenRouter (hoje só por escolha manual) — só com uso pago ativo.

## 2. Entrada e saída multimodal (P0/P1)
- ✅ Ditado por voz em todos os navegadores (Chrome/Edge nativo; demais gravam e transcrevem com Whisper local); texto ditado em *itálico*.
- ✅ Resposta falada: botão "Ouvir" e modo "mãos livres" (voz do navegador).
- ✅ WhatsApp: transcreve áudio (Whisper local) e descreve imagem (Haiku) antes de responder.
- ✅ Prévia inline de arquivos entregues: imagem, PDF embutido, CSV em tabela.
- [ ] Prévia de .xlsx em tabela.
- ✅ Slides: python-pptx no computador do agente (entrega .pptx).
- [ ] Geração de imagem — falta escolher provedor (OpenAI/Gemini pela API, ou modelo local).
- ⚠️ Ditado, WhatsApp-áudio e slides exigem **reconstruir a imagem dos agentes** (`ripper-agent:2`) em Configurações → Computador.

## 3. Automação (P1 — onde viramos nº 1)
- ✅ **Resumo diário ("Pulse")**: todo dia (8h, ajustável em Configurações → Perfil) na Caixa — o que cada agente fez, arquivos, rotinas (e quais falharam), ações em seu nome, gasto e o que espera você. Montado sem chamar modelo (zero tokens); `GET /api/pulse` mostra na hora.
- [ ] Pulse também no WhatsApp do dono e na tela Início.
- ✅ Gatilho por webhook (GitHub, formulários, qualquer sistema).
- ✅ Gatilho "mensagem no WhatsApp": palavras-chave (palavra inteira, sem acento/maiúscula; vazio = toda mensagem), de contatos, grupos ou ambos; áudios transcritos também disparam; mensagens suas não; no máximo 1 disparo por minuto por rotina. Grupos exigem "Ler grupos" e o agente nunca responde no grupo.
- [ ] Gatilho "e-mail chegou" (depende do e-mail como canal) e "planilha mudou" (Google Drive).
- [ ] **Agente Guardião do GitHub**: observa repositórios, abre issues/PRs, delega correções, revisa antes de pedir merge.
- [ ] Fluxos visuais: encadear agentes num canvas (A pesquisa → B escreve → C publica), com aprovação em qualquer passo.
- [ ] E-mail como canal (ler, rascunhar, responder com aprovação), igual ao WhatsApp.
- [ ] Telegram, Instagram DM, Slack, Discord como canais.
- [ ] Marketplace de agentes e skills prontos com instalação de 1 clique (base existe em Marketplace/SkillsHub).

## 4. Visibilidade do trabalho (P1)
- ✅ Registro de ações externas (Caixa → Ações externas) — ver §7.
- ✅ Subtarefas em paralelo com barra de progresso no chat.
- [ ] Linha do tempo do agente: cada ação com tela/print, tempo, custo — reproduzível.
- [ ] Ver a tela da VM ao vivo dentro do chat (miniatura que expande) enquanto ele age.
- [ ] Grupos: linhas de delegação visíveis ("Ana pediu a Bruno…"), quem está falando, fila.
- [ ] Painel lateral unificado: Detalhes / Arquivos / Tarefas / Tela.
- [ ] Nota de desempenho por agente (taxa de sucesso, aprovações recusadas, tempo).

## 5. Interface (P1/P2) — revisão tela a tela
| Tela | Pendências |
|---|---|
| Início | Mostrar "o que seus agentes fizeram hoje" no lugar do herói quando já há agentes (base: Pulse). |
| Caixa | ✅ Filtros não estouram no celular. ✅ Avisos de gasto e do sistema. ✅ Link para Ações externas. ✅ Filtros "Gasto" e "Sistema". ✅ Resumo do dia (sem cor de alerta). Ações em lote; atalhos (A aprovar, R recusar); notificação push. |
| Agentes | ✅ Custo e tempo do dia no card. Busca/filtro; status ao vivo no card; duplicar agente. |
| Novo agente | Criação em 1 frase ("um agente que responde clientes no WhatsApp") → configura tudo. |
| Config. do agente | Testar ferramenta ali mesmo; histórico de mudanças; limite de gasto próprio do agente. |
| Chat | ✅ Ouvir resposta; ✅ prévia de arquivos; ✅ custo por resposta paga. Editar e reenviar; ramificar; fixar; buscar na conversa. |
| Conversas | Pastas/etiquetas; arquivar em lote. |
| Projetos | Quadro de tarefas (kanban) atribuídas a agentes. |
| Biblioteca | Busca em texto completo de artefatos e arquivos. |
| Conectores / Integrações / Marketplace | Unificar em um catálogo só (mesmo padrão da grade de Provedores). |
| Configurações | ✅ Provedores de IA em grade. ✅ Backup visível no modo Simples. ✅ Não espreme mais em ~800px nem no celular; busca de configuração; "restaurar padrão" por seção. |
| Admin | Gráficos de uso por período; exportar CSV. |

## 6. Qualquer aparelho (P1)
- ✅ PWA instalável.
- [ ] Notificações push (Web Push) para aprovações, gasto e avisos do sistema.
- [ ] Layout de tablet (duas colunas: lista + conversa).
- [ ] Cabeçalho móvel e alternância Simples/Enterprise acessíveis no celular.
- [ ] Acesso remoto seguro (túnel com login) — depende do login (§7).
- [ ] Relógio: via push espelhado (aprovar/recusar direto no relógio).
- [ ] Atalhos de voz (Siri/Google Assistant) que abrem a conversa com o agente.

## 7. Confiança e segurança (P0)
- ⏸ **Login com senha/passkey quando exposto fora do localhost** — adiado por decisão do dono (05/10/2026). Hoje só existe `RIPPER_TOKEN`. Atenção: um túnel (Cloudflare/ngrok) apontando para o Ripper hoje entra sem pedir nada, pois chega por 127.0.0.1.
- ✅ Registro de ações externas: WhatsApp enviado e respostas automáticas, posts/webhooks, ações arriscadas no navegador, links públicos, uso pago ligado/desligado. Sempre ligado (não depende do Enterprise), imutável, filtros por tipo/agente/período e CSV. Não guarda o conteúdo (só destino, tipo e tamanho).
- ✅ Uso pago só com consentimento explícito (aviso + confirmação); limite diário por agente (US$ 2) e total (US$ 10) com pausa automática do gasto, aviso na Caixa e custo real por resposta. A assinatura nunca é bloqueada.
- ✅ Backup automático: ligado por padrão (diário, 7 cópias), cópia extra opcional em outra pasta (OneDrive/Drive/disco externo), aviso na Caixa se falhar, e checkpoint do SQLite antes de empacotar (antes ficavam de fora as gravações mais recentes).
- ✅ Chaves de API e tokens cifrados no db.json (AES-256-GCM, chave em `~/.ripper/secret.key`, fora da pasta de dados): backups, cópia extra e exportação JSON levam só texto cifrado. Restaurar em outra máquina sem a chave = redigitar as chaves.
- [ ] Segredos internos da Evolution (`data/evolution.json`) também cifrados.

## 8. Qualidade
- [ ] Smoke de UI estável em máquina carregada (CI já cobre).
- [ ] Auditoria de capacidades rodando toda noite e alertando na Caixa se algo quebrar (usar `raiseSystemAlert`).
- [ ] Pesquisa de concorrentes atualizada a cada trimestre (este arquivo).

---

## Pontes a construir ou corrigir

Coisas encontradas durante o desenvolvimento: ligações que faltam entre partes que já existem, ou defeitos que ainda não doem mas vão doer.

### P0 — podem perder dados ou expor segredos
- ✅ ~~db.json descartava chaves que não conhece~~: além de `juliaCorrections` (correções ao Ripper Auto), o `auditLog` também voltava ao vazio a cada gravação. Agora toda chave sem regra própria é preservada (teste `db-merge-unknown-keys`).
- ✅ ~~Segredos em texto puro no db.json e nos backups~~: cifrados (ver §7). O cofre de credenciais não servia aqui: a chave dele vem do navegador, e rotinas/WhatsApp rodam sem aba aberta.
- ✅ ~~Registro imutável × LGPD~~: o registro de ações externas guarda só destino, tipo e tamanho — nunca o texto. O conteúdo fica na conversa, onde a exclusão funciona. (Registros anteriores a 05/10/2026 ainda têm o trecho: a trilha é imutável.)

### P1 — funcionam, mas com teto conhecido
- **Gasto entre processos.** `paidSpend` no merge do db.json é "quem gravou por último vence": com dois servidores no mesmo diretório o gasto do dia é subcontado. Mover para SQLite (como usage-events) se houver mais de um processo.
- **Ferramentas Ripper fora do Claude.** OpenRouter não usa plugins MCP do usuário; subtarefas em paralelo sempre rodam no Claude (pela assinatura); Ripper Auto não escolhe modelos do OpenRouter.
- **Backup trava o servidor alguns segundos por dia.** `tar` roda síncrono (`spawnSync`); trocar por spawn assíncrono quando a pasta de dados crescer (hoje ~13 MB).
- **Pré-aquecimento.** 1ª mensagem por agente ainda é fria; no máximo 3 processos parados. Aquecer ao abrir a conversa do agente (não só depois do 1º turno).
- **Aba aberta durante uma atualização.** Abas abertas antes de um `npm run build` continuam com o JavaScript antigo, e telas carregadas sob demanda dão 404. Mostrar "Nova versão disponível — recarregar".
- **Uso pago só configurável no modo Enterprise.** A tela Provedores de IA não aparece no modo Simples; quem é Simples não consegue nem ver o consentimento. Ok enquanto OpenRouter for recurso avançado; revisar se virar padrão.
- **Imagem dos agentes desatualizada.** Quem não reconstruiu a `ripper-agent:2` só descobre quando uma transcrição falha. Avisar na Caixa (aviso do sistema) quando a imagem instalada for mais antiga que a esperada.

### P2 — qualidade e higiene
- **Testes instáveis em máquina carregada.** Testes que sobem o servidor (vault, idempotência, openapi, cabeçalhos) estouram ~15s quando há outros servidores rodando; passam sozinhos. Aumentar o tempo de espera de subida ou rodar esses arquivos em série.
- **`listExternal` lê até 5.000 linhas e filtra em memória.** Filtrar por tipo/agente no SQL se o registro crescer muito.
