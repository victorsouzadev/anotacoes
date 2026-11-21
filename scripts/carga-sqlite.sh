#!/bin/sh
# Teste de carga do banco compartilhado (spec 031, T010): 3 processos gravando ao mesmo tempo no mesmo SQLite,
# com WAL e busy_timeout=5000, como o núcleo e os plug-ins. Passa se nenhum receber "database is locked".
#   sh scripts/carga-sqlite.sh [arquivo] [gravações por processo]
# Sem arquivo, usa uma cópia temporária. Nunca rode contra o notas.db de produção: use uma cópia.
set -eu

BANCO="${1:-}"
N="${2:-300}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
[ -n "$BANCO" ] || BANCO="$TMP/carga.db"

sqlite3 "$BANCO" "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS carga_teste (id INTEGER PRIMARY KEY, processo TEXT, n INTEGER, em TEXT);" >/dev/null

gravar() {
  i=1
  while [ "$i" -le "$N" ]; do
    # Uma transação curta por gravação, como uma requisição da API.
    if ! sqlite3 -cmd ".timeout 5000" "$BANCO" "BEGIN IMMEDIATE; INSERT INTO carga_teste (processo, n, em) VALUES ('$1', $i, datetime('now')); COMMIT;" 2>>"$TMP/erros-$1"; then
      echo x >> "$TMP/falhas-$1"
    fi
    i=$((i + 1))
  done
}

INICIO=$(date +%s)
for p in nucleo dieta tarefas; do gravar "$p" & done
wait
DURACAO=$(( $(date +%s) - INICIO ))

TOTAL=$(sqlite3 "$BANCO" "SELECT count(*) FROM carga_teste")
TRAVADO=$(cat "$TMP"/erros-* 2>/dev/null | grep -c -i "locked\|busy" || true)
echo "gravações: $TOTAL de $((N * 3)) em ${DURACAO}s; database is locked: $TRAVADO"
sqlite3 "$BANCO" "DROP TABLE carga_teste" >/dev/null
if [ "$TRAVADO" -gt 0 ] || [ "$TOTAL" -ne $((N * 3)) ]; then exit 1; fi
echo "ok: nenhum SQLITE_BUSY"
