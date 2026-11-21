#!/bin/sh
# shellcheck disable=SC2034  # CONFIG e afins são lidos pelas funções de backup-comum.sh

# Testes dos scripts de backup (specs 025 e 036). Rodam em pasta temporária; não precisam de restic nem de rede.
#   sh scripts/tests/backup.test.sh
set -eu

RAIZ=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FALHAS=0

ok()    { echo "ok   - $1"; }
falha() { echo "FALHA - $1"; FALHAS=$((FALHAS + 1)); }
confere() { if [ "$2" = "$3" ]; then ok "$1"; else falha "$1 (esperado '$3', veio '$2')"; fi; }

export BASE_DIR="$TMP/base" NOTAS_BACKUP_ESTADO="$TMP/base/data/db/backup-externo.json"
mkdir -p "$BASE_DIR/backups/estudio-2026-10-25" "$BASE_DIR/data/db"
# shellcheck source=/dev/null
. "$RAIZ/backup-comum.sh"

# ---- limpeza só dos arquivos do script ----
velho() { touch "$1" && touch -d '20 days ago' "$1"; }
velho "$BACKUPS/notas-20260101-0400.db"
velho "$BACKUPS/site-loja-20260101-0400.db"
velho "$BACKUPS/pg-site_loja-20260101-0400.dump"
velho "$BACKUPS/estudio-2026-10-25/video.mp4"
velho "$BACKUPS/outra-coisa.tar"
velho "$BACKUPS/plugin-cerebro-20260101-0400.tar.gz"
touch "$BACKUPS/notas-20261120-0400.db"

limpar_backups "$BACKUPS" 14

if [ ! -e "$BACKUPS/notas-20260101-0400.db" ]; then ok "apaga notas-* antigo"; else falha "apaga notas-* antigo"; fi
if [ ! -e "$BACKUPS/site-loja-20260101-0400.db" ]; then ok "apaga site-* antigo"; else falha "apaga site-* antigo"; fi
if [ ! -e "$BACKUPS/pg-site_loja-20260101-0400.dump" ]; then ok "apaga pg-* antigo"; else falha "apaga pg-* antigo"; fi
if [ ! -e "$BACKUPS/plugin-cerebro-20260101-0400.tar.gz" ]; then ok "apaga plugin-* antigo"; else falha "apaga plugin-* antigo"; fi
if [ -e "$BACKUPS/notas-20261120-0400.db" ]; then ok "mantém notas-* recente"; else falha "mantém notas-* recente"; fi
if [ -e "$BACKUPS/estudio-2026-10-25/video.mp4" ]; then ok "não entra em subpastas"; else falha "não entra em subpastas"; fi
if [ -e "$BACKUPS/outra-coisa.tar" ]; then ok "não apaga arquivo de outro dono"; else falha "não apaga arquivo de outro dono"; fi

# ---- pastas dados dos plug-ins ----
if command -v sqlite3 >/dev/null 2>&1; then
  D="$TMP/dados/cerebro"
  mkdir -p "$D/vault/notas" "$D/hub"
  echo "# Oi" > "$D/vault/notas/a.md"
  sqlite3 "$D/hub/hub.db" "PRAGMA journal_mode=WAL; CREATE TABLE t(x); INSERT INTO t VALUES (42);" >/dev/null
  touch "$D/hub/hub.db-shm"
  copiar_dados_plugins "$TMP/dados" "$BACKUPS" 20261121-0400
  ARQ="$BACKUPS/plugin-cerebro-20261121-0400.tar.gz"
  if [ -f "$ARQ" ]; then ok "gera plugin-<id>-<data>.tar.gz"; else falha "gera plugin-<id>-<data>.tar.gz"; fi
  mkdir -p "$TMP/restaura" && tar -xzf "$ARQ" -C "$TMP/restaura"
  confere "leva os arquivos" "$(cat "$TMP/restaura/vault/notas/a.md")" "# Oi"
  confere "leva o SQLite pelo .backup" "$(sqlite3 "$TMP/restaura/hub/hub.db" 'SELECT x FROM t')" "42"
  if [ ! -e "$TMP/restaura/hub/hub.db-shm" ]; then ok "deixa -shm/-wal de fora"; else falha "deixa -shm/-wal de fora"; fi
else
  echo "pulado - pastas dados dos plug-ins (sqlite3 ausente)"
fi

# ---- estado da cópia externa ----
if command -v jq >/dev/null 2>&1; then
  gravar_falha copia "primeira falha"
  confere "falha sem sucesso anterior não inventa concluidoEm" "$(jq -r '.copia.concluidoEm // "nada"' "$ESTADO_EXTERNO")" "nada"

  gravar_ok copia abc123 4096
  confere "sucesso grava ok" "$(jq -r '.copia.ok' "$ESTADO_EXTERNO")" "true"
  confere "sucesso grava bytes" "$(jq -r '.copia.bytesTotal' "$ESTADO_EXTERNO")" "4096"
  SUCESSO=$(jq -r '.copia.concluidoEm' "$ESTADO_EXTERNO")

  export RESTIC_PASSWORD="senha-super-secreta" AWS_SECRET_ACCESS_KEY="chave-do-bucket"
  gravar_falha copia "Fatal: senha-super-secreta errada para chave-do-bucket"
  confere "falha mantém o último sucesso" "$(jq -r '.copia.concluidoEm' "$ESTADO_EXTERNO")" "$SUCESSO"
  confere "falha marca ok=false" "$(jq -r '.copia.ok' "$ESTADO_EXTERNO")" "false"
  confere "erro sem segredos" "$(jq -r '.copia.erro' "$ESTADO_EXTERNO")" "Fatal: *** errada para ***"

  gravar_ok conferencia abc123
  confere "conferência não apaga a cópia" "$(jq -r '.copia.erro' "$ESTADO_EXTERNO")" "Fatal: *** errada para ***"
  confere "conferência gravada" "$(jq -r '.conferencia.ok' "$ESTADO_EXTERNO")" "true"

  echo '{ quebrado' > "$ESTADO_EXTERNO"
  gravar_ok copia def456 1
  confere "estado inválido é recomeçado" "$(jq -r '.copia.instantaneo' "$ESTADO_EXTERNO")" "def456"
  if [ ! -e "$ESTADO_EXTERNO.tmp" ]; then ok "não deixa temporário"; else falha "não deixa temporário"; fi
else
  echo "pulado - estado da cópia externa (jq ausente)"
fi

# ---- configuração ----
NOTAS_BACKUP_CONFIG="$TMP/nao-existe.env"; CONFIG="$NOTAS_BACKUP_CONFIG"
if carregar_config 2>/dev/null; then falha "recusa configuração ausente"; else ok "recusa configuração ausente"; fi
printf 'RESTIC_REPOSITORY=s3:x\n' > "$TMP/meia.env"; CONFIG="$TMP/meia.env"
unset RESTIC_PASSWORD
if carregar_config 2>/dev/null; then falha "recusa configuração sem senha"; else ok "recusa configuração sem senha"; fi

echo
if [ "$FALHAS" -gt 0 ]; then echo "$FALHAS falha(s)"; exit 1; fi
echo "todos os testes passaram"
