#!/usr/bin/env bash
# Ponte Local — inicia o agente
# Primeira vez: ./rodar.sh https://SEU-LINK-DE-PREVIEW SEU_TOKEN
# Depois:       ./rodar.sh
#
# Funciona nas duas formas de instalação:
#  - manual: agent.js nesta pasta (usa "node agent.js")
#  - npx:   usa "npx ponte-local" (baixa o pacote na hora)
set -u
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[x] Node.js não encontrado. Instale com: sudo pacman -S --needed nodejs"
  exit 1
fi

# pasta de DADOS do usuário (config, log, relatório, skill) — a mesma que
# o agente usa; fora do pacote, porque o cache do npx é efêmero
DATA_DIR="${PONTE_HOME:-$HOME/ponte-agent}"
CONFIG="$DATA_DIR/ponte.config.json"

# o executável: agent.js local se existir, senão npx
if [ -f agent.js ]; then
  AGENTE=(node agent.js)
  MODO="manual (agent.js nesta pasta)"
else
  AGENTE=(npx --yes ponte-local)
  MODO="npx (pacote baixado do npm)"
fi

if [ $# -ge 2 ]; then
  # args na linha SEMPRE vencem a config antiga (v1.11.0 — antes trocar
  # de relay/token pelo rodar.sh era silenciosamente ignorado)
  exec "${AGENTE[@]}" --server "$1" --token "$2" --save
elif [ $# -eq 1 ]; then
  # v1.18.0: com SO a URL, a URL era silenciosamente ignorada (a config
  # antiga ganhava) — agora o token vem da config e a URL da linha
  if [ ! -f "$CONFIG" ]; then
    echo "Uso: ./rodar.sh https://SEU-LINK SEU_TOKEN"
    echo "(o link de preview e o token estão no chat)"
    exit 1
  fi
  TOKEN_CFG="$(node -e "try{console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).token||'')}catch(e){}" "$CONFIG" 2>/dev/null || true)"
  if [ -z "$TOKEN_CFG" ]; then
    echo "Uso: ./rodar.sh https://SEU-LINK SEU_TOKEN"
    exit 1
  fi
  exec "${AGENTE[@]}" --server "$1" --token "$TOKEN_CFG" --save
elif [ -f "$CONFIG" ]; then
  exec "${AGENTE[@]}"
else
  echo "Uso: ./rodar.sh https://SEU-LINK-DE-PREVIEW SEU_TOKEN"
  echo "(o link de preview e o token estão no chat)"
  echo ""
  echo "Ou, mais simples ainda:"
  echo "  npx ponte-local --server https://SEU-LINK-DE-PREVIEW --token SEU_TOKEN --save"
  echo ""
  echo "Modo de execução detectado: $MODO"
  exit 1
fi
