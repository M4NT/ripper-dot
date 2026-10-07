#!/bin/bash
# Dois cliques para desinstalar o Ripper no Mac (seus dados ficam guardados).
cd "$(dirname "$0")/.."
node scripts/desinstalar.mjs "$@"
read -r -p "Aperte Enter para fechar."
