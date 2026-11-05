#!/usr/bin/env bash
# Ponte Local — inicia o agente
# Primeira vez: ./rodar.sh https://SEU-LINK-DE-PREVIEW SEU_TOKEN
# Depois:       ./rodar.sh
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[x] Node.js não encontrado. Instale com: sudo pacman -S --needed nodejs"
  exit 1
fi

if [ $# -ge 2 ]; then
  # args na linha SEMPRE vencem a config antiga (v1.11.0 — antes trocar
  # de relay/token pelo rodar.sh era silenciosamente ignorado)
  exec node agent.js --server "$1" --token "$2" --save
elif [ -f ponte.config.json ]; then
  exec node agent.js
else
  echo "Uso: ./rodar.sh https://SEU-LINK-DE-PREVIEW SEU_TOKEN"
  echo "(o link de preview e o token estão no chat)"
  exit 1
fi
