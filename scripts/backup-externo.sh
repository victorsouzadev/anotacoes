#!/bin/sh
# Cópia cifrada do backup fora da VPS (spec 036). Chamado no fim do backup.sh, só depois de um backup local
# sem erro. Pode rodar à mão: /opt/notas-vps/scripts/backup-externo.sh
# Requer: apt install restic jq; configuração em /root/.config/notas-backup.env (ver DEPLOY.md).
set -u

DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=SCRIPTDIR/backup-comum.sh
. "$DIR/backup-comum.sh"

falhar() {
  gravar_falha copia "$1"
  echo "Cópia externa falhou: $(limpar_erro "$1")" >&2
  exit 1
}

carregar_config || falhar "configuração ausente ou incompleta"
travar || falhar "outra execução de backup ainda está rodando"

SAIDA=$(mktemp)
trap 'rm -f "$SAIDA"' EXIT

# Os arquivos vivos do SQLite e do Postgres ficam de fora: valem as cópias consistentes em backups/.
if ! restic backup --tag notas-vps --quiet \
    --exclude "$BASE/data/db/notas.db" --exclude "$BASE/data/db/notas.db-*" \
    --exclude "$BASE/data/sites/*/data/app.db" --exclude "$BASE/data/sites/*/data/app.db-*" \
    --exclude "$BASE/data/postgres" --exclude "*.tmp" \
    "$BACKUPS" "$BASE/data" "$BASE/.env" >"$SAIDA" 2>&1; then
  falhar "restic backup: $(tail -n 1 "$SAIDA")"
fi

if ! restic forget --tag notas-vps --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune --quiet >"$SAIDA" 2>&1; then
  falhar "restic forget: $(tail -n 1 "$SAIDA")"
fi

INSTANTANEO=$(restic snapshots --tag notas-vps --latest 1 --json 2>/dev/null | jq -r '.[-1].short_id // ""')
BYTES=$(restic stats --mode raw-data --json 2>/dev/null | jq -r '.total_size // 0')
gravar_ok copia "$INSTANTANEO" "${BYTES:-0}"
echo "Cópia externa ok: instantâneo $INSTANTANEO"
