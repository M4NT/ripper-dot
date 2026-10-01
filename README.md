# Ripper

Aplicação local para criar agentes de IA, conversar individualmente ou em grupo, organizar projetos e executar rotinas.

## Requisitos

- Node.js 22 ou superior
- `claude login` para usar a assinatura Claude, ou uma chave de API configurada na aplicação
- `codex login` para usar o Codex

## Claude e Codex: ferramentas Ripper

Os agentes usam o mesmo conjunto de **ferramentas builtin** do Ripper (`remember`, `schedule_routine`, navegador, computador, artefatos, skills, `send_message`) quando o modelo e as permissões do agente permitem:

| Capacidade | Claude (Agent SDK) | Codex (CLI `codex exec`) |
| --- | --- | --- |
| Ferramentas Ripper | MCP in-process `ripper` | MCP stdio `ripper` (ponte HTTP com o servidor Ripper) |
| Plugins MCP stdio | Sim | Sim (`-c mcp_servers.*`) |
| Plugins MCP HTTP | Sim | Sim (URL no config efêmero) |
| WebSearch / WebFetch | Sim (ferramenta `web` do agente) | Não — use plugins MCP ou o Codex nativo |
| Conectores Claude Code (`useConnectors`) | Sim | Não |
| Shell no sandbox do Codex | — | Sim (`command_execution` no JSON); distinto do `computer_exec` Ripper em Docker/Boat |

As definições e a lista de ferramentas permitidas são compartilhadas em `lib/ripper-builtin-tools.mjs` (`claudeAllowedTools` / spawn do Codex).

## Executar

```sh
npm install
npm run build
npm start
```

Guia completo de instalação, variáveis de ambiente e modos dev/prod: **[docs/instalacao.md](docs/instalacao.md)**.

Acesse `http://127.0.0.1:3000`. Para desenvolvimento, rode `npm run dev:server` e `npm run dev:web` em terminais separados.

## Julia 1 (classificador opcional)

O Ripper funciona **sem** o sidecar Julia. Com ele no ar, o modo **Ripper Auto** e outras decisões rápidas (risco de comando, notificações de rotina, quem fala em grupo) usam o modelo [SupersonicLabs/Julia-1](https://huggingface.co/SupersonicLabs/Julia-1) em vez de só heurísticas.

### Instalação (uma vez)

Requer **Python 3.11+**.

```sh
python3 -m pip install -r julia/requirements.txt
python3 -c "from huggingface_hub import snapshot_download; snapshot_download('SupersonicLabs/Julia-1', local_dir='julia/Julia-1')"
python3 -m pip install -e julia/Julia-1
```

O download dos pesos (~550 MiB) fica em `julia/Julia-1/` (ignorado pelo Git).

### Subir o sidecar

```sh
npm run julia
```

Por padrão escuta em `http://127.0.0.1:8765`. Variáveis úteis:

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `JULIA_MODEL` | `SupersonicLabs/Julia-1` | Id no Hugging Face (validado na subida) |
| `JULIA_MODEL_PATH` | — | Caminho local (ex.: `julia/Julia-1`) em vez do id remoto |
| `JULIA_PORT` | `8765` | Porta HTTP |
| `JULIA_DEVICE` | `cpu` | `cpu` ou `cuda` |

Para desenvolver sem baixar pesos: `npm run julia:dry` (respostas uniformes; só `/health` e contrato HTTP).

Se o modelo ou o pacote Python estiver mal configurado, `julia/serve.py` **encerra na subida** com mensagem clara (não fica um processo “morto”).

### Quando a Julia está fora do ar

- O Ripper **continua**; roteamento automático, risco e notificações usam **regras de reserva** (palavras-chave e tamanho do texto).
- O servidor registra avisos `[julia] fallback: <motivo>` no terminal.
- Em **Configurações → Modelos**, o selo mostra “fora do ar”; `GET /api/julia/status` devolve `{ online, url, reason }`.

Confira o endereço em Configurações (padrão `http://127.0.0.1:8765`) se mudou a porta.

## Testes

```sh
npm test
```

Os testes da Julia usam mocks HTTP — não exigem PyTorch nem download do Hugging Face.

Os testes E2E do chat (`test/chat-sse.test.mjs`) sobem o servidor com `RIPPER_TEST_PROVIDER` para simular o stream SSE sem chamar Claude/Codex.

## Uso, contexto e cotas (sem números fictícios)

O painel de uso no chat mostra **somente** o que o Ripper mede ou o que você configurar no servidor:

| Sinal | Disponível? |
| --- | --- |
| Caracteres/tokens estimados por conversa (mensagens, prompt do agente, conectores MCP) | Sim — estimativa local (~4 chars/token) |
| Respostas por modelo (`recordUsage`) | Sim |
| Fatura Console Admin (sk-ant-admin) | **Não** — é billing de org/API, não barras Pro/Max do chat |
| Barras Pro/Max (5 h / semanal) com login Claude Code | **Sim** — leitura via `GET /api/oauth/usage` (mesmo fluxo do Claude Code; **não documentado**, cache ~3 min) e/ou Agent SDK após cada resposta Claude |
| Barras “5 h / semanal” locais Ripper | Só se você definir `RIPPER_LIMIT_5H_CHARS` e/ou `RIPPER_LIMIT_WEEK_CHARS` (cotas **Ripper**, não do provedor) |
| Modo chave de API Anthropic | Uso local + erros 429; painel avisa que barras Pro/Max exigem login (`claude login`) |
| Créditos na nuvem | Só se `RIPPER_CLOUD_CREDITS_USD` estiver definido; `RIPPER_CLOUD_CREDITS_USED` opcional |
| Bloqueio por cota do provedor | Quando a API devolve rate limit/429; o último evento aparece no painel (`db.usage.providers`) |

Variáveis opcionais: `RIPPER_PLAN_NAME` (rótulo, não altera fatura), `RIPPER_CLOUD_CREDITS_*`, `RIPPER_LIMIT_*`.

### Uso Pro/Max (assinatura Claude Code)

- **Estável o suficiente para UI:** erros de rate limit nas respostas, contadores locais do Ripper, janela de contexto medida no chat.
- **Frágil / não oficial:** endpoint OAuth `api.anthropic.com/api/oauth/usage` (header `anthropic-beta: oauth-2025-04-20`), leitura somente de `~/.claude/.credentials.json` ou `CLAUDE_CODE_OAUTH_TOKEN`; o Ripper **não** grava nem renova tokens.
- **Headers** `anthropic-ratelimit-unified-*` são persistidos quando aparecem em respostas HTTP capturadas.
- **Agent SDK:** após cada turno Claude em modo assinatura, o Ripper tenta `usage_EXPERIMENTAL_*` (pode mudar entre versões do SDK).

Os dados locais ficam em `data/` (ou em `RIPPER_DATA`), que não é enviado ao Git. O estado principal continua em `db.json`; eventos de uso (`recordUsage`) vão para `usage.sqlite` no mesmo diretório (até ~800 eventos, para cotas locais 5 h/semanal sem inflar o JSON). Decisões do classificador Julia ficam em `julia.sqlite` (mesmo limite). Detalhes, retenção e limpeza opt-in: **[docs/privacidade-e-dados.md](docs/privacidade-e-dados.md)**. Checklist antes de taguear release: **[docs/release.md](docs/release.md)**.

Ao expor o servidor na rede, configure `RIPPER_TOKEN`. O modo de comandos locais exige ativação explícita em Integrações.
