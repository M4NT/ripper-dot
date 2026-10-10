# Instalação e primeiro uso

A primeira parte deste guia é para quem **não é da área técnica**. A segunda parte (a partir de "Referência técnica") é para quem vai configurar servidor, rede ou contribuir com o código.

> Hoje ainda **não existe instalador** (aquele arquivo que se clica duas vezes). A instalação usa alguns comandos digitados no terminal. São poucos, e basta copiar e colar. Um instalador para Windows e Mac está no plano.

## Parte 1 — Passo a passo

### O que você precisa

- Um computador com Windows, Mac ou Linux, ligado à internet.
- Uma conta de IA: **assinatura do Claude** (Pro, Max ou Teams), **ChatGPT** (para o Codex) ou uma **chave de API** da Anthropic.
- Uns 20 minutos.

Leia antes os [termos de uso](termos-de-uso.md) e a [política de privacidade](politica-de-privacidade.md) (rascunhos), principalmente se for usar a conta da empresa ou atender clientes.

### 1. Instale o Node.js

O Ripper funciona em cima do Node.js (versão 22 ou mais nova).

1. Entre em https://nodejs.org e baixe a versão **LTS**.
2. Instale clicando em "Próximo" até o fim.
3. Para conferir: abra o **Terminal** (no Windows, procure por "PowerShell" no menu Iniciar) e digite `node -v`. Deve aparecer algo como `v22...` ou maior.

### 2. Baixe o Ripper

Se você recebeu o Ripper como arquivo `.zip`, descompacte numa pasta fácil de achar (por exemplo, Documentos\ripper). Se tem o Git instalado, pode baixar com:

```sh
git clone https://github.com/M4NT/ripper-dot.git
```

### 3. Prepare o Ripper (só na primeira vez)

No terminal, entre na pasta do Ripper e rode os dois comandos abaixo, um de cada vez. O primeiro baixa as peças que o Ripper usa; o segundo monta a tela.

```sh
cd caminho/da/pasta/ripper
npm ci
npm run build
```

Pode demorar alguns minutos. Avisos em amarelo são normais; só se preocupe se terminar com "ERR!".

### 4. Entre na sua conta de IA

- **Claude por assinatura:** instale o Claude Code (https://claude.com/claude-code) e rode `claude login` no terminal. Vai abrir o navegador para você entrar na sua conta.
- **ChatGPT / Codex:** instale o Codex e rode `codex login`.
- **Chave de API:** pule este passo; você cola a chave dentro do Ripper, em Configurações → Modelos (essa tela aparece no modo Enterprise: Configurações → Aparência).

### 5. Abra o Ripper

```sh
npm start
```

Deixe essa janela do terminal aberta e entre no navegador em **http://127.0.0.1:3000**.

### 6. Faça o Ripper abrir sozinho com o computador (recomendado)

Assim você não precisa repetir o passo 5 e, se o Ripper cair, ele volta sozinho:

```sh
node scripts/service.mjs install
```

- Para ver se está ativo: `node scripts/service.mjs status`
- Para desfazer: `node scripts/service.mjs uninstall`

No Windows isso cria uma tarefa que roda quando você entra na sua conta; no Mac e no Linux, um serviço do usuário. Depois de instalar, não rode `npm start` ao mesmo tempo (os dois tentariam usar a mesma porta).

### 7. Primeiros passos dentro do app

Ao abrir uma conversa vazia, o Ripper mostra uma lista curta de **Primeiros passos**:

1. **Conectar um modelo** — confirma que a conta de IA do passo 4 está funcionando.
2. **Escolher quais IAs usar** (modo Enterprise) — quais modelos ficam ligados e o limite de esforço de cada um.
3. **Criar um agente** — dê um nome e diga em uma frase o que ele faz.
4. **Enviar uma mensagem** — peça algo simples para testar.

Quando um agente quiser fazer algo em seu nome fora do computador (mandar WhatsApp, e-mail, publicar), o pedido aparece na **Caixa** para você aprovar ou recusar.

### Opcional

- **Docker** (https://www.docker.com/products/docker-desktop): dá a cada agente um "computador próprio" para rodar programas e navegar. Sem ele o Ripper funciona, mas os agentes não usam esse computador. O WhatsApp por QR Code também precisa do Docker.
- **WhatsApp e e-mail:** em Conectores. Antes de atender clientes, leia a seção sobre WhatsApp nos [termos de uso](termos-de-uso.md).

### Deu problema?

| O que aparece | O que fazer |
| --- | --- |
| `node` não é reconhecido | O Node.js não foi instalado ou o terminal foi aberto antes. Feche e abra o terminal de novo. |
| A página não abre | Confira se o terminal do `npm start` está aberto, ou rode `node scripts/service.mjs status`. |
| "porta em uso" / `EADDRINUSE` | Já tem um Ripper rodando (talvez como serviço). Use o que já está aberto. |
| O agente não responde | Refaça o `claude login` (ou `codex login`) e tente de novo. |

Seus dados ficam na pasta `data` dentro da pasta do Ripper. Para levar para outro computador ou guardar uma cópia, use Configurações → Backup ou copie essa pasta com o Ripper fechado.

---

## Parte 2 — Referência técnica

Esta parte descreve o que o repositório oferece hoje: scripts npm em `package.json`, servidor Node e front-end Vite. Não há pacote publicado no npm registry — o Ripper roda a partir do clone do repositório. Arquitetura e testes: [desenvolvimento.md](desenvolvimento.md).

## Requisitos

| Componente | Obrigatório? | Versão / notas |
| --- | --- | --- |
| Node.js | Sim | `>= 22` (`engines` em `package.json`; o CI usa a mesma versão) |
| npm | Sim | Vem com o Node; use `npm ci` em ambientes limpos |
| Claude / Codex | Para conversar com modelos | `claude login` e/ou `codex login` na máquina onde o Ripper roda, **ou** chave de API Anthropic nas Configurações |
| Docker | Opcional | Necessário para sandboxes de agente (modo Boat/Docker em Integrações) |
| Python 3.11+ | Opcional | Só para o sidecar Julia (`julia/requirements.txt`) |

## Instalação (primeira vez)

**Windows, sem terminal:** dois cliques em `scripts\instalar-windows.cmd`. Ele instala o Node 22 pelo winget se faltar, roda `npm ci` e `npm run build`, cria o serviço (`scripts/service.mjs install`) e abre `http://127.0.0.1:3000`. Na primeira entrada, um assistente pergunta qual conta de IA usar, detecta o Docker e cria o primeiro agente a partir de uma frase.

**Mac, sem terminal:** dois cliques em `scripts/instalar-mac.command` (na primeira vez, botão direito → Abrir). Ele instala o Node 22+ pelo Homebrew ou pelo instalador oficial (pede a senha do Mac), roda `npm ci` e `npm run build`, cria o serviço (launchd) e abre `http://127.0.0.1:3000`. Para desinstalar mantendo os dados: `scripts/desinstalar-mac.command`.

**Sem Docker:** o Ripper funciona em "modo sem computador": os agentes conversam, pesquisam na web e lembram, mas não rodam comandos, não abrem navegador nem criam arquivos. Para ligar depois: abra o Docker Desktop e escolha Docker em Configurações → Computador.

Manual:

No diretório raiz do repositório:

```sh
git clone https://github.com/M4NT/ripper-dot.git
cd ripper-dot
npm ci
npm run build
```

- `npm ci` instala dependências exatamente como `package-lock.json` (recomendado para CI e releases).
- `npm run build` gera o front-end estático em `dist/` (servido por `server.mjs`).

## Executar em produção local

```sh
npm start
```

Equivalente explícito: `node server.mjs`. O atalho `npm run prod` faz `vite build && node server.mjs` num único comando.

Abra `http://127.0.0.1:3000` (porta padrão). Variáveis úteis:

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP |
| `HOST` | `127.0.0.1` | Interface de escuta; valores diferentes de localhost exigem `RIPPER_TOKEN` |
| `RIPPER_TOKEN` | (vazio) | Bearer/cookie para `/api/*`; **obrigatório** se `HOST` expõe na rede |
| `RIPPER_DATA` | `./data/` relativo ao repo | Pasta de estado local (ver [privacidade-e-dados.md](./privacidade-e-dados.md)) |
| `RIPPER_SHUTDOWN_MS` | `10000` | Tempo máximo (ms) para drenar conexões HTTP após `SIGTERM`/`SIGINT` antes de encerrar à força |
| `RIPPER_RATE_ENABLED` | (vazio) | `1`/`true` ativa limite de taxa (sobrescreve Configurações) |
| `RIPPER_RATE_CHAT_PER_MINUTE` | (settings) | Máximo de `POST /api/chat` por janela, por token e por IP |
| `RIPPER_RATE_API_PER_MINUTE` | (settings) | Máximo de backup/restore, export de metering e APIs pesadas por janela |
| `RIPPER_RATE_WINDOW_MS` | `60000` | Duração da janela em ms (contadores só na memória deste processo) |
| `RIPPER_METRICS_PUBLIC` | (vazio) | Se `1`, `GET /metrics` fica acessível sem token (scrape Prometheus/K8s); padrão segue o mesmo auth de `/api/*` |
| `RIPPER_MAX_BODY_BYTES` | `1048576` (1 MiB) | Rejeita corpos JSON/API maiores com HTTP 413 (antes de parsear o JSON) |
| `RIPPER_HTTP_TIMEOUT_MS` | `120000` | Encerra requisições HTTP comuns ociosas ou presas (408); não se aplica ao stream SSE do chat |
| `RIPPER_SSE_TIMEOUT_MS` | `0` (sem limite) | Orçamento opcional só para `POST /api/chat`; `0` mantém o SSE aberto pelo tempo necessário |
| `RIPPER_IDEMPOTENCY_TTL_MS` | `86400000` (24 h) | Tempo em ms para lembrar respostas de requisições com header `Idempotency-Key` (SQLite `idempotency.sqlite`) |

Em Docker/Kubernetes o orquestrador envia `SIGTERM` ao parar o container. O servidor deixa de aceitar conexões novas, responde **503** em rotas `/api/*` enquanto drena requisições em andamento, persiste `db.json` e fecha os SQLite de uso/Julia/coordenação/idempotência.

Com token definido, acesse a UI com `?token=<segredo>` ou envie `Authorization: Bearer <segredo>`.

### Healthcheck (Docker / Compose / Kubernetes)

- **Liveness** — `GET /healthz` → `200` e `{ "ok": true, "version", "uptimeSeconds" }` (sem token).
- **Readiness** — `GET /readyz` → `200` se `RIPPER_DATA` estiver legível/gravável; `503` se o volume ou `db.json` estiver inacessível.
- A rota autenticada `GET /api/health` permanece para checagens da API com o mesmo payload.

Exemplo de `healthcheck` no Compose (ajuste `PORT` se necessário):

```yaml
healthcheck:
  test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3000/healthz | grep -q '\"ok\":true'"]
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 15s
```

### Idempotency-Key (API)

Rotas mutáveis selecionadas aceitam o header opcional **`Idempotency-Key`** (`[A-Za-z0-9_-]{8,128}`), escopado por `RIPPER_TOKEN` + rota + chave. Hoje: **`POST /api/chat`**.

- Mesma chave **e** mesmo corpo (hash SHA-256 do JSON bruto): o servidor **repete a resposta gravada** (`Idempotency-Replayed: true`), sem reexecutar o turno (não dispara novo turno de chat, circuit breaker ou métricas de turno).
- Mesma chave com corpo diferente: **409**.
- **SSE:** a entrada só é finalizada quando o stream termina (`done`); o replay reenvia o SSE completo gravado (não há streaming “ao vivo” na repetição).
- Requisição idempotente ainda em andamento: **409** (tente de novo em instantes).
- **Ordem no servidor:** `attachRequestId` → métricas HTTP → `attachHttpTimeout` / `rejectOversizeBody` (#73) → rate limit → handler (idempotência só dentro de `POST /api/chat`, após o 413 por `Content-Length`).

Persistência em `idempotency.sqlite` no mesmo `RIPPER_DATA` (WAL, compatível com vários processos). Só memória/process-local seria insuficiente para reinícios — por isso usamos SQLite como `usage.sqlite`.

## Desenvolvimento

Dois terminais (hot reload):

```sh
npm run dev:server   # node --watch server.mjs
npm run dev:web      # vite (proxy para o API)
```

Em dev web, o Vite serve o front; o API continua no processo `dev:server`. Rebuild manual do `dist/` não é necessário enquanto usar `dev:web`.

## Julia (opcional)

Resumo; detalhes no [README](../README.md#julia-1-classificador-opcional):

```sh
python3 -m pip install -r julia/requirements.txt
# download do modelo (uma vez) — ver README
npm run julia        # sidecar em http://127.0.0.1:8765
npm run julia:dry    # sem pesos; só contrato HTTP
```

O Ripper **funciona sem** Julia; decisões automáticas usam heurísticas de reserva.

## Imagem Docker do agente

Referência em `docker/agent/` (Chromium + noVNC). Usada quando o computador do agente roda em container; **não** substitui instalar o Ripper na máquina host.

```sh
docker build -t ripper-agent docker/agent
```

O servidor Ripper constrói/usa essa imagem conforme Configurações → Computador (modo Boat/Docker).

## Testes

```sh
npm test
```

Roda `node --test test/*.test.mjs`. Não exige Julia, PyTorch nem login Claude/Codex (testes usam `RIPPER_TEST_PROVIDER` e diretórios temporários via `RIPPER_DATA`).

## Staging reproduzível

O staging vive no repositório (não depende do branch `ripper/staging` nem de um `scripts/staging.sh` local). Sobe o Ripper com **dados de exemplo**, **provedor de teste** (`RIPPER_TEST_PROVIDER=stream`, sem gastar conta de IA) e **pasta/volume persistente** — reiniciar o processo ou o contêiner não apaga agentes, memórias nem rotinas.

```sh
node scripts/staging.mjs up          # Docker Compose se houver; senão, Node local
node scripts/staging.mjs status
node scripts/staging.mjs smoke       # npm run smoke contra o staging
node scripts/staging.mjs restart     # derruba e sobe de novo; os dados ficam
node scripts/staging.mjs down        # para; os dados ficam
RIPPER_ENV=staging node scripts/staging.mjs reset   # apaga só o staging e semeia de novo
```

Atalho npm: `npm run staging -- up` (o `--` passa o comando). Sem Docker: `node scripts/staging.mjs up --local`.

O script **não lê** `RIPPER_DATA`, `RIPPER_TOKEN`, `HOST` nem `PORT` de produção. Só `RIPPER_STAGING_*`. `reset` e `seed --force` exigem `RIPPER_ENV=staging` e a pasta `data/staging` (ou o marcador `.ripper-staging`). Sem isso o comando recusa — não apaga a instalação real.

A porta do Compose é `127.0.0.1:3010` (não escuta na LAN). O token **não tem padrão fixo**: o primeiro `up` gera um `RIPPER_STAGING_TOKEN` em `deploy/staging/.env` (fora do Git). O Compose exige `${RIPPER_STAGING_TOKEN:?…}`.

| | Padrão | Onde mudar |
| --- | --- | --- |
| URL | http://127.0.0.1:3010 | `RIPPER_STAGING_PORT` ou `RIPPER_STAGING_URL` |
| Token | gerado no primeiro `up` | `RIPPER_STAGING_TOKEN` |
| Senha da UI | `staging-ok-8` | `RIPPER_STAGING_PASSWORD` |
| Provedor | `stream` (`lib/test-provider.mjs`) | `RIPPER_STAGING_PROVIDER` |
| Dados (local) | `data/staging/` | `RIPPER_STAGING_DATA` |
| Dados (Docker) | volume `ripper-staging-data` → `/data` | `RIPPER_ENV=staging node scripts/staging.mjs reset` |

Depois do `up`, o próprio comando imprime o token. Abra `http://127.0.0.1:3010/?token=<token>` ou entre com a senha. O seed traz dois agentes (Assistente e Relator), uma memória e uma rotina — o fluxo de grupo do smoke precisa de um segundo agente.

Arquivos:

| Caminho | Função |
| --- | --- |
| `deploy/staging/docker-compose.yml` | Serviço, healthcheck, volume, `RIPPER_TEST_PROVIDER` |
| `deploy/staging/Dockerfile` | Imagem do servidor de staging (`CMD` = `staging.mjs serve`) |
| `deploy/staging/seed/db.json` | Dados de exemplo |
| `deploy/staging/.env.example` | Copie para `.env` na mesma pasta se quiser trocar token/porta |
| `scripts/staging.mjs` | `up` / `down` / `restart` / `smoke` / `seed` / `reset` / `serve` |

O `smoke` contra o staging envia só `RIPPER_URL` / `RIPPER_TOKEN` / `RIPPER_PASSWORD` do staging e `SMOKE_TEST_PROVIDER=1` — sem herdar chaves de produção — para os fluxos de chat/aprovação/grupo rodarem no provedor falso.

Isto **não** é a imagem dos agentes (`docker/agent/`) nem um empacotamento de produção. É o ambiente fixo para conferir que o Ripper volta depois de um reinício e que o smoke diário passa.

## O que não está incluído

- Instalador `.deb`/`.msi` ou imagem Docker “all-in-one” de produção do servidor Ripper (o Compose em `deploy/staging/` é só staging com provedor de teste).
- Publicação no npm (`"private": true` em `package.json`).
- Provisionamento automático de TLS/reverse proxy — use nginx/Caddy na sua infra se expor além de localhost.

Para empacotar um release, siga [release.md](./release.md).
