# Privacidade, retenção e dados locais

O Ripper é uma aplicação **local-first**: conversas, configurações e métricas de uso ficam na sua máquina (ou no volume que você apontar). Este documento descreve o que existe hoje — **sem** alegações de conformidade legal (LGPD/GDPR) além do que o software efetivamente faz.

## O Ripper não envia telemetria de produto

Não há SDK de analytics, crash reporter ou beacon para servidores do projeto Ripper. Tráfego de rede relevante:

- **Você** para provedores de modelo (Anthropic, OpenAI/Codex, etc.) quando usa chat.
- **Você** para servidores MCP, OAuth e integrações que configurar.
- **Opcional**: sidecar Julia baixa/consulta modelos Hugging Face na instalação que **você** executou.
- Leitura **somente leitura** de credenciais Claude Code locais (`~/.claude/.credentials.json` ou `CLAUDE_CODE_OAUTH_TOKEN`) para barras Pro/Max — o Ripper não grava nem renova esses tokens (ver README).

## Onde ficam os dados (`RIPPER_DATA`)

| Situação | Caminho |
| --- | --- |
| Padrão (clone do repo) | `./data/` na raiz do repositório (ignorado pelo Git) |
| Produção / volume | Diretório absoluto em `RIPPER_DATA` |

Todos os processos Ripper que compartilham o mesmo diretório devem usar o **mesmo** `RIPPER_DATA` (mutex via `coord.sqlite`).

### Arquivos e pastas conhecidos

| Caminho (relativo a `RIPPER_DATA`) | Conteúdo |
| --- | --- |
| `db.json` | Estado principal: agentes, chats, mensagens, configurações, plugins (tokens OAuth podem estar aqui — trate como segredo) |
| `db.json.tmp` | Gravação atômica temporária |
| `db.pre-v2.backup.json` | Backup único ao migrar schema v1 → v2 |
| `usage.sqlite` (+ `-wal`, `-shm`) | Até **800** eventos recentes de uso (`recordUsage`); retenção automática por poda |
| `julia.sqlite` (+ `-wal`, `-shm`) | Até **800** decisões do classificador Julia (telemetria **local** para UI de limites) |
| `coord.sqlite` | Mutex entre processos Node |
| `idempotency.sqlite` (+ `-wal`, `-shm`) | Respostas cacheadas para `Idempotency-Key` (TTL `RIPPER_IDEMPOTENCY_TTL_MS`, padrão 24 h) |
| `connection-vault.json` | Credenciais globais de conectores **criptografadas** (AES-256-GCM; chave em `RIPPER_VAULT_KEY` ou derivada de `RIPPER_TOKEN`) |
| `sandbox/<agentId>/` | Arquivos e uploads do computador do agente |
| `shared/` | Compartilhado entre sandboxes Docker |
| Caminhos em `db.files` | Anexos referenciados pelo banco |

Credenciais Anthropic/OpenAI em Configurações ficam em `db.json` (não vão para o Git). Chaves de API Boat/Docker idem.

## Retenção automática

| Dado | Política implementada |
| --- | --- |
| Eventos de uso (`usage.sqlite`) | Ring buffer de no máximo `800` linhas (`USAGE_EVENTS_MAX` em `lib/usage-events.mjs`); entradas mais antigas são apagadas ao inserir novas |
| Decisões Julia (`julia.sqlite`) | Mesmo limite de `800` (`JULIA_EVENTS_MAX` em `lib/julia-events.mjs`) |
| Histórico de chat | Mantido em `db.json` até você apagar conversas/agentes na UI, editar/remover dados manualmente, ou **retenção TTL** (Configurações → Segurança) |
| Contadores `usage.byModel` | Persistidos em `db.json` (mesclados entre processos) |
| TTL configurável (`settings.retention` / `RIPPER_RETENTION_*`) | Job periódico no servidor (`lib/retention-ttl.mjs`): **hard-delete** de conversas, eventos de uso por idade, `auditLog` em `db.json`, artefatos e anexos órfãos. **Não** apaga linhas de `audit-trail.sqlite` (WORM), se existir |

Variáveis de ambiente opcionais: `RIPPER_RETENTION_ENABLED`, `RIPPER_RETENTION_CHAT_DAYS`, `RIPPER_RETENTION_USAGE_EVENTS_DAYS`, `RIPPER_RETENTION_AUDIT_DAYS`, `RIPPER_RETENTION_ARTIFACTS_DAYS`, `RIPPER_RETENTION_INTERVAL_MS`.

API autenticada: `GET/PUT /api/retention`, `POST /api/retention/run` (purga imediata).

## Controles opt-in (CLI)

Com o servidor Ripper **parado** (evita `SQLITE_BUSY`):

```sh
npm run data:info
npm run data:clear-usage -- --confirm
npm run data:clear-julia -- --confirm
```

- `data:info` — lista caminho resolvido de `RIPPER_DATA` e tamanhos de arquivos conhecidos.
- `clear-usage` / `clear-julia` — remove **todos** os eventos das tabelas SQLite correspondentes; **não** apaga chats nem `db.json`.

Para apagar **tudo** o estado local:

1. Pare o Ripper.
2. Remova o diretório `RIPPER_DATA` (ou `./data/`).
3. Na próxima subida, um banco vazio é criado (agente padrão incluído).

Faça backup copiando o diretório inteiro antes de apagar, ou use **Configurações → Backup** para gerar snapshots `.tar.gz` em `RIPPER_DATA/backups/` (manual ou agendado). **Restaurar um snapshot sobrescreve os dados vivos** no mesmo `RIPPER_DATA` (inclui `db.json`, SQLite e pastas `sandbox/`). Pare outros processos Ripper que compartilhem o diretório antes de restaurar.

## Exposição na rede

- `HOST` diferente de `127.0.0.1` / `localhost` exige `RIPPER_TOKEN`; APIs retornam 401 sem token válido.
- Cookies `ripper_token` e query `?token=` são suportados para a UI (ver `lib/auth.mjs`).
- Modo **comandos locais** no host (`allowLocalCommands`) fica **desligado** por padrão; ativação explícita em Integrações.

## Controles opt-in (LGPD)

Com **Segurança → LGPD** (ou `PUT /api/settings` com `lgpd.enabled`) você pode:

- Mascarar CPF, documentos, dados financeiros e contato por `[PII]` **antes** de enviar texto a Claude, Codex ou Julia 1 (`lib/lgpd-pii.mjs`, middleware em `lib/providers.mjs` e `lib/julia.mjs`). O histórico local em `db.json` **não** é alterado.
- Opcionalmente mascarar o mesmo padrão em avisos SSE e logs do servidor (`lgpd.redactInLogs`).

**Eliminação de dados (direito do titular):**

- `POST /api/lgpd/erasure` com `{ "confirm": true }` ou `"confirm": "ERASE"`. Corpo opcional `{ "scope": "profile" }` apaga só nome e instruções gerais; `"all"` (padrão) remove conversas, memórias, anexos, artefatos, fila inbox, aprovações, audit log local e zera telemetria SQLite de uso/Julia. Agentes, plugins e chaves de API **permanecem** — faça backup antes.
- `GET /api/lgpd/status` — estado das flags opt-in.

Testes: `test/lgpd-pii.test.mjs` e rotas em `test/server-http.test.mjs`.

## O que ainda não existe (planejado / fora de escopo)

- Exportação GDPR one-click ou criptografia at-rest de `db.json`.
- Anonimização automática de logs do servidor.
- Sincronização multi-dispositivo ou backup na nuvem pelo Ripper.

Se adicionarmos helpers ou políticas novas, este arquivo e os testes em `test/data-retention.test.mjs` e `test/retention-ttl.test.mjs` devem ser atualizados junto.
