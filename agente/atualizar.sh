#!/usr/bin/env bash
# Ponte Local — atualiza o agent.js COM VALIDAÇÃO e rollback (v1.11.0)
# Baixa direto do relay, confere com node --check e só então substitui.
# uso: bash atualizar.sh [URL-DO-RELAY]
#      sem argumento, usa o server salvo no ponte.config.json local
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

SRC="${1:-}"
if [ -z "$SRC" ] && [ -f "$DIR/ponte.config.json" ]; then
  # v1.18.0: o caminho era interpolado no codigo JS — um $HOME com aspas
  # quebrava o comando (e o SRC ficava vazio, sem erro claro)
  SRC=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).server||'')}catch(e){}" "$DIR/ponte.config.json" 2>/dev/null || true)
fi
[ -n "$SRC" ] || { echo "[x] uso: bash atualizar.sh URL-DO-RELAY (ex.: https://seu-relay)"; exit 1; }
SRC="${SRC%/}"

DEST=""
for cand in "$DIR" "$HOME/ponte-agent" "$HOME/Downloads/ponte-agent" "$HOME/Documentos/ponte-agent" "$HOME/Desktop/ponte-agent"; do
  if [ -f "$cand/agent.js" ]; then DEST="$cand"; break; fi
done
[ -n "$DEST" ] || { echo "[x] agent.js não encontrado (nem em $DIR nem nos caminhos padrão)"; exit 1; }

# v1.18.0: o mktemp sem extensao quebrava o node --check (ERR_UNKNOWN_FILE_
# EXTENSION) — o update NUNCA trocava o agente. O nome precisa terminar em .js
TMP="$(mktemp --suffix=.js 2>/dev/null || mktemp).js"
trap 'rm -f "$TMP"' EXIT
echo "[*] baixando agente de: $SRC/api/ponte/download"
curl -fsSL "$SRC/api/ponte/download" -o "$TMP" || { echo "[x] download falhou — versão atual INTACTA"; exit 1; }
node --check "$TMP" || { echo "[x] agent.js baixado é inválido (node --check falhou) — NADA foi trocado"; exit 1; }

if [ -f "$DEST/agent.js" ]; then
  cp "$DEST/agent.js" "$DEST/agent.js.bak"
fi
mv -f "$TMP" "$DEST/agent.js"
# v1.18.0: o mktemp nasce 0600 e o mv mantem — o agent.js perdia o bit de
# execucao (o rodar.sh o chamava por "node", mas o uso direto "./agent.js"
# deixava de funcionar)
chmod 755 "$DEST/agent.js" 2>/dev/null || true
chmod 600 "$DEST/ponte.config.json" 2>/dev/null || true

NOVA=$(node -e "try{console.log(require(process.argv[1]).VERSION)}catch(e){console.log('?')}" "$DEST/agent.js" 2>/dev/null || echo "?")
echo ""
echo "[✓] Agente atualizado: v$NOVA em $DEST"
echo "    Backup da anterior: agent.js.bak (rollback: cp agent.js.bak agent.js)"
echo ""
echo "PROXIMO PASSO — reinicie o agente no modo que preferir:"
echo "  1) Ctrl+C no terminal onde o agente está rodando"
echo "  2) escolha um dos modos:"
echo "       node \"$DEST/agent.js\"                    # arquivos apenas (padrão)"
echo "       node \"$DEST/agent.js\" --allow-run --save  # supervisionado (aperta s/N)"
echo "       node \"$DEST/agent.js\" --auto --save       # autônomo (com trava anticatástrofe)"
