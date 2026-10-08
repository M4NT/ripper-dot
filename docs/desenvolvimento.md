# Desenvolvimento

Guia para quem vai mexer no código do Ripper. Instalação e variáveis de ambiente: [instalacao.md](instalacao.md). Dados e privacidade: [privacidade-e-dados.md](privacidade-e-dados.md). Regras de engenharia: [manifesto-ripper.md](manifesto-ripper.md).

## Arquitetura em uma página

```
navegador (React, web/src)  ──HTTP/SSE──▶  server.mjs (Node 22, sem framework)
                                              │
                                              ├─ lib/store.mjs ........ estado em data/db.json (+ SQLite auxiliares)
                                              ├─ lib/providers.mjs .... Claude (Agent SDK) e Codex (CLI codex exec)
                                              ├─ lib/ripper-builtin-tools.mjs  ferramentas que os agentes usam
                                              ├─ lib/docker.mjs / boat.mjs ... computador do agente (docker/agent)
                                              ├─ lib/mcp-*.mjs ........ conectores MCP (HTTP e stdio) e OAuth
                                              └─ canais: whatsapp.mjs (Cloud API), evolution.mjs (QR), email.mjs, github.mjs …
julia/serve.py (opcional) ── classificador local; sem ele, regras de reserva
```

- **Servidor** — `server.mjs` é um único processo Node com `node:http`. As rotas ficam na lista `routes` (`[método, regex, handler]`). Não há Express nem banco externo.
- **Estado** — `lib/store.mjs` carrega e grava `db.json` de forma atômica, com mutex entre processos (`coord.sqlite`). Uso, decisões da Julia, idempotência e a trilha de auditoria ficam em SQLite (`node:sqlite`) na mesma pasta `RIPPER_DATA`. Segredos de configuração são cifrados (`lib/local-secret.mjs`, `lib/connection-vault.mjs`).
- **Turno de conversa** — `turn()` / `turnInner()` em `server.mjs` monta o contexto do agente (memórias, ferramentas, conectores), chama o provedor (`lib/providers.mjs`, `lib/provider-turn.mjs`) e transmite a resposta por SSE (`lib/chat-stream.mjs`). Turnos interrompidos são retomados na subida (`lib/chat-run.mjs`).
- **Ferramentas dos agentes** — `lib/ripper-builtin-tools.mjs` define o catálogo (`RIPPER_TOOL_CATALOG`, com esquema `zod`). Para o Claude vira um servidor MCP no mesmo processo; para o Codex, um MCP stdio (`lib/ripper-mcp-stdio.mjs`) que fala com o servidor por HTTP (`lib/ripper-mcp-bridge.mjs`).
- **Aprovações** — ações que saem em nome do usuário passam por `askApproval()` (Caixa) e são registradas por `recordExternal()` em `lib/external-actions.mjs` (trilha sem conteúdo, `audit-trail.sqlite`).
- **Interface** — React 19 + Vite em `web/src` (`app.jsx` é a raiz). `npm run build` gera `dist/`, servido pelo próprio `server.mjs`.
- **Serviço** — `scripts/service.mjs` instala o Ripper como tarefa/serviço do sistema e tem um vigia (`run`) que reinicia o servidor com espera crescente se ele cair.
- **Computador do agente** — imagem em `docker/agent/` (Chromium + noVNC), gerenciada por `lib/docker.mjs`, `lib/boat.mjs` e `lib/sandbox-lifecycle.mjs`.

## Rodar em desenvolvimento

```sh
npm ci
npm run dev:server   # node --watch server.mjs
npm run dev:web      # Vite com recarga; API continua no dev:server
```

Para conversar sem gastar conta de IA, suba o servidor com `RIPPER_TEST_PROVIDER=stream` (provedor falso em `lib/test-provider.mjs`).

## Testes

| Comando | O que faz |
| --- | --- |
| `npm test` | Todos os testes de Node: `node --test test/*.test.mjs` |
| `node --test test/email.test.mjs` | Um arquivo só |
| `npm run test:ui` | Abre as telas num navegador de verdade (Playwright/Firefox) — `scripts/ui-smoke.mjs`; precisa de `npm run build` antes |

- Os testes usam só `node:test` e `node:assert`, sem framework.
- Testes que precisam do servidor sobem `server.mjs` como processo filho numa porta livre, com `RIPPER_DATA` numa pasta temporária, `RIPPER_TEST_PROVIDER` ligado e `JULIA_AUTOSTART=0` (veja `test/email.test.mjs` ou `test/server-http.test.mjs` como modelo). Nada depende de login no Claude/Codex, Docker ou Julia.
- Testes com vários processos usam `test/helpers/mp-worker.mjs`.
- O CI (`.github/workflows`) roda `npm ci`, `npm test`, `npm run build` e `npm run test:ui` a cada push na `main` e em cada PR.
- Conhecido: alguns testes que sobem o servidor podem estourar o tempo em máquina carregada (ROADMAP, seção E).

## Como criar uma integração

Há três caminhos, do mais simples ao mais profundo. Prefira o primeiro que resolver.

### 1. Conector MCP (sem mexer no código)

Se o serviço já tem um servidor MCP, cadastre em **Conectores**: tipo **HTTP** (URL `https://`, cabeçalhos ou OAuth) ou **stdio** (comando local). A validação e a redação de segredos estão em `lib/mcp-connectors.mjs`; OAuth em `lib/mcp-oauth.mjs`; teste de conexão em `lib/mcp-probe.mjs`. As ferramentas do conector ficam disponíveis para os agentes que o usam.

### 2. Webhook de publicação

Para só *mandar* texto a um canal (Slack incoming webhook, HTTP genérico): **Conectores → Webhooks sociais** (`lib/social-webhooks.mjs`). O agente usa `post_social` / `send_webhook`, com aprovação.

### 3. Integração nativa (código)

Siga o padrão de e-mail (`lib/email.mjs`) ou GitHub (`lib/github.mjs`):

1. **Módulo em `lib/`** com funções puras: normalizar a configuração, mascarar segredos na API (`••••`), dizer se está pronta (ex.: `emailReady`) e falar com o serviço externo.
2. **Configuração** — guarde em `db.settings.<nome>`; segredos passam pela cifragem de `lib/local-secret.mjs` e devem ser mascarados nas respostas da API (veja `redactSettingsSecrets` em `lib/mcp-connectors.mjs`).
3. **Rotas** — adicione entradas na lista `routes` de `server.mjs` (salvar configuração, testar conexão).
4. **Ferramentas** — em `lib/ripper-builtin-tools.mjs`:
   - descreva cada ferramenta em `RIPPER_TOOL_CATALOG` (descrição + `inputSchema` com `zod`);
   - ligue-a em `enabledToolNames()` quando o contexto existir (ex.: `if (ctx.email) names.push(...)`);
   - execute em `makeExecute()` chamando o contexto (ex.: `case 'email_send': ... ctx.email.send(a)`).
5. **Contexto do turno** — em `turnInner()` (`server.mjs`), monte o objeto (`email: emailReady(s.email) ? { list, read, send } : null`). Toda ação que sai em nome do usuário deve pedir aprovação (`askApproval`) e chamar `recordExternal()`; se for um tipo novo, acrescente em `EXTERNAL_KINDS` (`lib/external-actions.mjs`).
6. **Tela** — formulário em `web/src` (Conectores/Configurações), em PT-BR simples.
7. **Teste** — um `test/<nome>.test.mjs` cobrindo pelo menos: segredo mascarado na API, configuração incompleta não fica "pronta" e o envio pede aprovação. Use um servidor HTTP falso local para o serviço externo (como `WHATSAPP_GRAPH_URL` / `EVOLUTION_URL` fazem).

**Exemplo completo: Omie ERP** (API direta, uma empresa por chave). `lib/omie.mjs` tem o cliente HTTP (`omieCall`, com REDUNDANT), o catálogo `OMIE_CAPS` (uma linha por capacidade: método, caminho, leitura ou escrita, risco e pré-checagem), o executor `createOmieRunner` e o cofre (`omieAddCompany`, `omieCredentials`). O contexto do turno está em `server.mjs` (`omie:`), as rotas em `/api/omie`, a tela em `web/src/marketplace/OmiePanel.jsx`. Nos testes, `OMIE_API_URL` aponta para um servidor falso (`test/omie.test.mjs`). Para uma capacidade nova, acrescente uma linha em `OMIE_CAPS`; a ferramenta, a aprovação e o bloqueio em modo somente leitura saem sozinhos. Antes de usar em produção, confira o método e o caminho de cada linha na documentação oficial do Omie.

Canais que recebem mensagens de fora (WhatsApp) rodam o agente **sem** computador, navegador e plugins, e só respondem contatos permitidos — mantenha essas travas em integrações novas desse tipo (`lib/evolution.mjs`, `lib/whatsapp.mjs`).

## Outros pontos úteis

- `npm run data:info` — onde estão os dados e o tamanho de cada arquivo.
- `GET /api/diagnostics` — estado real de agentes, Docker, Codex, Julia.
- Validação de variáveis na subida: `lib/boot-lint.mjs`.
- Antes de uma versão: [release.md](release.md).
