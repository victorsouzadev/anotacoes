#!/usr/bin/env bash
# Teste ponta a ponta contra um hub rodando.
# Uso: BASE=https://SUBDOMINIO/cerebro API_KEY=... MCP_TOKEN=... ./scripts/smoke-test.sh
# Local: BASE=http://localhost:5080 API_KEY=dev-celular MCP_TOKEN=dev-mcp ./scripts/smoke-test.sh
set -euo pipefail

BASE="${BASE:-http://localhost:5080}"
API_KEY="${API_KEY:?defina API_KEY}"
MCP_TOKEN="${MCP_TOKEN:?defina MCP_TOKEN}"
RUN_ID="smoke-$(date +%s)"
pass=0; fail=0

check() { # nome, condição
  if eval "$2"; then echo "  ok   $1"; pass=$((pass+1)); else echo "  FALHOU $1"; fail=$((fail+1)); fi
}

post_json() { curl -sS -o /tmp/smoke.out -w '%{http_code}' -X POST "$BASE$1" \
  -H "X-Api-Key: $API_KEY" -H 'Content-Type: application/json' -d "$2"; }

mcp() { curl -sS "$BASE/mcp" -H "Authorization: Bearer $MCP_TOKEN" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d "$1"; }

echo "== Saúde"
code=$(curl -sS -o /tmp/smoke.out -w '%{http_code}' "$BASE/health")
check "GET /health → 200" '[ "$code" = 200 ]'
cat /tmp/smoke.out; echo

echo "== Autenticação"
code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/captures" -H 'Content-Type: application/json' -d '{"content":"x"}')
check "sem chave → 401" '[ "$code" = 401 ]'
code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/mcp" -H 'Content-Type: application/json' -d '{}')
check "MCP sem token → 401" '[ "$code" = 401 ]'

echo "== Captura de texto e idempotência"
code=$(post_json /api/v1/captures "{\"content\":\"Ideia $RUN_ID: usar o hub para resumir reuniões\",\"external_id\":\"$RUN_ID\",\"tags\":[\"teste\"]}")
check "POST /captures → 202" '[ "$code" = 202 ]'
first=$(cat /tmp/smoke.out); echo "  $first"
code=$(post_json /api/v1/captures "{\"content\":\"repetido\",\"external_id\":\"$RUN_ID\"}")
check "mesmo external_id → 200 (duplicata)" '[ "$code" = 200 ] && grep -q "\"duplicate\":true" /tmp/smoke.out'

id=$(echo "$first" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
code=$(curl -sS -o /tmp/smoke.out -w '%{http_code}' "$BASE/api/v1/captures/$id" -H "X-Api-Key: $API_KEY")
check "GET /captures/{id} → 200" '[ "$code" = 200 ]'

echo "== Link, diário e arquivo"
code=$(post_json /api/v1/captures '{"url":"https://example.com","title":"Exemplo"}')
check "captura de link → 202" '[ "$code" = 202 ]'
code=$(post_json /api/v1/daily "{\"text\":\"smoke test $RUN_ID\"}")
check "POST /daily → 200" '[ "$code" = 200 ]'
printf 'arquivo de teste %s\n' "$RUN_ID" > /tmp/smoke.txt
code=$(curl -sS -o /tmp/smoke.out -w '%{http_code}' -X POST "$BASE/api/v1/captures/file" \
  -H "X-Api-Key: $API_KEY" -F "file=@/tmp/smoke.txt" -F "content=anexo de teste")
check "POST /captures/file → 202" '[ "$code" = 202 ]'
code=$(curl -sS -o /tmp/smoke.out -w '%{http_code}' -X POST "$BASE/api/v1/webhooks/teste" \
  -H "X-Api-Key: $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"data\":{\"key\":{\"id\":\"wh-$RUN_ID\"},\"message\":{\"text\":\"webhook $RUN_ID\"}}}")
check "POST /webhooks/teste → 202" '[ "$code" = 202 ]'

echo "== MCP"
sleep 3 # deixa o watcher indexar
out=$(mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}')
check "initialize" 'echo "$out" | grep -q serverInfo'
out=$(mcp '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')
for t in search read_note list_notes get_daily list_inbox capture create_note append_daily process_inbox_item; do
  check "tool $t listada" 'echo "$out" | grep -q "\"$t\""'
done
out=$(mcp "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"search\",\"arguments\":{\"query\":\"$RUN_ID\"}}}")
check "search acha a captura" 'echo "$out" | grep -q "00-Inbox"'
out=$(mcp '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"read_note","arguments":{"path":"../../etc/passwd"}}}')
check "read_note recusa sair do vault" '! echo "$out" | grep -q "root:"'

echo
echo "Resultado: $pass ok, $fail falhas"
[ "$fail" = 0 ]
