#!/bin/bash
# Dois cliques para instalar o Ripper no Mac: traz o Node se faltar, prepara tudo, cria o serviço e abre o app.
# (Na primeira vez, o macOS pode pedir: clique com o botão direito → Abrir.)
set -e
cd "$(dirname "$0")/.."

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31mNão deu certo: %s\033[0m\n' "$1"; read -r -p "Aperte Enter para fechar."; exit 1; }
node_major() { command -v node >/dev/null 2>&1 && node -v | sed -E 's/^v([0-9]+).*/\1/' || echo 0; }

step "Verificando o Node.js"
if [ "$(node_major)" -lt 22 ]; then
  if command -v brew >/dev/null 2>&1; then
    step "Instalando o Node.js (Homebrew)"
    brew install node || fail "o Homebrew não conseguiu instalar o Node."
  else
    step "Baixando o instalador oficial do Node.js"
    pkg="/tmp/node-ripper.pkg"
    ver="$(curl -fsSL https://nodejs.org/dist/index.json | grep -o '"version":"v2[2-9][^"]*"' | head -1 | cut -d'"' -f4)"
    [ -n "$ver" ] || fail "não consegui descobrir a versão do Node. Instale em https://nodejs.org e rode de novo."
    curl -fsSL "https://nodejs.org/dist/$ver/node-$ver.pkg" -o "$pkg" || fail "não consegui baixar o Node."
    echo "O macOS vai pedir a sua senha para instalar o Node."
    sudo installer -pkg "$pkg" -target / || fail "a instalação do Node foi cancelada."
    rm -f "$pkg"
  fi
  export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
  [ "$(node_major)" -ge 22 ] || fail "o Node foi instalado, mas não apareceu. Feche esta janela e rode de novo."
fi
echo "Node $(node -v)"

step "Instalando dependências"
npm ci || fail "npm ci falhou."

step "Montando o app"
npm run build || fail "npm run build falhou."

step "Criando o serviço (sobe com o Mac)"
node scripts/service.mjs install || fail "não consegui criar o serviço."

url="http://127.0.0.1:${PORT:-3000}"
step "Abrindo $url"
for _ in $(seq 1 30); do curl -fs "$url/healthz" >/dev/null 2>&1 && break; sleep 1; done
open "$url"
printf '\n\033[32mPronto. O Ripper fica rodando em %s e volta sozinho quando o Mac liga.\033[0m\n' "$url"
read -r -p "Aperte Enter para fechar."
