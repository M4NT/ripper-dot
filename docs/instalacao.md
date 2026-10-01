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

Com token definido, acesse a UI com `?token=<segredo>` ou envie `Authorization: Bearer <segredo>`.

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
