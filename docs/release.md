# Release e aceitação

Checklist alinhado aos scripts e ao CI atuais (`.github/workflows/ci.yml`). Item de roadmap **#47 (CI)** já está no `main`; este documento não duplica a configuração do workflow — apenas o que verificar antes de marcar uma versão.

## Versionamento

- Versão canônica hoje: campo `"version"` em `package.json` (atualmente `0.1.0`, pacote **privado**).
- Não há changelog automatizado no repositório; tags Git anotadas são a referência prática (`v0.1.0`, etc.).
- Ao taguear: atualize `package.json` se a versão mudou, commit, tagueie, push tag + branch.

## Scripts npm (referência)

| Script | Comando real | Uso |
| --- | --- | --- |
| `start` | `node server.mjs` | Servidor após `build` |
| `build` | `vite build` | Gera `dist/` |
| `prod` | `vite build && node server.mjs` | Build + servidor num passo |
| `test` | `node --test test/*.test.mjs` | Suite completa |
| `dev:server` | `node --watch server.mjs` | Desenvolvimento API |
| `dev:web` | `vite` | Desenvolvimento UI |
| `julia` / `julia:dry` | `python julia/serve.py` | Sidecar opcional |
| `data:info` | `node scripts/ripper-data.mjs info` | Inventário de `RIPPER_DATA` |
| `data:clear-usage` | `node scripts/ripper-data.mjs clear-usage --confirm` | Apaga eventos em `usage.sqlite` (opt-in) |
| `data:clear-julia` | `node scripts/ripper-data.mjs clear-julia --confirm` | Apaga eventos em `julia.sqlite` (opt-in) |

Artefato de deploy mínimo para uma máquina: clone/tag + `npm ci` + `npm run build` + processo supervisor rodando `npm start` (ou `npm run prod` se quiser rebuild garantido).

## Checklist automatizado (obrigatório antes de release)

Execute na raiz, com Node 22+:

```sh
npm ci
npm test
npm run build
```

Deve espelhar o job **test-and-build** do CI. Se qualquer passo falhar, não tagueie.

## Checklist manual — servidor

Com `dist/` já gerado:

1. **Subida limpa** — diretório de dados novo ou `RIPPER_DATA` temporário:
   ```sh
   RIPPER_DATA=/tmp/ripper-acceptance-$$ npm start
   ```
2. **Health** — `GET http://127.0.0.1:3000/api/health` retorna JSON (sem token se `HOST=127.0.0.1` e `RIPPER_TOKEN` vazio).
3. **UI** — abrir `/`, criar ou abrir um chat, enviar mensagem de teste.
4. **Provedor de teste** (sem Claude/Codex):
   ```sh
   RIPPER_DATA=/tmp/ripper-e2e-$$ RIPPER_TEST_PROVIDER=stream npm start
   ```
   Enviar mensagem no chat e confirmar stream SSE (mesma ideia que `test/chat-sse.test.mjs`).

## Checklist manual — autenticação e rede

Se o release for usado fora de localhost:

1. Definir `RIPPER_TOKEN` longo e imprevisível.
2. Definir `HOST=0.0.0.0` (ou interface desejada) **somente** com token; o servidor recusa subir sem token quando `HOST` não é local.
3. Confirmar acesso à UI com `?token=...` ou header Bearer.

## Checklist manual — integrações (opcional)

Marcar como “verificado neste release” só o que você testou:

| Área | Como verificar | Depende de |
| --- | --- | --- |
| Claude assinatura | Login `claude login`, chat com modelo Claude | Conta Anthropic |
| Claude API key | Chave em Configurações | Chave válida |
| Codex | `codex login`, chat com modelo OpenAI/Codex | Conta OpenAI |
| MCP OAuth | Conector com OAuth na UI (fluxo redirect) | Provedor MCP + browser |
| Julia | `npm run julia`, selo online em Configurações → Modelos | Python + modelo |
| Computador agente | Integrações → modo Docker/Boat, comando aprovado | Docker/Boat |

Falhas de OAuth ou de provedor **não** bloqueiam o release do core se o checklist automatizado e o smoke com `RIPPER_TEST_PROVIDER` passarem — documente limitações conhecidas na nota de release.

## Checklist manual — dados locais

1. Confirmar que `RIPPER_DATA` (ou `./data/`) cresce após uso ( `db.json`, `usage.sqlite`, sandboxes).
2. Opcional: `npm run data:info` com o Ripper **parado** para listar arquivos.
3. Ler [privacidade-e-dados.md](./privacidade-e-dados.md) antes de distribuir binários ou imagens com dados de exemplo.

## Empacotamento sugerido (sem inventar infra)

- **Tarball Git**: `git archive --format=tar.gz -o ripper-$VERSION.tar.gz HEAD`
- **Runtime**: Node 22 + `npm ci --omit=dev` **não** é suficiente hoje — o `build` usa Vite (devDependency); use `npm ci` completo + `npm run build`, ou mantenha `dist/` no artefato.
- **Persistência**: monte volume em `RIPPER_DATA`, não no diretório do clone (facilita upgrades).

## Pós-release

- Push da tag e anotação curta (o que mudou, breaking changes, integrações testadas).
- Abrir issue se regressão aparecer em ambiente não coberto pelos testes (OAuth real, Boat, etc.).
