#!/bin/sh
# Conferência semanal da cópia fora da VPS (spec 036): lê uma parte dos dados remotos e restaura o notas.db
# mais recente numa pasta temporária para rodar PRAGMA integrity_check. Agendar no cron do root:
#   0 5 * * 0 /opt/notas-vps/scripts/backup-conferir.sh >> /var/log/notas-backup.log 2>&1
set -u

DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=SCRIPTDIR/backup-comum.sh
. "$DIR/backup-comum.sh"

falhar() {
  gravar_falha conferencia "$1"
  echo "Conferência falhou: $(limpar_erro "$1")" >&2
  exit 1
}

carregar_config || falhar "configuração ausente ou incompleta"
travar || falhar "outra execução de backup ainda está rodando"

SAIDA=$(mktemp)
RESTAURO=$(mktemp -d)
trap 'rm -f "$SAIDA"; rm -rf "$RESTAURO"' EXIT

if ! restic check --read-data-subset=10% --quiet >"$SAIDA" 2>&1; then
  falhar "restic check: $(tail -n 1 "$SAIDA")"
fi

INSTANTANEO=$(restic snapshots --tag notas-vps --latest 1 --json 2>/dev/null | jq -r '.[-1].short_id // ""')
[ -n "$INSTANTANEO" ] || falhar "nenhum instantâneo com a tag notas-vps"

if ! restic restore "$INSTANTANEO" --target "$RESTAURO" --include "$BACKUPS/notas-*.db" --quiet >"$SAIDA" 2>&1; then
  falhar "restic restore: $(tail -n 1 "$SAIDA")"
fi

ULTIMO=$(find "$RESTAURO" -type f -name 'notas-*.db' | sort | tail -n 1)
[ -n "$ULTIMO" ] || falhar "o instantâneo $INSTANTANEO não tem notas-*.db"

RESULTADO=$(sqlite3 -readonly "$ULTIMO" 'PRAGMA integrity_check;' 2>&1 | head -n 1)
[ "$RESULTADO" = "ok" ] || falhar "integrity_check de $(basename "$ULTIMO"): $RESULTADO"

gravar_ok conferencia "$INSTANTANEO"
echo "Conferência ok: $(basename "$ULTIMO") do instantâneo $INSTANTANEO íntegro"
