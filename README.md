# Ripper

Aplicação local para criar agentes de IA, conversar individualmente ou em grupo, organizar projetos e executar rotinas.

## Requisitos

- Node.js 22 ou superior
- `claude login` para usar a assinatura Claude, ou uma chave de API configurada na aplicação
- `codex login` para usar o Codex

## Executar

```sh
npm install
npm run build
npm start
```

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

Os dados locais ficam em `data/`, que não é enviado ao Git. Ao expor o servidor na rede, configure `RIPPER_TOKEN`. O modo de comandos locais exige ativação explícita em Integrações.
