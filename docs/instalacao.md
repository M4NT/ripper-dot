# Instalação e execução

Este guia descreve o que o repositório **realmente** oferece hoje: scripts npm em `package.json`, servidor Node e front-end Vite. Não há pacote publicado no npm registry — o Ripper roda a partir do clone do repositório.

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

## O que não está incluído

- Instalador `.deb`/`.msi` ou imagem Docker “all-in-one” do servidor Ripper.
- Publicação no npm (`"private": true` em `package.json`).
- Provisionamento automático de TLS/reverse proxy — use nginx/Caddy na sua infra se expor além de localhost.

Para empacotar um release, siga [release.md](./release.md).
