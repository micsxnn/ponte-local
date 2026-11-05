#!/usr/bin/env bash
# Teste ponta a ponta da Ponte Local — simula o PC do usuário dentro da VM
set -e
AGENT_TOKEN="${PONTE_TEST_TOKEN:?export PONTE_TEST_TOKEN antes (lane test do relay)}"
ADMIN_TOKEN="${PONTE_ADMIN_TOKEN:?export PONTE_ADMIN_TOKEN antes (o mesmo do relay)}"
BASE="http://127.0.0.1:3000"
AGENT_DIR="$(cd "$(dirname "$0")/.." && pwd)/agente"
TEST_HOME="/tmp/ponte-teste-home"

echo "=== 1. Home falsa com arquivos de teste ==="
rm -rf "$TEST_HOME"
mkdir -p "$TEST_HOME/Downloads" "$TEST_HOME/Documentos"
echo "relatorio fiscal 2024" > "$TEST_HOME/Downloads/imposto-2024.pdf"
echo "conteudo da nota" > "$TEST_HOME/Downloads/nota.txt"
head -c 50000 /dev/urandom > "$TEST_HOME/Downloads/foto-viagem.jpg"
head -c 120000 /dev/urandom > "$TEST_HOME/Downloads/programa-instalar.zip"
head -c 30000 /dev/urandom > "$TEST_HOME/Downloads/musica-favorita.mp3"
head -c 20000 /dev/urandom > "$TEST_HOME/Downloads/video-aniversario.mp4"
echo "lista de compras: arroz, feijao" > "$TEST_HOME/Documentos/compras.md"
ls "$TEST_HOME/Downloads"

echo "=== 2. Sobe agente de teste (simula o PC do usuário) ==="
pkill -f "node agent.js" 2>/dev/null || true
cd "$AGENT_DIR"
nohup node agent.js --server "$BASE" --token "$AGENT_TOKEN" --home "$TEST_HOME" --auto > /tmp/agent-teste.log 2>&1 &
AGENT_PID=$!
echo "agente PID $AGENT_PID — aguardando 4s para o primeiro poll..."
sleep 4
tail -6 /tmp/agent-teste.log

cmd() { curl -s -X POST "$BASE/api/ponte/cmd" -H "x-ponte-admin: $ADMIN_TOKEN" -H "content-type: application/json" \
    -d "$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); d['lane']='test'; print(json.dumps(d))" "$1")"; }

wait_result() {
  # $1 = id do comando · $2 = "ok" (padrão) | "fail" — o teste FALHA se o
  # resultado não vier ou vier com o ok errado (v1.11.0 — antes timeout e
  # erro passavam em falso)
  local ID="$1" ESPERADO="${2:-ok}" ENCONTRADO=""
  for i in $(seq 1 20); do
    R=$(curl -s "$BASE/api/ponte/results?since=0&lane=test" -H "x-ponte-admin: $ADMIN_TOKEN")
    ENCONTRADO=$(echo "$R" | python3 -c "
import sys, json
d = json.load(sys.stdin)
rs = [r for r in d['results'] if r['id'] == $ID]
print(json.dumps(rs[0], ensure_ascii=False)[:1200] if rs else '')" 2>/dev/null)
    if [ -n "$ENCONTRADO" ]; then
      echo "$ENCONTRADO"
      echo "$ENCONTRADO" | python3 -c "
import sys, json
r = json.load(sys.stdin)
ok = bool(r.get('ok'))
quer = ('$ESPERADO' == 'ok')
sys.exit(0 if ok == quer else 1)" || { echo "❌ comando $ID veio com ok != $ESPERADO"; return 1; }
      return 0
    fi
    sleep 1.5
  done
  echo "❌ TIMEOUT aguardando resultado do comando $ID"
  return 1
}

NEWID() { python3 -c "import sys,json;print(json.load(sys.stdin)['id'])"; }

echo "=== 3. ping ==="
ID=$(cmd '{"action":"ping"}' | NEWID)
wait_result "$ID" ok || exit 1

echo "=== 4. list Downloads ==="
ID=$(cmd "{\"action\":\"list\",\"args\":{\"path\":\"$TEST_HOME/Downloads\"}}" | NEWID)
wait_result "$ID" ok || exit 1

echo "=== 5. organize_plan Downloads ==="
ID=$(cmd "{\"action\":\"organize_plan\",\"args\":{\"path\":\"$TEST_HOME/Downloads\"}}" | NEWID)
wait_result "$ID" ok || exit 1

echo "=== 6. apply_plan ==="
PLAN=$(curl -s "$BASE/api/ponte/results?since=0&lane=test" -H "x-ponte-admin: $ADMIN_TOKEN" | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = [x for x in d['results'] if x['ok'] and isinstance(x.get('data'), dict) and 'plano' in x['data']][-1]
print(json.dumps({'action':'apply_plan','lane':'test','args':{'plan': r['data']['plano']}}))")
ID=$(curl -s -X POST "$BASE/api/ponte/cmd" -H "x-ponte-admin: $ADMIN_TOKEN" -H "content-type: application/json" -d "$PLAN" | NEWID)
wait_result "$ID" ok || exit 1
echo "--- Downloads depois do plano:"
ls -R "$TEST_HOME/Downloads"

echo "=== 7. delete (vai pra lixeira) ==="
ID=$(cmd "{\"action\":\"delete\",\"args\":{\"paths\":[\"$TEST_HOME/Downloads/Documentos/imposto-2024.pdf\"]}}" | NEWID)
wait_result "$ID" ok || exit 1
echo "--- lixeira:"
ls "$TEST_HOME/.local/share/Trash/files" 2>/dev/null

echo "=== 8. undo_last (restaura da lixeira) ==="
ID=$(cmd '{"action":"undo_last"}' | NEWID)
wait_result "$ID" ok || exit 1
echo "--- imposto voltou?"
ls "$TEST_HOME/Downloads/Documentos/" 2>/dev/null

echo "=== 9. busca por nome ==="
ID=$(cmd "{\"action\":\"search\",\"args\":{\"path\":\"$TEST_HOME\",\"query\":\"imposto\",\"mode\":\"name\"}}" | NEWID)
wait_result "$ID" ok || exit 1

echo "=== 10. teste de escopo (deve FALHAR — asserção de verdade agora) ==="
ID=$(cmd '{"action":"list","args":{"path":"/etc"}}' | NEWID)
RES=$(wait_result "$ID" fail) || exit 1
echo "$RES" | rg -q "escopo" && echo "✓ escopo segurou (/etc recusado)" || { echo "❌ falhou, mas sem falar de escopo: $RES"; exit 1; }

echo "=== 11. trava anticatástrofe (run_command catastrófico deve ser BLOQUEADO) ==="
ID=$(cmd '{"action":"run_command","args":{"command":"echo oi && rm -rf /"}}' | NEWID)
RES=$(wait_result "$ID" fail) || exit 1
echo "$RES" | rg -q "catastr|rm" && echo "✓ trava segurou (&& + rm -rf / bloqueado)" || { echo "❌ bypass da trava: $RES"; exit 1; }

echo "=== FIM DOS TESTES ==="
kill $AGENT_PID 2>/dev/null || true
