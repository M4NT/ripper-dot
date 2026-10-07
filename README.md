# Ripper

**Um time de agentes de IA que trabalha de verdade, no seu computador.**

Cada agente tem função, memória e **um computador próprio** (isolado) para navegar, rodar programas e criar arquivos. Eles trabalham sozinhos em rotinas, conversam entre si e pedem a sua aprovação antes de qualquer coisa com efeito fora (mandar mensagem, publicar, gastar). Você usa a **sua própria assinatura de IA** (Claude, ChatGPT ou chave de API) e os dados ficam com você.

Feito para dois públicos com o mesmo peso: quem **não programa** (dono de pequena empresa, atendimento, financeiro) e quem é **técnico** (devs e TI montando times de agentes). Interface em português, uma plataforma só, com tudo visível.

> Norte do projeto: **ser melhor que o Grok Bot**, com critérios medidos. Plano completo em [docs/ROADMAP.md](docs/ROADMAP.md).

---

## Sumário

1. [O que o Ripper faz](#o-que-o-ripper-faz)
2. [Instalação](#instalação)
3. [Primeiro uso](#primeiro-uso)
4. [Usando no dia a dia](#usando-no-dia-a-dia)
5. [Celular](#celular)
6. [Atualizar, fazer backup e desinstalar](#atualizar-fazer-backup-e-desinstalar)
7. [Segurança e privacidade](#segurança-e-privacidade)
8. [Onde ficam os dados](#onde-ficam-os-dados)
9. [Configuração por variáveis de ambiente](#configuração-por-variáveis-de-ambiente)
10. [Operação: saúde, métricas e logs](#operação-saúde-métricas-e-logs)
11. [Arquitetura](#arquitetura)
12. [Estrutura de pastas](#estrutura-de-pastas)
13. [Desenvolvimento](#desenvolvimento)
14. [Como contribuir](#como-contribuir)
15. [Julia 1 (classificador opcional)](#julia-1-classificador-opcional)
16. [Solução de problemas](#solução-de-problemas)
17. [Documentação](#documentação)
18. [Licença](#licença)

---

## O que o Ripper faz

### Agentes
- Crie um agente **descrevendo em uma frase** o que ele faz; o Ripper monta nome, instruções e ferramentas. Também há modelos prontos (atendimento, conteúdo, análise de dados e outros).
- Cada agente tem **instruções, tom de voz, modelo de IA, nível de autonomia e ferramentas** próprias (pesquisa na web, navegador, computador, memória, rotinas, arquivos, conectores).
- **Mascotes** dão rosto a cada agente e mostram o estado: trabalhando, esperando você ou pausado.
- Agentes **chamam uns aos outros**, passam tarefas e trabalham em paralelo. Um agente pode até criar outros agentes e grupos, se você permitir.

### Conversa
- Estilo mensageiro: **um agente = uma conversa**. As conversas antigas de cada agente são juntadas numa só; as outras ficam arquivadas, nada é apagado.
- **Grupos** com vários agentes, que respondem por ordem de menção, chamada por nome ou escolha automática.
- **Marcar um agente:** arraste o agente para a conversa (ou escreva `@Nome`) e ele entra na rodada, mesmo numa conversa de 1 a 1.
- Respostas ao vivo, mostrando o que o agente está fazendo ("Pesquisando na web…", "Usando o computador…").
- Anexos (imagens, PDF, planilhas, documentos), ditado por voz e busca dentro da conversa.
- **Configuração dentro da conversa:** peça "quero o resumo diário" e o agente mostra o interruptor no balão. Nada muda sem o seu clique.

### Caixa (o que precisa de você)
- Aprovações de ações com efeito fora (rodar comando, enviar WhatsApp ou e-mail, publicar, abrir PR), perguntas dos agentes, recados de clientes e avisos do sistema.
- Aprovação **em lote** e atalhos de teclado.
- Toda ação externa fica registrada numa trilha de auditoria (sem o conteúdo).

### Rotinas e fluxos
- **Rotinas:** o agente trabalha sozinho num horário ("todo dia às 8h") ou quando algo acontece (mensagem no WhatsApp, e-mail, webhook). Ele só deixa conversa quando tem novidade.
- **Fluxos:** vários agentes em sequência, cada um vendo o que o anterior fez.
- **Resumo do dia:** o que cada agente fez, o que espera você e quanto gastou, na Caixa (e opcionalmente no WhatsApp).

### Computador do agente
- Cada agente roda num **contêiner Docker** isolado com Chromium, tela virtual (noVNC), Node 22 e Python 3. A pasta de trabalho é montada em `/project`.
- Veja a **tela ao vivo** e os comandos na aba **Computador** da ficha do agente.
- Alternativas: **boat.dev** (VM na nuvem), **pasta local** (comandos na sua máquina, cada um pedindo aprovação) ou **sem computador** (o agente conversa, pesquisa e lembra, mas não executa nada).

### Conectores e canais
- **Marketplace** ("Conectar aplicativos", no pé da barra lateral): Gmail, Google Agenda, Drive, GitHub, Notion, Linear, Slack, Vercel e outros, pelos conectores da sua conta do Claude ou por servidores **MCP** (HTTP ou stdio, com OAuth).
- **WhatsApp:** pelo QR Code (WhatsApp Web) ou pela Cloud API oficial da Meta. Um agente atende os contatos liberados e deixa recados na Caixa; cada envio pede aprovação.
- **E-mail** (IMAP/SMTP), **GitHub** (ler, comentar, abrir issue e PR), **webhooks** de saída e **Google Tasks**.

### Memória, biblioteca e skills
- **Memória** entre conversas: o agente guarda fatos e preferências importantes.
- **Biblioteca:** artefatos (documentos que o agente salva), arquivos entregues, skills e memórias, num só lugar.
- **Skills:** passo a passo reutilizável que o agente carrega só quando precisa (economiza uso da assinatura).
- **Scripts aprendidos:** o agente guarda o que funcionou para reaproveitar.

### Modelos de IA
- **Claude por assinatura** (Pro, Max, Teams), com **várias contas** e troca automática quando uma atinge o limite.
- **Codex** (assinatura do ChatGPT), **chave de API** da Anthropic, **OpenRouter**, **OpenAI**, **Gemini** e **Ollama** (modelos locais).
- **Ripper Auto:** escolhe o modelo a cada pedido (simples, difícil ou código) e troca se um falhar.
- Painel de **uso das assinaturas** por conta, custo em uso pago e limites de gasto, com aviso claro antes de qualquer cobrança.

### Interface
- Tema **escuro** (padrão) e **claro**. Barra lateral com **agentes fixados** e lista reorganizáveis **arrastando** ou pelo **teclado**.
- **Uma plataforma só, com tudo visível** (decisão de 07/10/2026). A separação em modo Simples × Enterprise continua no código e volta com `RIPPER_MODES=1`.
- **Ajuda** dentro do app (tecla `?`), com pedidos prontos.
- Acessível: navegação por teclado, foco preso nas janelas, contraste AA nos dois temas (verificado por teste).

### Confiabilidade
- **Não perde respostas no reinício:** turnos cortados que só tinham lido ou pesquisado são retomados sozinhos; os que já tinham feito algo com efeito fora param com aviso, para não repetir.
- **Serviço do sistema:** sobe com o computador e volta sozinho se cair.
- **Reinício gracioso:** espera as respostas em andamento terminarem.
- **Backup automático diário**, com cópia extra opcional em outra pasta.
- **Atualização pela interface**, com as novidades listadas.
- **Fila de envios:** se o WhatsApp ou o e-mail cair, a mensagem espera e sai quando o canal volta.
- **Painel de saúde** (servidor, Docker, contas, canais, backup) numa tela só.

---

## Instalação

### O que você precisa

| Item | Obrigatório? | Para quê |
| --- | --- | --- |
| Computador com Windows, macOS ou Linux | Sim | O Ripper roda na sua máquina |
| **Node.js 22+** | Sim | Base do Ripper (o instalador do Windows instala sozinho) |
| Uma conta de IA | Sim | Claude (Pro/Max/Teams), ChatGPT (Codex), chave de API ou modelo local (Ollama) |
| **Docker Desktop** | Recomendado | Computador próprio de cada agente e WhatsApp por QR Code |
| Python 3.11+ | Não | Só para o classificador Julia 1 |

### Windows, sem terminal

1. Baixe o Ripper (ZIP ou `git clone https://github.com/M4NT/ripper-dot.git`).
2. Dê **dois cliques em `scripts\instalar-windows.cmd`**.

Ele instala o Node pelo winget se faltar, prepara tudo, cria o serviço que sobe com o Windows e abre o Ripper no navegador.

### Mac, sem terminal

1. Baixe o Ripper (ZIP ou `git clone`).
2. Dê **dois cliques em `scripts/instalar-mac.command`**. Na primeira vez, o macOS pode bloquear: clique com o botão direito → **Abrir**.

Ele instala o Node (pelo Homebrew, se você tiver, ou pelo instalador oficial, que pede a sua senha), prepara tudo, cria o serviço que sobe com o Mac e abre o Ripper no navegador.

### Manual (Windows, macOS e Linux)

```bash
git clone https://github.com/M4NT/ripper-dot.git
cd ripper-dot
npm ci
npm run build
npm start
```

Abra **http://127.0.0.1:3000**. Para o Ripper subir sozinho com o computador e voltar se cair:

```bash
node scripts/service.mjs install
```

`node scripts/service.mjs status` mostra se está ativo e `node scripts/service.mjs uninstall` desfaz. Com o serviço instalado, não rode `npm start` ao mesmo tempo, porque os dois disputariam a mesma porta.

### Conta de IA

- **Claude por assinatura:** instale o [Claude Code](https://claude.com/claude-code) e rode `claude login`. Para várias contas (pessoal e Teams), adicione cada uma em Configurações › Provedores de IA.
- **ChatGPT / Codex:** instale o Codex e rode `codex login`.
- **Chave de API, OpenRouter, OpenAI, Gemini ou Ollama:** cole em Configurações › Provedores de IA.
- **Não tenho conta:** o assistente de primeiro uso indica um modelo local adequado ao seu computador.

### Docker (opcional, recomendado)

Instale o [Docker Desktop](https://www.docker.com/products/docker-desktop) e deixe aberto. O Ripper detecta sozinho e passa a dar um computador a cada agente. A imagem dos agentes é montada na primeira vez (leva alguns minutos).

---

## Primeiro uso

1. **Crie a senha** que protege o seu Ripper. O código de configuração aparece no terminal e também fica em `data/setup-code.txt`.
2. O **assistente de primeiro uso** pergunta qual conta de IA usar, confere o Docker e cria o seu primeiro agente a partir de uma frase.
3. Mande uma mensagem. Quando o agente quiser fazer algo em seu nome fora do computador, o pedido aparece na **Caixa** para você aprovar.

Esqueceu a senha? Rode `node scripts/senha.mjs` no computador do Ripper para definir uma nova (isso derruba todas as sessões abertas). Com `--apagar`, o Ripper volta a pedir uma senha nova ao abrir.

---

## Usando no dia a dia

### A tela

- **Esquerda:** agentes **fixados** no topo, a **Caixa** e a lista de agentes e grupos. No pé, a sua inicial (menu da conta) e **Conectar aplicativos**.
- **Centro:** a conversa.
- **Direita:** a **ficha do agente**, com as abas Detalhes, Artefatos, Arquivos e Computador.
- **Janelas por cima:** Marketplace, Configurações, Ajuda e Saúde. Esc ou clique fora fecha.

### Atalhos de teclado

| Atalho | O que faz |
| --- | --- |
| `Ctrl K` (`⌘ K` no Mac) | Busca rápida: agentes, conversas, artefatos, skills e ações |
| `Ctrl ,` | Configurações |
| `Ctrl B` | Recolher ou expandir a barra lateral |
| `Ctrl .` | Mostrar ou esconder a ficha do agente |
| `?` | Ajuda |
| `Enter` / `Shift Enter` | Enviar / nova linha |
| `Alt ←/→` | Mover um agente fixado |
| `Alt ↑/↓` | Mover um agente ou grupo na lista |
| `Alt P` | Fixar ou desafixar o agente selecionado |
| Na Caixa: `J`/`K`, `X`, `A`, `R` | Navegar, marcar, aprovar, recusar |

### Organizar a barra lateral

Arraste um agente da lista para o topo para fixá-lo (até 4). Arraste entre os fixados para trocar a ordem, arraste de volta para a lista para desafixar, e arraste na lista para reordenar. A ordem vale em todos os aparelhos.

---

## Celular

O Ripper funciona como app no celular (PWA: "Adicionar à tela inicial").

- **Em casa (mesmo Wi-Fi):** Configurações › Perfil › **Celular na mesma rede** › Ligar › **Mostrar QR Code**. Aponte a câmera; o celular entra sem digitar senha.
- **Fora de casa:** Configurações › Perfil › **Celular fora de casa**. Instale o [Tailscale](https://tailscale.com/download) (grátis para uso pessoal) no computador e no celular, com a mesma conta, ligue o acesso e leia o QR Code. Só os seus aparelhos enxergam o Ripper, e nada passa por servidor nosso.
- **Notificações:** "precisa de você" chega no celular. Pedidos de sim/não têm os botões **Aprovar** e **Recusar** na própria notificação.
- **Aparelhos pareados** ficam listados, com "Desconectar este aparelho". Cada convite vale por 10 minutos e uma única vez.

---

## Atualizar, fazer backup e desinstalar

### Atualizar

O Ripper confere a cada 6 horas se há versão nova e avisa na Caixa. Em **Configurações › Backup › Versão do Ripper** aparecem as novidades e o botão **Atualizar agora**.
- Ele **só avança**: se algum arquivo do Ripper foi mexido nesta máquina, recusa e pede atualização manual.
- Como serviço, reinicia sozinho na versão nova, esperando as respostas em andamento.

Atualização manual:

```bash
git pull --ff-only
npm ci
npm run build
node scripts/service.mjs restart
```

### Backup

- **Automático diário** (Configurações › Backup), guardando as últimas N cópias e, se você quiser, uma **cópia extra numa pasta sincronizada** (OneDrive, Google Drive, Dropbox) ou num disco externo.
- **Fazer uma cópia agora** e **restaurar** qualquer cópia pela mesma tela.
- **Exportar tudo** (Configurações › Segurança): um pacote fácil de abrir com conversas, agentes, rotinas e arquivos. Senhas e chaves ficam de fora.

### Desinstalar

Dois cliques em `scripts\desinstalar-windows.cmd` (Windows) ou `scripts/desinstalar-mac.command` (Mac), ou `node scripts/desinstalar.mjs` em qualquer sistema. Isso tira o serviço e os computadores dos agentes e **mantém os seus dados**: reinstalando, tudo volta como estava. Para apagar também os dados, use `--apagar-dados`; o script lista o que vai sumir e pede que você digite `APAGAR`.

---

## Segurança e privacidade

- **Roda no seu computador.** O servidor escuta só em `127.0.0.1`. Abrir para a rede (Wi-Fi ou Tailscale) é uma escolha explícita e exige a senha criada.
- **Senha única** protege cada instalação (sessão com cookie `HttpOnly`/`SameSite=Strict`, bloqueio após tentativas erradas, proteção contra CSRF). Os computadores dos agentes não entram na API.
- **Aprovação** antes de toda ação com efeito fora, com registro na trilha de auditoria (sem conteúdo).
- **Autonomia por agente:** você escolhe o quanto cada um decide sozinho.
- **Segredos cifrados** no disco e nos backups (chave em `~/.ripper/secret.key`; cofre de credenciais para conectores).
- **LGPD:** opção de esconder CPF, documentos, contas e contatos antes de mandar texto para a IA; registro de consentimento no WhatsApp; exportação completa dos dados; retenção configurável.
- **Comandos na sua máquina** (modo pasta local) só com ativação explícita, e cada comando pede aprovação.

Detalhes em [docs/seguranca.md](docs/seguranca.md), [docs/privacidade-e-dados.md](docs/privacidade-e-dados.md), [docs/termos-de-uso.md](docs/termos-de-uso.md) e [docs/politica-de-privacidade.md](docs/politica-de-privacidade.md) (os dois últimos são rascunhos, ainda sem revisão jurídica).

---

## Onde ficam os dados

Tudo fica na pasta **`data/`** do Ripper (ou em `RIPPER_DATA`), que nunca vai para o Git.

| Arquivo / pasta | Conteúdo |
| --- | --- |
| `db.json` | Estado principal: agentes, conversas, rotinas, projetos, configurações (segredos cifrados) |
| `usage.sqlite` | Eventos de uso por resposta (para cotas e relatórios) |
| `spend.sqlite` | Gasto em uso pago por dia e agente |
| `audit-trail.sqlite` | Trilha de auditoria das ações externas (sem conteúdo) |
| `outbox.sqlite` | Fila de envios (WhatsApp/e-mail esperando o canal voltar) |
| `whatsapp.sqlite` | Mensagens do WhatsApp lidas pelo agente |
| `idempotency.sqlite` | Respostas lembradas para chamadas repetidas da API |
| `julia.sqlite`, `semantic-cache.sqlite` | Decisões e cache do classificador |
| `scripts.sqlite` | Scripts que os agentes aprenderam |
| `coord.sqlite` | Trava entre processos que usam a mesma pasta |
| `artifacts/`, `shared/` | Artefatos e arquivos compartilhados |
| `sandbox/`, `tmp/` | Áreas de trabalho e temporários dos agentes |
| `backups/` | Cópias automáticas e manuais |
| `brand/` | Logo da marca personalizada |
| `auth.json`, `setup-code.txt` | Senha (só o hash) e código da primeira configuração |

Fora da pasta de dados, em `~/.ripper/`: `secret.key` (chave de cifragem) e `claude-accounts/` (uma pasta de login por conta do Claude).

Ferramentas de inspeção: `npm run data:info`, `npm run data:clear-usage` e `npm run data:clear-julia`.

---

## Configuração por variáveis de ambiente

Quase tudo se configura pela interface. As variáveis abaixo servem para servidor, rede, testes e integrações.

### Servidor e rede

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP |
| `HOST` | `127.0.0.1` | Interface de escuta. Qualquer valor que exponha na rede exige `RIPPER_TOKEN` |
| `RIPPER_TOKEN` | — | Token de acesso à API (Bearer ou cookie). Obrigatório com `HOST` aberto |
| `RIPPER_DATA` | `./data/` | Pasta de dados |
| `RIPPER_CORS_ORIGIN` | — | Origens permitidas para a interface em outro host (separadas por vírgula, ex.: `http://localhost:5173`) |
| `RIPPER_MAX_BODY_BYTES` | `1048576` | Tamanho máximo do corpo das requisições (acima disso, 413) |
| `RIPPER_HTTP_TIMEOUT_MS` | `120000` | Tempo máximo das requisições comuns (o chat ao vivo não entra) |
| `RIPPER_SSE_TIMEOUT_MS` | `0` | Limite opcional da resposta ao vivo do chat (0 = sem limite) |
| `RIPPER_IDEMPOTENCY_TTL_MS` | `86400000` | Por quanto tempo lembrar chamadas com `Idempotency-Key` |
| `RIPPER_SHUTDOWN_MS` | `10000` | Tempo para drenar conexões ao encerrar |
| `RIPPER_DRAIN_TURNS_MS` | `120000` | Tempo para esperar respostas em andamento antes de reiniciar |
| `RIPPER_METRICS_PUBLIC` | — | `1` libera `/metrics` sem token (para o Prometheus) |
| `RIPPER_STRICT` / `NODE_ENV=production` | — | Erros de configuração encerram o servidor em vez de só avisar |
| `RIPPER_LOG_JSON` | — | `1` = logs em JSON estruturado |
| `RIPPER_MODES` | — | `1` religa a separação modo Simples × Enterprise (os testes rodam assim) |
| `RIPPER_ENTERPRISE_MODE` | — | Com `RIPPER_MODES=1`, `1` força o modo Enterprise |
| `RIPPER_SECRET_KEY_FILE` | `~/.ripper/secret.key` | Onde fica a chave de cifragem local |
| `RIPPER_VAULT_KEY` | — | Chave explícita do cofre de credenciais |
| `RIPPER_SUPERVISED` | (o vigia define) | Indica que o servidor roda sob o serviço; atualizações reiniciam sozinhas |

### Limites e proteção

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `RIPPER_RATE_ENABLED` | — | `1` liga o limite de taxa (sobrepõe as Configurações) |
| `RIPPER_RATE_CHAT_PER_MINUTE` | (Configurações) | Máximo de mensagens de chat por janela, por token e por IP |
| `RIPPER_RATE_API_PER_MINUTE` | (Configurações) | Máximo de chamadas pesadas (backup, restauração, exportação) por janela |
| `RIPPER_RATE_WINDOW_MS` | `60000` | Duração da janela |
| `RIPPER_CB_FAILURES` | `5` | Falhas seguidas de um provedor de IA até abrir o disjuntor (usa outro modelo ou falha rápido) |
| `RIPPER_CB_COOLDOWN_MS` | `30000` | Tempo do disjuntor aberto |
| `RIPPER_LIMIT_5H_CHARS`, `RIPPER_LIMIT_WEEK_CHARS` | — | Cotas locais do Ripper (não são as do provedor) |
| `RIPPER_CLOUD_CREDITS_USD`, `RIPPER_CLOUD_CREDITS_USED` | — | Créditos na nuvem para o painel de uso |
| `RIPPER_PLAN_NAME` | — | Rótulo do plano no painel (não altera cobrança) |

### Computador dos agentes e sandbox

| Variável | Efeito |
| --- | --- |
| `RIPPER_SANDBOX_ENABLED` | Liga o sandbox Docker para comandos do modo pasta local |
| `RIPPER_SANDBOX_IMAGE`, `RIPPER_SANDBOX_NETWORK`, `RIPPER_SANDBOX_MEMORY`, `RIPPER_SANDBOX_CPUS`, `RIPPER_SANDBOX_TIMEOUT_SECONDS` | Imagem, rede, memória, CPUs e tempo máximo do sandbox |
| `BOAT_API_KEY`, `BOAT_API_URL` | VM na nuvem do boat.dev |

### Integrações

| Variável | Efeito |
| --- | --- |
| `GOOGLE_TASKS_CLIENT_ID`, `GOOGLE_TASKS_CLIENT_SECRET` | OAuth do Google Tasks ([docs/task-sync-google.md](docs/task-sync-google.md)) |
| `RIPPER_OAUTH_CLIENT_ID` | Identificador do cliente OAuth publicado para conectores MCP |
| `OPENAI_BASE_URL`, `GEMINI_BASE_URL` | Endereço alternativo para provedores compatíveis com a API da OpenAI |
| `RIPPER_MCP_BRIDGE_URL`, `RIPPER_MCP_BRIDGE_TOKEN` | Ponte das ferramentas do Ripper para o Codex (definidas automaticamente) |

### Testes e diagnóstico

| Variável | Efeito |
| --- | --- |
| `RIPPER_TEST_PROVIDER` | Provedor de IA falso: `stream`, `slow`, `fail`, `ask`, `setting`, `team` (não gasta conta) |
| `JULIA_AUTOSTART` | `0` não sobe o classificador Julia automaticamente |
| `RIPPER_NO_PREWARM`, `RIPPER_DEBUG_PREWARM` | Desliga ou registra o pré-aquecimento dos processos do Claude |
| `RIPPER_RETENTION_STARTUP_DELAY_MS`, `RIPPER_RETENTION_INTERVAL_MS` | Quando a limpeza por retenção roda |
| `RIPPER_OUTBOX_TICK_MS` | Intervalo da fila de envios |
| `RIPPER_CHAOS_ALLOW_PROD` | Permite os testes de caos em produção (não use) |
| `GITHUB_API_URL`, `WHATSAPP_GRAPH_URL`, `EVOLUTION_URL` | Endereços falsos usados pelos testes |
| `RIPPER_URL` | Endereço do Ripper para `scripts/agent-audit.mjs` |

Na subida, `lib/boot-lint.mjs` confere as variáveis críticas: em desenvolvimento, só avisa; com `NODE_ENV=production` ou `RIPPER_STRICT=1`, encerra com código 1 se algo estiver errado.

---

## Operação: saúde, métricas e logs

| Endereço | Para quê |
| --- | --- |
| `GET /healthz` | Está vivo? (sem token) |
| `GET /readyz` | Pronto para receber tráfego? (pasta de dados acessível) |
| `GET /api/health` | Saúde pela API (com autenticação) |
| `GET /api/health/detalhado` | Painel de saúde completo (o mesmo da janela Saúde) |
| `GET /api/diagnostics` | Contagens reais, arquivos de dados, Julia, Docker, Codex e disjuntores |
| `GET /metrics` | Métricas no formato Prometheus (requisições, turnos, uptime) |
| `GET /openapi.json`, `GET /docs` | Especificação e documentação da API |

Ao receber `SIGTERM`, o servidor para de aceitar conexões novas, responde 503 em `/api/*`, espera as respostas em andamento, grava o estado e fecha os bancos. Guia de implantação com Docker/Compose e checagem de saúde: [docs/instalacao.md](docs/instalacao.md).

---

## Arquitetura

```
navegador (React 19 + Vite, web/src) ──HTTP/SSE──▶ server.mjs (Node 22, node:http, sem framework)
                                                     │
                                                     ├─ lib/store.mjs ............ estado em data/db.json (+ SQLite auxiliares)
                                                     ├─ lib/providers.mjs ........ Claude (Agent SDK), Codex (CLI), OpenRouter/OpenAI/Gemini/Ollama
                                                     ├─ lib/ripper-builtin-tools.mjs  ferramentas que os agentes usam (MCP)
                                                     ├─ lib/docker.mjs / boat.mjs  computador do agente (docker/agent)
                                                     ├─ lib/mcp-*.mjs ............ conectores MCP (HTTP/stdio) e OAuth
                                                     └─ canais: whatsapp, evolution (QR), email, github, webhooks
julia/serve.py (opcional) ── classificador local; sem ele, regras de reserva
```

- **Servidor:** um único processo Node; as rotas são uma lista `[método, regex, handler]` em `server.mjs`. Sem Express nem banco externo.
- **Estado:** `db.json` gravado de forma atômica, com trava entre processos; uso, auditoria, fila, cache e idempotência em SQLite (`node:sqlite`).
- **Turno de conversa:** `turn()` monta o contexto (memórias, ferramentas, conectores), chama o provedor e transmite por SSE. Turnos cortados são retomados na subida (`lib/chat-run.mjs`).
- **Ferramentas:** catálogo com esquema `zod` em `lib/ripper-builtin-tools.mjs`. Para o Claude vira um servidor MCP no mesmo processo; para o Codex, um MCP stdio que fala com o servidor por HTTP.
- **Aprovações:** toda ação externa passa pela Caixa e é registrada em `lib/external-actions.mjs`.
- **Interface:** `web/src/app.jsx` é a raiz; `npm run build` gera `dist/`, servido pelo próprio servidor.
- **Serviço e vigia:** `scripts/service.mjs` instala o serviço do sistema e reinicia o servidor se ele cair (código 75 = reiniciar para atualizar).

Mais detalhes em [docs/desenvolvimento.md](docs/desenvolvimento.md).

---

## Estrutura de pastas

| Pasta / arquivo | O que tem |
| --- | --- |
| `server.mjs` | Servidor HTTP, rotas e o motor de turnos |
| `lib/` | Módulos do servidor: estado, provedores, ferramentas, canais, segurança, backup, atualização… |
| `web/` | Interface (React + Vite): `web/src/app.jsx`, `pages/`, componentes, estilos e textos (`i18n/`) |
| `test/` | Testes (`node --test`), com `helpers/` para subir servidores isolados |
| `scripts/` | Serviço, instalador e desinstalador, senha, dados, auditoria de capacidades, teste das telas |
| `docker/agent/` | Imagem do computador dos agentes (Chromium, noVNC, Node, Python) |
| `skills/` | Skills internas (manifesto, arquiteto multiagente, auditor X9, economia de tokens) |
| `julia/` | Classificador opcional Julia 1 (Python) |
| `docs/` | Roadmap, instalação, desenvolvimento, segurança, privacidade, termos e capacidades |
| `PRODUCT.md` | Para quem é o produto, o que ele resolve e os princípios |
| `.github/workflows/ci.yml` | CI: testes, build e teste das telas a cada push e pull request |

---

## Desenvolvimento

```bash
npm ci
npm run dev:server   # servidor com recarga (node --watch)
npm run dev:web      # interface com recarga (Vite); a API continua no dev:server
```

Para conversar sem gastar conta de IA: `RIPPER_TEST_PROVIDER=stream npm run dev:server`.

### Scripts npm

| Comando | O que faz |
| --- | --- |
| `npm start` | Sobe o servidor (`node server.mjs`) |
| `npm run build` | Monta a interface em `dist/` |
| `npm run prod` | Build + servidor |
| `npm test` | Todos os testes (com `RIPPER_MODES=1`, cobrindo os dois modos) |
| `npm run test:ui` | Abre todas as telas num navegador de verdade (Playwright) e falha em erro de JavaScript |
| `npm run dev:server` / `npm run dev:web` | Desenvolvimento com recarga |
| `npm run julia` / `npm run julia:dry` | Classificador Julia (real / sem pesos) |
| `npm run data:info`, `data:clear-usage`, `data:clear-julia` | Inspecionar e limpar dados locais |

Outros scripts: `node scripts/agent-audit.mjs` (auditoria de capacidades com tarefas reais, resultado em [docs/capacidades.md](docs/capacidades.md)), `node scripts/senha.mjs` (nova senha) e `node scripts/service.mjs install|uninstall|status|restart|run`.

### Testes

- **660+ testes** de unidade e integração. Os testes de integração sobem o servidor isolado, com pasta de dados temporária e provedor falso.
- Cada servidor de teste reserva a própria porta (`test/helpers/free-port.mjs`), então os testes podem rodar em paralelo sem colidir.
- Máquina sobrecarregada? `npm test -- --test-concurrency=3` é mais estável. Rode sempre pelo `npm test`: ele liga `RIPPER_MODES=1`, que alguns testes exigem.
- O **CI** (GitHub Actions) roda testes, build e o teste das telas a cada push e pull request. A `main` exige `test-and-build` verde para juntar um pull request.

---

## Como contribuir

1. Crie um branch a partir da `main` (`claude/…`, `feat/…`).
2. Faça a mudança com testes. Interface em **português simples**, sem termos técnicos para quem não programa.
3. **Rode todos os testes e só envie se passarem.**
4. Abra um pull request explicando, para quem nunca viu o código: o antes e o depois do ponto de vista de quem usa, o que mudou por dentro e por que essa abordagem.
5. Ligue o **merge automático**: o pull request entra sozinho quando o CI passar.

Regras de design (estrutura, cores, interação, o que conferir antes de entregar): [docs/ROADMAP.md › Como fazer o design](docs/ROADMAP.md). Regras de engenharia para agentes: [docs/manifesto-ripper.md](docs/manifesto-ripper.md). Checklist de versão: [docs/release.md](docs/release.md).

Agentes que trabalham no código do Ripper devem usar uma **cópia própria** do repositório (`/work/repos`), nunca trocar o branch da pasta onde o servidor roda.

---

## Julia 1 (classificador opcional)

O Ripper funciona **sem** ela. Com a [Julia 1](https://huggingface.co/SupersonicLabs/Julia-1) no ar, o Ripper Auto e outras decisões rápidas (risco de comando, notificações de rotina, quem fala em grupo) usam um modelo local em vez de regras simples.

```bash
python3 -m pip install -r julia/requirements.txt
python3 -c "from huggingface_hub import snapshot_download; snapshot_download('SupersonicLabs/Julia-1', local_dir='julia/Julia-1')"
python3 -m pip install -e julia/Julia-1
npm run julia            # http://127.0.0.1:8765
```

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `JULIA_MODEL` | `SupersonicLabs/Julia-1` | Modelo no Hugging Face |
| `JULIA_MODEL_PATH` | — | Caminho local dos pesos (~550 MiB, fora do Git) |
| `JULIA_PORT` | `8765` | Porta |
| `JULIA_DEVICE` | `cpu` | `cpu` ou `cuda` |

Fora do ar, o Ripper continua com as regras de reserva e avisa `[julia] fallback` no log. Para desenvolver sem baixar os pesos: `npm run julia:dry`.

---

## Solução de problemas

| O que aparece | O que fazer |
| --- | --- |
| `node` não é reconhecido | Instale o Node.js 22+ e abra o terminal de novo |
| A página não abre | Confira se o Ripper está rodando (`node scripts/service.mjs status`) e abra http://127.0.0.1:3000 |
| "porta em uso" / `EADDRINUSE` | Já tem um Ripper rodando (talvez como serviço); use esse ou pare com `node scripts/service.mjs uninstall` |
| O agente não responde | Refaça `claude login` (ou `codex login`); veja a janela **Saúde** no menu da conta |
| "Conta do Claude no limite" | Adicione outra conta em Provedores de IA e ligue a troca automática |
| Agente "sem computador" | Abra o Docker Desktop; em Configurações › Computador, escolha Docker |
| Esqueci a senha | `node scripts/senha.mjs` no computador do Ripper |
| A tela parece antiga depois de atualizar | Recarregue com `Ctrl Shift R` |
| Celular não conecta fora de casa | Confira se o Tailscale está ligado nos dois aparelhos, com a mesma conta |

---

## Documentação

| Documento | Assunto |
| --- | --- |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Norte, comparação com o Grok, checklist de produção, fases e regras de design |
| [docs/instalacao.md](docs/instalacao.md) | Instalação detalhada, implantação e referência técnica |
| [docs/desenvolvimento.md](docs/desenvolvimento.md) | Arquitetura e guia para quem mexe no código |
| [docs/seguranca.md](docs/seguranca.md) | Modelo de segurança e permissões dos agentes |
| [docs/privacidade-e-dados.md](docs/privacidade-e-dados.md) | Dados locais, retenção e limpeza |
| [docs/termos-de-uso.md](docs/termos-de-uso.md), [docs/politica-de-privacidade.md](docs/politica-de-privacidade.md) | Termos e privacidade (rascunhos) |
| [docs/capacidades.md](docs/capacidades.md) | Última auditoria das capacidades dos agentes |
| [docs/task-sync-google.md](docs/task-sync-google.md) | Sincronização com o Google Tasks |
| [docs/release.md](docs/release.md) | Checklist antes de publicar uma versão |
| [docs/manifesto-ripper.md](docs/manifesto-ripper.md) | Leis de engenharia para os agentes |
| [docs/ENTREGUE.md](docs/ENTREGUE.md) | Histórico do que já foi entregue |
| [PRODUCT.md](PRODUCT.md) | Produto, públicos e princípios |

---

## Licença

Ainda não definida (item aberto no roadmap). Até lá, todos os direitos reservados aos autores.
