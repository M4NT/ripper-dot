# Sincronização de tarefas (Google Tasks)

Ponte bidirecional entre registros internos (`taskDelegations` no `db.json`) e listas do **Google Tasks**.

## Configuração OAuth

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um projeto (ou use um existente).
2. Ative a **Google Tasks API**.
3. Em **Credenciais**, crie um **ID do cliente OAuth 2.0** do tipo *Aplicativo da Web*.
4. Adicione o URI de redirecionamento autorizado:
   - Desenvolvimento: `http://127.0.0.1:3000/api/task-sync/google/oauth/callback`
   - Produção: `https://<seu-host>/api/task-sync/google/oauth/callback` (mesma origem do Ripper)
5. Defina as variáveis de ambiente no servidor Ripper (recomendado):
   - `GOOGLE_TASKS_CLIENT_ID` — Client ID OAuth
   - `GOOGLE_TASKS_CLIENT_SECRET` — Client Secret (opcional para PKCE público, recomendado em servidor)
6. Alternativa: em **Configurações** via API (`PUT /api/settings`), envie `taskSync.google.clientId` / `clientSecret` (valores `••••` preservam o anterior).

Escopo solicitado: `https://www.googleapis.com/auth/tasks`.

## Conectar a conta

1. `POST /api/task-sync/google/oauth/start` (autenticado com `RIPPER_TOKEN`) → abra `authorizeUrl` no navegador.
2. Após consentimento, o callback grava tokens em `settings.taskSync.google.oauth`.
3. `GET /api/task-sync/status` → `auth.state` deve ser `ok`.

Renovação: tokens expirados com `refresh_token` são renovados automaticamente na sincronização (`POST /api/task-sync/sync`).

## API do bridge

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/task-sync/status` | Estado OAuth e lista padrão |
| GET | `/api/task-sync/tasks` | Registros internos |
| POST | `/api/task-sync/tasks` | Cria tarefa (`title`, opcional `pushToGoogle`) |
| PATCH | `/api/task-sync/tasks/:id` | Atualiza status/título; tenta push se autenticado |
| POST | `/api/task-sync/sync` | Pull/push em lote ou `recordId` + `direction` |

Corpo típico de sync em lote:

```json
{ "pull": true, "push": true, "importNew": false, "allRecords": true }
```

Sem OAuth configurado ou conectado, as rotas de sync respondem **401** com mensagem explícita (`NOT_AUTHENTICATED` / `NOT_CONFIGURED` nos testes e erros JSON).

## Modelo interno

Cada `taskDelegation` pode incluir:

- `status`: `open` \| `in_progress` \| `done` \| `cancelled`
- `delegation`: `{ fromAgentId, toAgentIds, originChatId }` — ligação opcional com handoff/inbox do runtime
- `external`: `{ provider: 'google_tasks', taskListId, taskId, etag, updated }`

Mapeamento Google: `needsAction` ↔ estados abertos; `completed` ↔ `done`.

## CI

Os testes (`test/task-sync-bridge.test.mjs`) usam cliente stub e fetch mockado — **não** exigem credenciais Google reais.
